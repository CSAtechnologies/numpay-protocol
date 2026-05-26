import { ethers, Contract, JsonRpcProvider, Log } from "ethers";
import { BANPDatabase } from "./db";

const BANPRegistryABI = [
  "event NumberRegistered(uint256 indexed number, address indexed owner)",
  "event WalletMappingSet(uint256 indexed number, string chain, string walletAddress)",
  "event WalletMappingRemoved(uint256 indexed number, string chain)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

export interface IndexerConfig {
  rpcUrl: string;
  contractAddress: string;
  startBlock: number;
  pollIntervalMs: number;
  db: BANPDatabase;
}

export class BANPIndexer {
  private provider: JsonRpcProvider;
  private contract: Contract;
  private db: BANPDatabase;
  private pollIntervalMs: number;
  private running = false;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(config: IndexerConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.contract = new Contract(
      config.contractAddress,
      BANPRegistryABI,
      this.provider
    );
    this.db = config.db;
    this.pollIntervalMs = config.pollIntervalMs;

    const savedBlock = this.db.getLastIndexedBlock();
    if (savedBlock === 0 && config.startBlock > 0) {
      this.db.setLastIndexedBlock(config.startBlock);
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.log("[Indexer] Starting...");
    await this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    console.log("[Indexer] Stopped");
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      await this.indexNewBlocks();
    } catch (err: any) {
      console.error("[Indexer] Error during indexing:", err.message);
    }

    if (this.running) {
      this.timeoutId = setTimeout(() => this.poll(), this.pollIntervalMs);
    }
  }

  private async indexNewBlocks(): Promise<void> {
    const lastIndexed = this.db.getLastIndexedBlock();
    const currentBlock = await this.provider.getBlockNumber();

    if (lastIndexed >= currentBlock) return;

    // Process in chunks of 1000 blocks to avoid RPC limits
    const CHUNK_SIZE = 1000;
    let fromBlock = lastIndexed + 1;

    while (fromBlock <= currentBlock) {
      const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, currentBlock);
      console.log(`[Indexer] Processing blocks ${fromBlock} - ${toBlock}`);

      await this.processBlockRange(fromBlock, toBlock);
      this.db.setLastIndexedBlock(toBlock);
      fromBlock = toBlock + 1;
    }
  }

  private async processBlockRange(
    fromBlock: number,
    toBlock: number
  ): Promise<void> {
    const address = await this.contract.getAddress();

    // Fetch all relevant logs in parallel
    const [registrationLogs, mappingSetLogs, mappingRemovedLogs, transferLogs] =
      await Promise.all([
        this.provider.getLogs({
          address,
          topics: [ethers.id("NumberRegistered(uint256,address)")],
          fromBlock,
          toBlock,
        }),
        this.provider.getLogs({
          address,
          topics: [ethers.id("WalletMappingSet(uint256,string,string)")],
          fromBlock,
          toBlock,
        }),
        this.provider.getLogs({
          address,
          topics: [ethers.id("WalletMappingRemoved(uint256,string)")],
          fromBlock,
          toBlock,
        }),
        this.provider.getLogs({
          address,
          topics: [ethers.id("Transfer(address,address,uint256)")],
          fromBlock,
          toBlock,
        }),
      ]);

    // Process registrations
    for (const log of registrationLogs) {
      const parsed = this.contract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (!parsed) continue;

      const number = parsed.args[0].toString();
      const owner = parsed.args[1];
      this.db.insertRegistration(number, owner, log.blockNumber, log.transactionHash);
      console.log(`[Indexer] Registered: ${number} -> ${owner}`);
    }

    // Process mapping sets
    for (const log of mappingSetLogs) {
      const parsed = this.contract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (!parsed) continue;

      const number = parsed.args[0].toString();
      const chain = parsed.args[1];
      const wallet = parsed.args[2];
      this.db.upsertMapping(number, chain, wallet, log.blockNumber, log.transactionHash);
      console.log(`[Indexer] Mapping set: ${number} ${chain} -> ${wallet}`);
    }

    // Process mapping removals
    for (const log of mappingRemovedLogs) {
      const parsed = this.contract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (!parsed) continue;

      const number = parsed.args[0].toString();
      const chain = parsed.args[1];
      this.db.removeMapping(number, chain);
      console.log(`[Indexer] Mapping removed: ${number} ${chain}`);
    }

    // Process transfers (ownership changes, skip mint events where from = 0x0)
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    for (const log of transferLogs) {
      const parsed = this.contract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (!parsed) continue;

      const from = parsed.args[0];
      const to = parsed.args[1];
      const tokenId = parsed.args[2].toString();

      // Skip mint events (already handled by NumberRegistered)
      if (from === ZERO_ADDRESS) continue;

      this.db.updateOwner(tokenId, to, log.blockNumber, log.transactionHash);
      console.log(`[Indexer] Transfer: ${tokenId} ${from} -> ${to}`);
    }
  }
}
