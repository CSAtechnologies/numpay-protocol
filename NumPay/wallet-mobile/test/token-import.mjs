/**
 * Unit tests for the token-import shape gate (src/wallet/tokenDetect.ts):
 *
 *   node test/token-import.mjs
 *
 * The pickers let a user turn a pasted string into a token they can then sell
 * or send, so the gate deciding WHICH CHAIN that lookup runs against is a
 * safety rail, not a convenience. It is the same property the QR parser
 * protects: an address that is valid-looking on the wrong network must be
 * refused with a visible reason, never quietly accepted or silently retargeted.
 *
 * The network calls themselves need a live RPC and are not covered here; what
 * is covered is everything that decides whether a call is made at all, plus
 * the failure text the user is shown when one comes back empty.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = mkdtempSync(join(tmpdir(), "numpay-import-test-"));

// CJS for the same reason as the QR suite: the module reaches core/networks ->
// ethers -> ws, whose dynamic require() an ESM bundle cannot execute.
const file = join(out, "tokenDetect.cjs");
await build({
  entryPoints: [join(root, "src/wallet/tokenDetect.ts")],
  bundle: true,
  format: "cjs",
  outfile: file,
  logLevel: "error",
  platform: "node",
  define: { "process.env.NODE_ENV": '"test"' },
});
const { isTokenAddressFor, looksLikeTokenAddress, detectErrorMessage } =
  createRequire(import.meta.url)(file);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
}

// Real, public addresses so the validators see genuine shapes.
const EVM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";       // vitalik.eth
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";      // USDC on Ethereum
const SOL_MINT = "So11111111111111111111111111111111111111112"; // wrapped SOL
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";              // base58, 34 chars

// ── The chain-safety property ───────────────────────────────────────────────
// An EVM contract address is valid on EVERY EVM chain, so the gate can only
// ever answer "right family", never "right chain". That is why the import card
// names the network it is about to use and the chain row stays the only way to
// change it: the shape check below is not, and cannot be, a network check.
check("EVM address passes on an EVM chain", isTokenAddressFor("ethereum", EVM));
check("EVM address passes on any other EVM chain", isTokenAddressFor("base", USDC));
check("EVM address is REFUSED while Solana is selected", !isTokenAddressFor("solana", EVM));
check("Solana mint passes on Solana", isTokenAddressFor("solana", SOL_MINT));
check("Solana mint passes on Solana (SPL USDC)", isTokenAddressFor("solana", USDC_SOL));
check("Solana mint is REFUSED while an EVM chain is selected",
  !isTokenAddressFor("ethereum", USDC_SOL));

// A Tron address is base58 of Solana's length, so the shape gate alone cannot
// tell them apart. That is exactly why Send offers import on EVM and Solana
// only: on Tron the affordance never appears, so this overlap is unreachable.
check("Tron address is base58-shaped like a mint (documented overlap)",
  isTokenAddressFor("solana", TRON));
check("Tron address is refused on an EVM chain", !isTokenAddressFor("ethereum", TRON));

// ── Junk never opens an import ──────────────────────────────────────────────
for (const junk of [
  "", "   ", "usdc", "USD Coin", "0x", "0xnothex", EVM.slice(0, 20),
  "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA9604",      // 39 hex, one short
  "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA960455",    // 41 hex, one long
  "So" + "1".repeat(29),   // 31 chars, one below the base58 minimum
  "So" + "1".repeat(43),   // 45 chars, one above the maximum
  "l" + SOL_MINT.slice(1), // 'l' is not in the base58 alphabet
  "https://example.com/token/" + EVM,
]) {
  check(`junk is not an address: ${JSON.stringify(junk)}`, !looksLikeTokenAddress(junk));
}

check("EVM address is recognised as an address", looksLikeTokenAddress(EVM));
check("Solana mint is recognised as an address", looksLikeTokenAddress(SOL_MINT));
check("surrounding whitespace does not hide an address",
  looksLikeTokenAddress(`  ${EVM}\n`) && isTokenAddressFor("ethereum", ` ${EVM} `));
check("checksum casing is irrelevant to the shape gate",
  isTokenAddressFor("ethereum", EVM.toLowerCase()) && isTokenAddressFor("ethereum", EVM.toUpperCase().replace("0X", "0x")));

// ── Failure text ────────────────────────────────────────────────────────────
// The overwhelmingly common failure is a real token address on the wrong
// network, and ethers reports it as a decode error. Echoing that verbatim
// tells the user nothing actionable, so it is translated.
check("decode failure blames the network, not the address",
  detectErrorMessage(new Error("could not decode result data (value=\"0x\")"))
    .includes("network"));
check("call revert is treated the same",
  detectErrorMessage(new Error("call revert exception"))
    .includes("network"));
check("BAD_DATA is treated the same",
  detectErrorMessage(new Error("BAD_DATA")).includes("network"));
check("a missing Solana mint gets its own message",
  detectErrorMessage(new Error("Token not found")).toLowerCase().includes("mint"));
check("an unknown error is passed through rather than swallowed",
  detectErrorMessage(new Error("network request failed")) === "network request failed");
check("an error with no message still says something",
  detectErrorMessage({}) === "Could not fetch token info.");
check("a thrown non-error still says something",
  detectErrorMessage(undefined) === "Could not fetch token info.");

rmSync(out, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
