import { ethers, Contract, Provider, Signer, JsonRpcProvider } from "ethers";
import { BANPRegistryABI } from "./abi";
import {
  BANPClientConfig,
  WalletMapping,
  AccountInfo,
  RegistrationResult,
  MIN_BANP_NUMBER,
  MAX_BANP_NUMBER,
} from "./types";

export class BANPClient {
  private contract: Contract;
  private provider: Provider;
  private signer?: Signer;

  private static readonly CHAIN_RE = /^[a-z0-9-]{1,32}$/;
  private static readonly MAX_WALLET_LENGTH = 128;

  constructor(config: BANPClientConfig) {
    if (config.provider) {
      this.provider = config.provider;
    } else if (config.rpcUrl) {
      this.provider = new JsonRpcProvider(config.rpcUrl);
    } else {
      throw new Error("Either provider or rpcUrl must be provided");
    }

    this.signer = config.signer;

    const signerOrProvider = this.signer ?? this.provider;
    this.contract = new Contract(
      config.contractAddress,
      BANPRegistryABI,
      signerOrProvider
    );
  }

  // ── Validation ───────────────────────────────────

  static isValidNumber(number: bigint): boolean {
    return number >= MIN_BANP_NUMBER && number <= MAX_BANP_NUMBER;
  }

  private requireValidNumber(number: bigint): void {
    if (!BANPClient.isValidNumber(number)) {
      throw new Error(
        `Invalid BANP number: ${number}. Must be 11 digits (${MIN_BANP_NUMBER} - ${MAX_BANP_NUMBER})`
      );
    }
  }

  private requireValidChain(chain: string): void {
    if (!BANPClient.CHAIN_RE.test(chain)) {
      throw new Error(
        `Invalid chain name "${chain}". Must be lowercase a-z, 0-9, or hyphen, max 32 chars.`
      );
    }
  }

  private requireValidWallet(wallet: string): void {
    if (wallet.length === 0) throw new Error("Wallet address cannot be empty");
    if (wallet.length > BANPClient.MAX_WALLET_LENGTH) {
      throw new Error(
        `Wallet address too long (${wallet.length} chars, max ${BANPClient.MAX_WALLET_LENGTH})`
      );
    }
  }

  private requireSigner(): Signer {
    if (!this.signer) {
      throw new Error("Signer required for write operations. Provide a signer in the config.");
    }
    return this.signer;
  }

  // ── Read Operations ──────────────────────────────

  async resolve(number: bigint, chain: string): Promise<string> {
    this.requireValidNumber(number);
    return this.contract.getWalletMapping(number, chain);
  }

  async getChains(number: bigint): Promise<string[]> {
    this.requireValidNumber(number);
    return this.contract.getChains(number);
  }

  async getAllMappings(number: bigint): Promise<WalletMapping[]> {
    this.requireValidNumber(number);
    const [chains, wallets]: [string[], string[]] =
      await this.contract.getAllMappings(number);

    return chains.map((chain, i) => ({
      chain,
      wallet: wallets[i],
    }));
  }

  async getAccountInfo(number: bigint): Promise<AccountInfo | null> {
    this.requireValidNumber(number);
    const registered = await this.contract.isRegistered(number);
    if (!registered) return null;

    const [owner, mappings] = await Promise.all([
      this.contract.ownerOf(number) as Promise<string>,
      this.getAllMappings(number),
    ]);

    return { number, owner, mappings };
  }

  async isRegistered(number: bigint): Promise<boolean> {
    this.requireValidNumber(number);
    return this.contract.isRegistered(number);
  }

  async getOwner(number: bigint): Promise<string> {
    this.requireValidNumber(number);
    return this.contract.ownerOf(number);
  }

  async getRegistrationFee(): Promise<bigint> {
    return this.contract.registrationFee();
  }

  async getTotalRegistered(): Promise<bigint> {
    return this.contract.totalRegistered();
  }

  // ── Write Operations ─────────────────────────────

  async register(number: bigint, fee?: bigint): Promise<RegistrationResult> {
    this.requireValidNumber(number);
    this.requireSigner();

    const registrationFee = fee ?? (await this.getRegistrationFee());
    const tx = await this.contract.registerNumber(number, {
      value: registrationFee,
    });
    const receipt = await tx.wait();
    const signer = this.signer!;

    return {
      txHash: receipt.hash,
      number,
      owner: await signer.getAddress(),
    };
  }

  async setMapping(
    number: bigint,
    chain: string,
    wallet: string
  ): Promise<string> {
    this.requireValidNumber(number);
    this.requireSigner();
    this.requireValidChain(chain);
    this.requireValidWallet(wallet);

    const tx = await this.contract.setWalletMapping(number, chain, wallet);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async removeMapping(number: bigint, chain: string): Promise<string> {
    this.requireValidNumber(number);
    this.requireSigner();

    const tx = await this.contract.removeWalletMapping(number, chain);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async setMappings(
    number: bigint,
    mappings: WalletMapping[]
  ): Promise<string[]> {
    this.requireValidNumber(number);
    this.requireSigner();

    const txHashes: string[] = [];
    for (const { chain, wallet } of mappings) {
      const hash = await this.setMapping(number, chain, wallet);
      txHashes.push(hash);
    }
    return txHashes;
  }

  async transfer(number: bigint, to: string): Promise<string> {
    this.requireValidNumber(number);
    this.requireSigner();

    const from = await this.signer!.getAddress();
    const tx = await this.contract["safeTransferFrom(address,address,uint256)"](from, to, number);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ── Admin Operations ─────────────────────────────

  async setRegistrationFee(newFee: bigint): Promise<string> {
    this.requireSigner();
    const tx = await this.contract.setRegistrationFee(newFee);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async withdrawFees(to: string): Promise<string> {
    this.requireSigner();
    const tx = await this.contract.withdrawFees(to);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ── Events ───────────────────────────────────────

  onNumberRegistered(
    callback: (number: bigint, owner: string) => void
  ): void {
    this.contract.on("NumberRegistered", callback);
  }

  onMappingSet(
    callback: (number: bigint, chain: string, wallet: string) => void
  ): void {
    this.contract.on("WalletMappingSet", callback);
  }

  onMappingRemoved(
    callback: (number: bigint, chain: string) => void
  ): void {
    this.contract.on("WalletMappingRemoved", callback);
  }

  removeAllListeners(): void {
    this.contract.removeAllListeners();
  }
}
