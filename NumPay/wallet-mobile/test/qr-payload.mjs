/**
 * Unit tests for the scanned-QR parser (core/qrPayload.ts):
 *
 *   node test/qr-payload.mjs
 *
 * This is the layer that decides where a scan sends money, so it gets the same
 * treatment as the dApp engines: bundle the real module with esbuild, drive it
 * with realistic AND hostile payloads, exit non-zero on any failure.
 *
 * The property that matters most: a bare EVM address must NEVER come back with
 * a chain, because a correct address on the wrong network is unrecoverable.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = mkdtempSync(join(tmpdir(), "numpay-qr-test-"));

// CJS, not ESM: the parser reaches core/networks -> ethers -> ws, which uses
// dynamic require() that an ESM bundle cannot execute.
const file = join(out, "qrPayload.cjs");
await build({
  entryPoints: [join(root, "../packages/core/src/qrPayload.ts")],
  bundle: true,
  format: "cjs",
  outfile: file,
  logLevel: "error",
  platform: "node",
  define: { "process.env.NODE_ENV": '"test"' },
});
const { parseScannedPayload } = createRequire(import.meta.url)(file);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}\n      actual   ${a}`);
}

// Real addresses (public, well-known) so the validators see genuine shapes.
const EVM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik.eth
const EVM2 = "0x68870B4f4f5D0dA9C7CFC9d0Cd0eE5F1D2c352A1";
const SOL = "So11111111111111111111111111111111111111112";
const TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const SUI = "0x0000000000000000000000000000000000000000000000000000000000000002";
const BTC = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";

// ── WalletConnect ───────────────────────────────────────────────────────────
eq("wc: pairing",
  parseScannedPayload("wc:abc123@2?relay-protocol=irn&symKey=deadbeef"),
  { kind: "walletconnect", uri: "wc:abc123@2?relay-protocol=irn&symKey=deadbeef" });
check("wc: is case-insensitive",
  parseScannedPayload("WC:abc@2").kind === "walletconnect");

// ── The chain-safety property ───────────────────────────────────────────────
eq("bare EVM address carries NO chain", parseScannedPayload(EVM),
  { kind: "address", address: EVM });
check("bare EVM address really has chainId undefined",
  parseScannedPayload(EVM).chainId === undefined);
check("whitespace is trimmed",
  parseScannedPayload(`  ${EVM}\n`).address === EVM);

// ── EIP-681 ─────────────────────────────────────────────────────────────────
eq("eip681 without @chain defaults to Ethereum",
  parseScannedPayload(`ethereum:${EVM}`),
  { kind: "address", address: EVM, chainId: "ethereum" });
eq("eip681 @8453 maps to Base",
  parseScannedPayload(`ethereum:${EVM}@8453`),
  { kind: "address", address: EVM, chainId: "base" });
eq("eip681 @137 maps to Polygon",
  parseScannedPayload(`ethereum:${EVM}@137`),
  { kind: "address", address: EVM, chainId: "polygon" });
eq("pay- prefix is accepted",
  parseScannedPayload(`pay-ethereum:${EVM}@1`),
  { kind: "address", address: EVM, chainId: "ethereum" });
eq("eip681 value=wei becomes a decimal amount",
  parseScannedPayload(`ethereum:${EVM}@1?value=1000000000000000000`),
  { kind: "address", address: EVM, chainId: "ethereum", amount: "1" });
eq("eip681 scientific-notation value",
  parseScannedPayload(`ethereum:${EVM}@1?value=2.014e18`),
  { kind: "address", address: EVM, chainId: "ethereum", amount: "2.014" });
check("eip681 junk value is dropped, address still returned", (() => {
  const p = parseScannedPayload(`ethereum:${EVM}@1?value=abc`);
  return p.kind === "address" && p.address === EVM && p.amount === undefined;
})());
// An unsupported chain must take the WHOLE payload down: returning the address
// alone would invite sending it on whatever chain happened to be selected.
eq("eip681 on an unsupported chain is refused",
  parseScannedPayload(`ethereum:${EVM}@99999`),
  { kind: "unknown", raw: `ethereum:${EVM}@99999` });
// ERC-20 transfer: recipient is the `address` param, not the contract.
eq("eip681 /transfer takes the recipient, not the contract",
  parseScannedPayload(`ethereum:${EVM2}@1/transfer?address=${EVM}&uint256=5000000`),
  { kind: "address", address: EVM, chainId: "ethereum" });
check("eip681 /transfer never returns a token-unit amount",
  parseScannedPayload(`ethereum:${EVM2}@1/transfer?address=${EVM}&uint256=5000000`).amount === undefined);
eq("eip681 /transfer without a recipient is refused",
  parseScannedPayload(`ethereum:${EVM2}@1/transfer?uint256=5000000`),
  { kind: "unknown", raw: `ethereum:${EVM2}@1/transfer?uint256=5000000` });

// ── Non-EVM schemes and bare addresses ──────────────────────────────────────
eq("solana: scheme with amount",
  parseScannedPayload(`solana:${SOL}?amount=1.5`),
  { kind: "address", address: SOL, chainId: "solana", amount: "1.5" });
eq("bare Solana address is detected",
  parseScannedPayload(SOL), { kind: "address", address: SOL, chainId: "solana" });
eq("bare Tron address is detected",
  parseScannedPayload(TRON), { kind: "address", address: TRON, chainId: "tron" });
eq("bare Bitcoin segwit address is detected",
  parseScannedPayload(BTC), { kind: "address", address: BTC, chainId: "bitcoin" });
// Sui is 0x + 64 hex, so it can never be mistaken for an EVM address.
eq("bare Sui address is detected and does not collide with EVM",
  parseScannedPayload(SUI), { kind: "address", address: SUI, chainId: "sui" });
eq("scheme/address mismatch is refused",
  parseScannedPayload(`solana:${EVM}`),
  { kind: "unknown", raw: `solana:${EVM}` });

// ── BPAN ────────────────────────────────────────────────────────────────────
eq("11 digits is a BPAN", parseScannedPayload("12345678901"),
  { kind: "bpan", bpan: "12345678901" });
eq("formatted BPAN is normalised", parseScannedPayload("123 4567 8901"),
  { kind: "bpan", bpan: "12345678901" });
check("10 digits is not a BPAN", parseScannedPayload("1234567890").kind === "unknown");
check("12 digits is not a BPAN", parseScannedPayload("123456789012").kind === "unknown");

// ── Junk ────────────────────────────────────────────────────────────────────
for (const junk of [
  "", "   ", "hello world", "https://numpay.example/pay",
  "0xdeadbeef",                                  // too short for EVM
  `${EVM}0`,                                     // too long for EVM
  "0xZZZZ6BF26964aF9D7eEd9e03E53415D37aA96045",  // non-hex
]) {
  check(`junk rejected: ${JSON.stringify(junk)}`,
    parseScannedPayload(junk).kind === "unknown");
}
check("null/undefined do not throw",
  parseScannedPayload(undefined).kind === "unknown" &&
  parseScannedPayload(null).kind === "unknown");

rmSync(out, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
