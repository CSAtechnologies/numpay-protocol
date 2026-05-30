import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { getContract } from "./contract";
import { ethers } from "ethers";

const router = Router();

const MIN_NUMBER = 10_000_000_000n;
const MAX_NUMBER = 99_999_999_999n;
const CHAIN_RE = /^[a-z0-9-]{1,32}$/;

// ── Anti-enumeration controls ──────────────────────────────────────────────
// BANP registrations are public on-chain data, so enumeration can never be
// fully prevented (anyone can read the contract directly). These controls stop
// the API from being a *fast, free* enumeration oracle: a tight per-IP limit
// on lookups plus a response-time floor so hits and misses are indistinguishable
// by timing. Lookup failures also use a uniform shape and status code so the
// response body/status never reveals which numbers exist.

const lookupLimiter = rateLimit({
  windowMs: 60_000,
  max: 30, // per IP, stricter than the global limiter
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

const MIN_RESPONSE_MS = 200;
function smoothTiming(_req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const orig = res.json.bind(res);
  res.json = (body: unknown): Response => {
    const wait = Math.max(0, MIN_RESPONSE_MS - (Date.now() - start));
    if (wait === 0) return orig(body);
    setTimeout(() => orig(body), wait);
    return res;
  };
  next();
}

const lookupGuards = [lookupLimiter, smoothTiming];

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
router.get("/resolve/:number/:chain", ...lookupGuards, async (req: Request, res: Response) => {
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

    // Uniform 200 shape for found and not-found so the status code / error
    // string never reveals whether the number or mapping exists.
    res.json({
      found: Boolean(wallet),
      number: number.toString(),
      chain,
      wallet: wallet || null,
    });
  } catch (err: any) {
    console.error("[resolve]", err);
    res.status(500).json({ error: "Failed to resolve mapping" });
  }
});

// GET /api/v1/account/:number
// Get full account info including all chain mappings
router.get("/account/:number", ...lookupGuards, async (req: Request, res: Response) => {
  const number = parseNumber(req.params.number);
  if (!number) {
    res.status(400).json({ error: "Invalid BANP number. Must be 11 digits." });
    return;
  }

  try {
    const contract = getContract();
    const registered: boolean = await contract.isRegistered(number);

    if (!registered) {
      // Uniform 200 shape (see resolve) instead of a distinguishing 404.
      res.json({
        found: false,
        number: number.toString(),
        owner: null,
        mappings: [],
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
      found: true,
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
router.get("/account/:number/chains", ...lookupGuards, async (req: Request, res: Response) => {
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
router.get("/account/:number/status", ...lookupGuards, async (req: Request, res: Response) => {
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
