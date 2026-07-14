/**
 * Unit tests for the pure WalletConnect session logic (sessionsCore.ts):
 *
 *   node test/wc-sessions.mjs
 *
 * This is the layer that decides what a session is OFFERED (chains, methods,
 * accounts) and what the user is TOLD about a proposal (origin attestation,
 * unsupported-requirement blocks), so it gets the same treatment as the core
 * dApp engines: bundle the real module with esbuild, drive it with realistic
 * and hostile proposal shapes, exit non-zero on any failure.
 */
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const out = mkdtempSync(join(tmpdir(), "numpay-wc-test-"));
async function bundle(entry, name) {
  const file = join(out, name + ".mjs");
  await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: "esm",
    outfile: file,
    logLevel: "error",
    define: {
      "import.meta.env.VITE_ALCHEMY_KEY": '""',
      "import.meta.env.VITE_MORALIS_KEY": '""',
      "import.meta.env.VITE_GOLDRUSH_KEY": '""',
      "import.meta.env.VITE_HELIUS_KEY": '""',
      "import.meta.env.VITE_API_BASE": '""',
      "import.meta.env.DEV": "false",
    },
  });
  return import(pathToFileURL(file).href);
}

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; console.log("FAIL " + label); }
}
function throwsSync(label, fn) {
  try { fn(); fail++; console.log("FAIL " + label + " (did not throw)"); }
  catch { pass++; }
}

const sc = await bundle("src/walletconnect/sessionsCore.ts", "sessionsCore");

const ACC = "0x1111111111111111111111111111111111111111";
const SOLACC = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const SOL_MAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SOL_LEGACY = "solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ";
const SOL_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

function proposal({ required = {}, optional = {}, verify = "VALID", isScam = false, metadata = "default" } = {}) {
  return {
    id: 1,
    params: {
      proposer: {
        publicKey: "pk",
        metadata: metadata === "default" ? {
          name: "Test dApp", url: "https://dapp.example", icons: ["https://dapp.example/icon.png"],
        } : metadata,
      },
      requiredNamespaces: required,
      optionalNamespaces: optional,
      relays: [{ protocol: "irn" }],
    },
    verifyContext: verify === null ? undefined : {
      verified: { origin: "https://dapp.example", validation: verify, verifyUrl: "", isScam },
    },
  };
}

// ── supportedEip155Chains ──
{
  const chains = sc.supportedEip155Chains();
  ok(chains.includes("eip155:1"), "chains include ethereum mainnet");
  ok(chains.every((c) => /^eip155:\d+$/.test(c)), "chains are all well-formed CAIP-2 eip155 ids");
  ok(new Set(chains).size === chains.length, "chains have no duplicates");
}

// ── buildWcSupportedNamespaces: exactly what NumPay offers ──
{
  const evmOnly = sc.buildWcSupportedNamespaces({ evm: ACC });
  const chains = sc.supportedEip155Chains();
  ok(evmOnly.eip155.accounts.length === chains.length, "offer: one EVM account per supported chain");
  ok(evmOnly.eip155.accounts.every((a, i) => a === `${chains[i]}:${ACC}`), "offer: EVM accounts are chain:address of the connected account");
  for (const m of ["personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"]) {
    ok(evmOnly.eip155.methods.includes(m), `offer: advertises ${m}`);
  }
  ok(evmOnly.eip155.methods.includes("eth_sign"), "offer: compat eth_sign advertised (rejected at request time)");
  ok(evmOnly.eip155.methods.includes("wallet_switchEthereumChain"), "offer: compat switchEthereumChain advertised");
  ok(evmOnly.solana === undefined, "offer: no solana namespace without a solana account");

  const both = sc.buildWcSupportedNamespaces({ evm: ACC, solana: SOLACC });
  ok(Array.isArray(both.solana?.chains) && both.solana.chains.includes(SOL_MAIN) && both.solana.chains.includes(SOL_LEGACY),
    "offer: solana canonical + legacy mainnet ids");
  ok(both.solana.accounts.includes(`${SOL_MAIN}:${SOLACC}`), "offer: solana account on canonical id");
  ok(both.solana.methods.length === 3 && both.solana.methods.includes("solana_signAndSendTransaction"),
    "offer: exactly the three sol methods (no signAllTransactions)");
}

