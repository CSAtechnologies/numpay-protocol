import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BANPDatabase } from "../src/db";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.join(__dirname, "test.db");

describe("BANPDatabase", () => {
  let db: BANPDatabase;

  beforeEach(() => {
    db = new BANPDatabase(TEST_DB_PATH);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    // Clean up WAL files
    const walPath = TEST_DB_PATH + "-wal";
    const shmPath = TEST_DB_PATH + "-shm";
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  });

  describe("Indexer State", () => {
    it("should return 0 for initial last indexed block", () => {
      expect(db.getLastIndexedBlock()).toBe(0);
    });

    it("should persist last indexed block", () => {
      db.setLastIndexedBlock(12345);
      expect(db.getLastIndexedBlock()).toBe(12345);
    });

    it("should update last indexed block", () => {
      db.setLastIndexedBlock(100);
      db.setLastIndexedBlock(200);
      expect(db.getLastIndexedBlock()).toBe(200);
    });
  });

  describe("Registration", () => {
    it("should insert and retrieve a registration", () => {
      db.insertRegistration("48290173462", "0xOwner1", 100, "0xTxHash1");
      const account = db.getAccount("48290173462");
      expect(account).not.toBeNull();
      expect(account!.number).toBe("48290173462");
      expect(account!.owner).toBe("0xOwner1");
      expect(account!.block_number).toBe(100);
    });

    it("should check if a number is registered", () => {
      expect(db.isRegistered("48290173462")).toBe(false);
      db.insertRegistration("48290173462", "0xOwner1", 100, "0xTxHash1");
      expect(db.isRegistered("48290173462")).toBe(true);
    });

    it("should count total registered", () => {
      expect(db.getTotalRegistered()).toBe(0);
      db.insertRegistration("48290173462", "0xOwner1", 100, "0xTx1");
      db.insertRegistration("10000000000", "0xOwner2", 101, "0xTx2");
      expect(db.getTotalRegistered()).toBe(2);
    });

    it("should update owner on transfer", () => {
      db.insertRegistration("48290173462", "0xOwner1", 100, "0xTx1");
      db.updateOwner("48290173462", "0xOwner2", 200, "0xTx2");
      const account = db.getAccount("48290173462");
      expect(account!.owner).toBe("0xOwner2");
    });

    it("should find accounts by owner", () => {
      db.insertRegistration("48290173462", "0xOwner1", 100, "0xTx1");
      db.insertRegistration("10000000000", "0xOwner1", 101, "0xTx2");
      db.insertRegistration("99999999999", "0xOwner2", 102, "0xTx3");

      const owner1Accounts = db.getAccountsByOwner("0xOwner1");
      expect(owner1Accounts).toHaveLength(2);

      const owner2Accounts = db.getAccountsByOwner("0xOwner2");
      expect(owner2Accounts).toHaveLength(1);
    });
  });

  describe("Wallet Mappings", () => {
    beforeEach(() => {
      db.insertRegistration("48290173462", "0xOwner1", 100, "0xTx1");
    });

    it("should insert and resolve a mapping", () => {
      db.upsertMapping("48290173462", "ethereum", "0xETH_WALLET", 101, "0xTx2");
      const wallet = db.resolve("48290173462", "ethereum");
      expect(wallet).toBe("0xETH_WALLET");
    });

    it("should return null for non-existent mapping", () => {
      expect(db.resolve("48290173462", "bitcoin")).toBeNull();
    });

    it("should update an existing mapping", () => {
      db.upsertMapping("48290173462", "ethereum", "0xOLD", 101, "0xTx2");
      db.upsertMapping("48290173462", "ethereum", "0xNEW", 102, "0xTx3");
      expect(db.resolve("48290173462", "ethereum")).toBe("0xNEW");
    });

    it("should remove a mapping", () => {
      db.upsertMapping("48290173462", "ethereum", "0xETH", 101, "0xTx2");
      db.removeMapping("48290173462", "ethereum");
      expect(db.resolve("48290173462", "ethereum")).toBeNull();
    });

    it("should get all mappings for a number", () => {
      db.upsertMapping("48290173462", "ethereum", "0xETH", 101, "0xTx2");
      db.upsertMapping("48290173462", "solana", "SOL_ADDR", 102, "0xTx3");
      db.upsertMapping("48290173462", "sui", "0xSUI", 103, "0xTx4");

      const mappings = db.getMappings("48290173462");
      expect(mappings).toHaveLength(3);
      expect(mappings.map((m) => m.chain).sort()).toEqual(["ethereum", "solana", "sui"]);
    });

    it("should return empty array for number with no mappings", () => {
      expect(db.getMappings("48290173462")).toHaveLength(0);
    });
  });
});
