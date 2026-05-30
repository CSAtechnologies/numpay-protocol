import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export interface RegisteredNumber {
  number: string;
  owner: string;
  block_number: number;
  tx_hash: string;
  registered_at: string;
}

export interface WalletMapping {
  number: string;
  chain: string;
  wallet: string;
  block_number: number;
  tx_hash: string;
  updated_at: string;
}

export class BANPDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS registered_numbers (
        number       TEXT PRIMARY KEY,
        owner        TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        tx_hash      TEXT NOT NULL,
        registered_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS wallet_mappings (
        number       TEXT NOT NULL,
        chain        TEXT NOT NULL,
        wallet       TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        tx_hash      TEXT NOT NULL,
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (number, chain)
      );

      CREATE TABLE IF NOT EXISTS indexer_state (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_mappings_number ON wallet_mappings(number);
      CREATE INDEX IF NOT EXISTS idx_registered_owner ON registered_numbers(owner);
    `);
  }

  // ── Indexer State ────────────────────────────────

  getLastIndexedBlock(): number {
    const row = this.db
      .prepare("SELECT value FROM indexer_state WHERE key = 'last_block'")
      .get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  }

  setLastIndexedBlock(block: number): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO indexer_state (key, value) VALUES ('last_block', ?)"
      )
      .run(block.toString());
  }

  // ── Registration ─────────────────────────────────

  insertRegistration(
    number: string,
    owner: string,
    blockNumber: number,
    txHash: string
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO registered_numbers (number, owner, block_number, tx_hash, registered_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      )
      .run(number, owner, blockNumber, txHash);
  }

  updateOwner(number: string, newOwner: string, blockNumber: number, txHash: string): void {
    this.db
      .prepare(
        "UPDATE registered_numbers SET owner = ?, block_number = ?, tx_hash = ? WHERE number = ?"
      )
      .run(newOwner, blockNumber, txHash, number);
  }

  // ── Wallet Mappings ──────────────────────────────

  upsertMapping(
    number: string,
    chain: string,
    wallet: string,
    blockNumber: number,
    txHash: string
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO wallet_mappings (number, chain, wallet, block_number, tx_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(number, chain, wallet, blockNumber, txHash);
  }

  removeMapping(number: string, chain: string): void {
    this.db
      .prepare("DELETE FROM wallet_mappings WHERE number = ? AND chain = ?")
      .run(number, chain);
  }

  // Delete every mapping for a number. Mirrors the contract wiping all mappings
  // when a BPAN NFT transfers to a new owner (AllMappingsCleared / Transfer).
  clearMappings(number: string): void {
    this.db
      .prepare("DELETE FROM wallet_mappings WHERE number = ?")
      .run(number);
  }

  // ── Queries ──────────────────────────────────────

  resolve(number: string, chain: string): string | null {
    const row = this.db
      .prepare(
        "SELECT wallet FROM wallet_mappings WHERE number = ? AND chain = ?"
      )
      .get(number, chain) as { wallet: string } | undefined;
    return row?.wallet ?? null;
  }

  getAccount(number: string): RegisteredNumber | null {
    return (
      (this.db
        .prepare("SELECT * FROM registered_numbers WHERE number = ?")
        .get(number) as RegisteredNumber) ?? null
    );
  }

  getMappings(number: string): WalletMapping[] {
    return this.db
      .prepare("SELECT * FROM wallet_mappings WHERE number = ?")
      .all(number) as WalletMapping[];
  }

  getAccountsByOwner(owner: string): RegisteredNumber[] {
    return this.db
      .prepare("SELECT * FROM registered_numbers WHERE owner = ?")
      .all(owner) as RegisteredNumber[];
  }

  getTotalRegistered(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM registered_numbers")
      .get() as { count: number };
    return row.count;
  }

  isRegistered(number: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM registered_numbers WHERE number = ?")
      .get(number);
    return !!row;
  }

  close(): void {
    this.db.close();
  }
}
