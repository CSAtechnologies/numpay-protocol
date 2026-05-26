import { Router, Request, Response } from "express";
import { getContract } from "./contract";
import { ethers } from "ethers";

const router = Router();

const MIN_NUMBER = 10_000_000_000n;
const MAX_NUMBER = 99_999_999_999n;
const CHAIN_RE = /^[a-z0-9-]{1,32}$/;

function parseNumber(raw: string): bigint | null {
  try {
    const num = BigInt(raw);
    if (num < MIN_NUMBER || num > MAX_NUMBER) return null;
    return num;
  } catch {
    return null;
  }
}

function parseChain(raw: string): string | null {
  const chain = raw.toLowerCase();
  return CHAIN_RE.test(chain) ? chain : null;
}

// GET /api/v1/resolve/:number/:chain
// Resolve a BANP number to a wallet address on a specific chain
router.get("/resolve/:number/:chain", async (req: Request, res: Response) => {
  const number = parseNumber(req.params.number);
  if (!number) {
    res.status(400).json({ error: "Invalid BANP number. Must be 11 digits." });
    return;
  }

  const chain = parseChain(req.params.chain);
  if (!chain) {
    res.status(400).json({ error: "Invalid chain. Must be lowercase a-z, 0-9, or hyphen, max 32 chars." });
    return;
  }

  try {
    const contract = getContract();
    const wallet: string = await contract.getWalletMapping(number, chain);

    if (!wallet) {
      res.status(404).json({
        error: "No wallet mapping found",
        number: number.toString(),
        chain,
      });
      return;
    }

    res.json({
      number: number.toString(),
      chain,
      wallet,
    });
  } catch (err: any) {
    console.error("[resolve]", err);
    res.status(500).json({ error: "Failed to resolve mapping" });
  }
});

// GET /api/v1/account/:number
// Get full account info including all chain mappings
router.get("/account/:number", async (req: Request, res: Response) => {
  const number = parseNumber(req.params.number);
  if (!number) {
    res.status(400).json({ error: "Invalid BANP number. Must be 11 digits." });
    return;
  }

  try {
    const contract = getContract();
    const registered: boolean = await contract.isRegistered(number);

    if (!registered) {
      res.status(404).json({
        error: "Number not registered",
        number: number.toString(),
      });
      return;
    }

    const [owner, [chains, wallets]]: [string, [string[], string[]]] =
      await Promise.all([
        contract.ownerOf(number),
        contract.getAllMappings(number),
      ]);

    const mappings = chains.map((chain: string, i: number) => ({
      chain,
      wallet: wallets[i],
    }));

    res.json({
      number: number.toString(),
      owner,
      mappings,
    });
  } catch (err: any) {
    console.error("[account]", err);
    res.status(500).json({ error: "Failed to fetch account" });
  }
});

// GET /api/v1/account/:number/chains
// Get all chains mapped for a number
router.get("/account/:number/chains", async (req: Request, res: Response) => {
  const number = parseNumber(req.params.number);
  if (!number) {
    res.status(400).json({ error: "Invalid BANP number. Must be 11 digits." });
    return;
  }

  try {
    const contract = getContract();
    const chains: string[] = await contract.getChains(number);

    res.json({
      number: number.toString(),
      chains,
    });
  } catch (err: any) {
    console.error("[chains]", err);
    res.status(500).json({ error: "Failed to fetch chains" });
  }
});

// GET /api/v1/account/:number/status
// Check if a number is registered
router.get("/account/:number/status", async (req: Request, res: Response) => {
  const number = parseNumber(req.params.number);
  if (!number) {
    res.status(400).json({ error: "Invalid BANP number. Must be 11 digits." });
    return;
  }

  try {
    const contract = getContract();
    const registered: boolean = await contract.isRegistered(number);

    res.json({
      number: number.toString(),
      registered,
    });
  } catch (err: any) {
    console.error("[status]", err);
    res.status(500).json({ error: "Failed to check status" });
  }
});

// GET /api/v1/stats
// Get protocol statistics
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const contract = getContract();
    const [totalRegistered, registrationFee] = await Promise.all([
      contract.totalRegistered(),
      contract.registrationFee(),
    ]);

    res.json({
      totalRegistered: totalRegistered.toString(),
      registrationFee: ethers.formatEther(registrationFee),
      registrationFeeWei: registrationFee.toString(),
    });
  } catch (err: any) {
    console.error("[stats]", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// GET /api/v1/health
router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