// ── buildSessionNamespaces: intersect a proposal with the offer ──
{
  const bld = (p, accounts) => sc.buildSessionNamespaces(p.params, accounts);

  const evmProposal = proposal({
    required: { eip155: { chains: ["eip155:1"], methods: ["personal_sign"], events: ["accountsChanged"] } },
  });
  const approved = bld(evmProposal, { evm: ACC });
  ok(approved.eip155.accounts.includes(`eip155:1:${ACC}`), "approve: required eip155:1 gets the EVM account");
  ok(approved.eip155.methods.includes("personal_sign"), "approve: negotiated method present");

  throwsSync("approve: required cosmos throws", () =>
    bld(proposal({ required: { cosmos: { chains: ["cosmos:cosmoshub-4"], methods: ["cosmos_signDirect"], events: [] } } }), { evm: ACC }));

  throwsSync("approve: required unknown EVM chain throws", () =>
    bld(proposal({ required: { eip155: { chains: ["eip155:123456789"], methods: ["personal_sign"], events: [] } } }), { evm: ACC }));

  const solProposal = proposal({
    required: { solana: { chains: [SOL_MAIN], methods: ["solana_signTransaction"], events: [] } },
  });
  const approvedSol = bld(solProposal, { evm: ACC, solana: SOLACC });
  ok(approvedSol.solana.accounts.includes(`${SOL_MAIN}:${SOLACC}`), "approve: required solana mainnet gets the sol account");

  throwsSync("approve: required solana without a sol account throws", () =>
    bld(solProposal, { evm: ACC }));

  // Optional namespaces we can't serve must not block the connection.
  const optionalCosmos = proposal({
    required: { eip155: { chains: ["eip155:1"], methods: ["personal_sign"], events: [] } },
    optional: { cosmos: { chains: ["cosmos:cosmoshub-4"], methods: ["cosmos_signDirect"], events: [] } },
  });
  ok(!!bld(optionalCosmos, { evm: ACC }).eip155, "approve: optional unsupported namespace does not block");
}

