import { ethers, Contract, JsonRpcProvider, Log } from "ethers";
import { BANPDatabase } from "./db";

const BANPRegistryABI = [
  "event NumberRegistered(uint256 indexed number, address indexed owner)",
  "event WalletMappingSet(uint256 indexed number, string chain, string walletAddress)",
  "event WalletMappingRemoved(uint256 indexed number, string chain)",
  "event AllMappingsCleared(uint256 indexed number, address indexed previousOwner, address indexed newOwner)",
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

    // Fetch every relevant event in one query (OR over the topic-0 set), then
    // apply them in exact chain order. Processing event classes separately would
    // ignore (blockNumber, transactionIndex, logIndex) and could, e.g., apply a
    // set before a remove that actually happened first on-chain.
    const topic0 = [
      ethers.id("NumberRegistered(uint256,address)"),
      ethers.id("WalletMappingSet(uint256,string,string)"),
      ethers.id("WalletMappingRemoved(uint256,string)"),
      ethers.id("AllMappingsCleared(uint256,address,address)"),
      ethers.id("Transfer(address,address,uint256)"),
    ];
    const logs = await this.provider.getLogs({
      address,
      topics: [topic0], // first-position OR-set
      fromBlock,
      toBlock,
    });

    // Canonical order: block, then transaction index, then log index.
    logs.sort(
      (a, b) =>
        a.blockNumber - b.blockNumber ||
        a.transactionIndex - b.transactionIndex ||
        a.index - b.index,
    );

    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

    for (const log of logs) {
      const parsed = this.contract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (!parsed) continue;

      switch (parsed.name) {
        case "NumberRegistered": {
          const number = parsed.args[0].toString();
          const owner = parsed.args[1];
          this.db.insertRegistration(number, owner, log.blockNumber, log.transactionHash);
          console.log(`[Indexer] Registered: ${number} -> ${owner}`);
          break;
        }
        case "WalletMappingSet": {
          const number = parsed.args[0].toString();
          const chain = parsed.args[1];
          const wallet = parsed.args[2];
          this.db.upsertMapping(number, chain, wallet, log.blockNumber, log.transactionHash);
          console.log(`[Indexer] Mapping set: ${number} ${chain} -> ${wallet}`);
          break;
        }
        case "WalletMappingRemoved": {
          const number = parsed.args[0].toString();
          const chain = parsed.args[1];
          this.db.removeMapping(number, chain);
          console.log(`[Indexer] Mapping removed: ${number} ${chain}`);
          break;
        }
        case "AllMappingsCleared": {
          // Contract wiped all mappings on an ownership change — mirror it.
          const number = parsed.args[0].toString();
          this.db.clearMappings(number);
          console.log(`[Indexer] Mappings cleared: ${number}`);
          break;
        }
        case "Transfer": {
          const from = parsed.args[0];
          const to = parsed.args[1];
          const tokenId = parsed.args[2].toString();
          // Skip mint events (already handled by NumberRegistered).
          if (from === ZERO_ADDRESS) break;
          this.db.updateOwner(tokenId, to, log.blockNumber, log.transactionHash);
          // Defensive mirror of the on-chain clear, in case the event is missed.
          this.db.clearMappings(tokenId);
          console.log(`[Indexer] Transfer: ${tokenId} ${from} -> ${to}`);
          break;
        }
      }
    }
  }
}