// ── summarizeProposal: what the user is told ──
{
  const sum = (p, hasSolana = false) => sc.summarizeProposal(p, hasSolana);

  const s1 = sum(proposal({ required: { eip155: { chains: ["eip155:1", "eip155:137"], methods: [], events: [] } } }));
  ok(s1.name === "Test dApp" && s1.url === "https://dapp.example", "summary: metadata passthrough");
  ok(s1.iconUrl === "https://dapp.example/icon.png", "summary: icon passthrough");
  ok(s1.verification === "verified", "summary: VALID -> verified");
  ok(s1.chainNames.includes("Ethereum") && s1.chainNames.includes("Polygon"), "summary: requested chains named");
  ok(s1.unsupportedRequired.length === 0, "summary: supported requirements not flagged");

  ok(sum(proposal({ verify: "INVALID" })).verification === "mismatch", "summary: INVALID -> mismatch");
  ok(sum(proposal({ verify: "UNKNOWN" })).verification === "unverified", "summary: UNKNOWN -> unverified");
  ok(sum(proposal({ verify: null })).verification === "unverified", "summary: missing verify-context -> unverified");
  ok(sum(proposal({ isScam: true, verify: "VALID" })).verification === "scam", "summary: isScam wins over VALID");
  ok(sum(proposal({ metadata: null })).name === "Unknown dApp", "summary: missing metadata -> Unknown dApp");

  const cosmos = sum(proposal({ required: { cosmos: { chains: ["cosmos:cosmoshub-4"], methods: [], events: [] } } }));
  ok(cosmos.unsupportedRequired.includes("cosmos"), "summary: required foreign namespace flagged");

  const badChain = sum(proposal({ required: { eip155: { chains: ["eip155:999999999"], methods: [], events: [] } } }));
  ok(badChain.unsupportedRequired.includes("eip155:999999999"), "summary: required unknown EVM chain flagged");

  const solReq = proposal({ required: { solana: { chains: [SOL_MAIN], methods: [], events: [] } } });
  ok(sum(solReq, true).chainNames.includes("Solana") && sum(solReq, true).unsupportedRequired.length === 0,
    "summary: solana supported when account derived");
  ok(sum(solReq, false).unsupportedRequired.includes(SOL_MAIN), "summary: solana flagged before account derived");
  ok(sum(proposal({ required: { solana: { chains: [SOL_DEVNET], methods: [], events: [] } } }), true)
    .unsupportedRequired.includes(SOL_DEVNET), "summary: solana devnet flagged even with account");

  // CAIP-2-keyed namespace form ("eip155:137" as the key, no chains array).
  const caipKey = sum(proposal({ required: { "eip155:137": { methods: ["personal_sign"], events: [] } } }));
  ok(caipKey.chainNames.includes("Polygon") && caipKey.unsupportedRequired.length === 0,
    "summary: CAIP-2-keyed required namespace resolved");

  // Optional chains show in the summary but never block; names dedupe.
  const dup = sum(proposal({
    required: { eip155: { chains: ["eip155:1"], methods: [], events: [] } },
    optional: { eip155: { chains: ["eip155:1", "eip155:8453"], methods: [], events: [] } },
  }));
  ok(dup.chainNames.filter((n) => n === "Ethereum").length === 1, "summary: chain names deduped");
  ok(dup.chainNames.includes("Base") && dup.unsupportedRequired.length === 0, "summary: optional chains listed, not blocking");

  // Malformed proposals must not throw in the sheet's render path.
  let threw = 0;
  for (const junk of [
    { id: 5, params: {} },
    { id: 6 },
    { id: 7, params: { requiredNamespaces: { eip155: null }, optionalNamespaces: null } },
    { id: 8, params: { proposer: {}, requiredNamespaces: { "": {} } } },
  ]) {
    try {
      const r = sc.summarizeProposal(junk, true);
      if (typeof r.name !== "string" || !Array.isArray(r.chainNames)) threw++;
    } catch { threw++; }
  }
  ok(threw === 0, "summary: malformed proposals never throw (saw " + threw + ")");
}

// ── sessionInfoFrom: the Connected dApps list rows ──
{
  const info = sc.sessionInfoFrom({
    topic: "t1",
    expiry: 1_800_000_000,
    peer: { metadata: { name: "Test dApp", url: "https://dapp.example", icons: ["https://dapp.example/icon.png"] } },
    namespaces: {
      eip155: { accounts: [`eip155:1:${ACC}`, `eip155:1:${ACC}`, `eip155:8453:${ACC}`], methods: [], events: [] },
      solana: { accounts: [`${SOL_MAIN}:${SOLACC}`, `${SOL_LEGACY}:${SOLACC}`], methods: [], events: [] },
    },
  });
  ok(info.topic === "t1" && info.name === "Test dApp", "session info: identity mapped");
  ok(info.expiryMs === 1_800_000_000_000, "session info: expiry seconds -> ms");
  ok(info.chainNames.includes("Ethereum") && info.chainNames.includes("Base"), "session info: EVM chains named");
  ok(info.chainNames.filter((n) => n === "Solana").length === 1, "session info: both sol mainnet ids -> one 'Solana'");
  ok(info.chainNames.filter((n) => n === "Ethereum").length === 1, "session info: duplicate accounts deduped");

  const bare = sc.sessionInfoFrom({ topic: "t2" });
  ok(bare.name === "Unknown dApp" && bare.chainNames.length === 0 && bare.expiryMs === 0,
    "session info: bare struct tolerated");
}

rmSync(out, { recursive: true, force: true });

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
