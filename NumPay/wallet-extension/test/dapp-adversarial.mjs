/**
 * Adversarial test suite for the dApp-layer parsers (P4).
 *
 *   node test/dapp-adversarial.mjs
 *
 * signDecode / txDecode / chainOps all run on UNTRUSTED page input in security-
 * sensitive paths (the approval window render path, the connect/sign/send
 * router). The cardinal rule: a hostile or malformed payload must never throw
 * (which would white-screen the approval) and must reach a safe decision. This
 * bundles the real modules with esbuild and hammers them with junk + a fuzz
 * loop. Exits non-zero on any failure so it can gate CI.
 */
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import bs58 from "bs58";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// Bundle the three modules to a temp dir (type-only imports erase; the Vite
// import.meta.env reads in env.ts are defined away; chrome is absent so
// getCustomChains() falls back to []).
const out = mkdtempSync(join(tmpdir(), "numpay-dapp-test-"));
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
function noThrow(label, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log("FAIL " + label + " threw: " + (e && e.message)); }
}
function throws(label, fn) {
  return fn().then(
    () => { fail++; console.log("FAIL " + label + " (did not throw)"); },
    () => { pass++; }
  );
}

const sign = await bundle("src/lib/dapp/signDecode.ts", "signDecode");
const tx = await bundle("src/lib/dapp/txDecode.ts", "txDecode");
const chain = await bundle("src/lib/dapp/chainOps.ts", "chainOps");
const sol = await bundle("src/lib/dapp/solDecode.ts", "solDecode");
const solChain = await bundle("src/lib/chains/solana.ts", "solanaChain");

// ── signDecode.decodePersonalSignMessage: never throw, correct utf8 detection ──
{
  const d = sign.decodePersonalSignMessage;
  noThrow("personal huge hex", () => d("0x" + "ab".repeat(500000)));
  noThrow("personal null", () => d(null));
  noThrow("personal number", () => d(12345));
  noThrow("personal object", () => d({}));
  noThrow("personal empty 0x", () => d("0x"));
  ok(d("0x68656c6c6f").isUtf8 === true, "personal hex hello is utf8");
  ok(d("hello").isUtf8 === true, "personal plain hello is utf8");
  ok(d("0xfffe").isUtf8 === false, "personal invalid utf8 -> hex");
  ok(d("0x01020304").isUtf8 === false, "personal control bytes -> hex");
  // SIWE-style multi-line message must stay readable (tab/newline allowed).
  const siwe = "0x" + Buffer.from("example.com wants you to sign in\nNonce: 42").toString("hex");
  ok(d(siwe).isUtf8 === true, "personal SIWE multiline is utf8");
}

// ── signDecode.parseTypedData + risk ──
{
  const p = sign.parseTypedData;
  ok(p("not json").ok === false, "typed invalid json -> error");
  ok(p(null).ok === false, "typed null -> error");
  ok(p("{}").ok === false, "typed empty obj -> error");
  ok(p(JSON.stringify({ types: {}, primaryType: "X", message: {} })).ok === false, "typed primaryType missing in types");
  const mail = {
    types: { EIP712Domain: [{ name: "name", type: "string" }], Mail: [{ name: "x", type: "string" }] },
    primaryType: "Mail", domain: { name: "M", chainId: 1 }, message: { x: "hi" },
  };
  const parsed = p(mail);
  ok(parsed.ok === true, "typed valid object ok");
  ok("EIP712Domain" in sign.typesForEthers(parsed.types) === false, "typesForEthers strips EIP712Domain");
  // risk
  const permit2 = p({
    types: { EIP712Domain: [], PermitSingle: [{ name: "a", type: "uint" }] },
    primaryType: "PermitSingle",
    domain: { name: "Permit2", chainId: 1, verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3" },
    message: {},
  });
  ok(sign.assessTypedDataRisk(permit2, 1).some((f) => f.level === "warn"), "Permit2 -> warn");
  const permitName = p({ types: { EIP712Domain: [], Permit: [{ name: "a", type: "uint" }] }, primaryType: "Permit", domain: { chainId: 1 }, message: {} });
  ok(sign.assessTypedDataRisk(permitName, 1).some((f) => f.level === "warn"), "Permit primaryType -> warn");
  ok(sign.assessTypedDataRisk(parsed, 137).some((f) => /chain/i.test(f.text)), "chainId mismatch -> warn");
  ok(sign.assessTypedDataRisk(parsed, 1).length === 0, "benign same-chain Mail -> no warn");
}

// ── txDecode.decodeTxData: NEVER throw + correct flags ──
{
  const dec = tx.decodeTxData;
  noThrow("tx undefined", () => dec(undefined));
  noThrow("tx 0x", () => dec("0x"));
  noThrow("tx short", () => dec("0x0934"));
  noThrow("tx selector only (truncated args)", () => dec("0x095ea7b3"));
  noThrow("tx non-hex calldata", () => dec("0x095ea7b3zzzzzzzz"));
  noThrow("tx huge data", () => dec("0x095ea7b3" + "f".repeat(2000000)));
  const spender = "0x1111111254eeb25477b68fb85ed929f73a960582";
  const approveMax = "0x095ea7b3" + spender.slice(2).padStart(64, "0") + "f".repeat(64);
  ok(/unlimited/i.test(dec(approveMax).summary), "approve max -> unlimited");
  const approve1k = "0x095ea7b3" + spender.slice(2).padStart(64, "0") + (1000).toString(16).padStart(64, "0");
  ok(/1000/.test(dec(approve1k).summary), "approve bounded shows amount");
  const safaOn = "0xa22cb465" + spender.slice(2).padStart(64, "0") + "1".padStart(64, "0");
  ok(dec(safaOn).risk.some((f) => f.level === "warn"), "setApprovalForAll(true) -> warn");
  const safaOff = "0xa22cb465" + spender.slice(2).padStart(64, "0") + "0".padStart(64, "0");
  ok(dec(safaOff).risk.length === 0, "setApprovalForAll(false) -> no warn");
  ok(dec("0xdeadbeef").risk.some((f) => f.level === "info"), "unknown selector -> info");
  ok(dec("0x").hasData === false, "no data -> native transfer");
}

// ── txDecode.formatNativeValue + normalizeTxForEthers ──
{
  const f = tx.formatNativeValue;
  noThrow("format junk hex", () => f("0xzzzz", 18, "ETH"));
  noThrow("format undefined", () => f(undefined, 18, "ETH"));
  ok(f("0x" + (10n ** 18n).toString(16), 18, "ETH") === "1 ETH", "format 1 ETH");
  ok(f("0x0", 18, "ETH") === "0 ETH", "format 0");
  const n = tx.normalizeTxForEthers({ to: "0xabc", data: "0x", value: "0x5", gas: "0x5208", nonce: "0x2" });
  ok(n.gasLimit === "0x5208", "normalize gas->gasLimit");
  ok(!("data" in n), "normalize drops empty data");
  ok(n.nonce === 2, "normalize nonce->number");
}

// ── chainOps ──
{
  ok(chain.parseChainId("0x89") === 137, "parseChainId 0x89");
  ok(chain.parseChainId("0x0") === null, "parseChainId 0x0 -> null");
  ok(chain.parseChainId("nope") === null, "parseChainId junk -> null");
  ok(chain.parseChainId(137) === null, "parseChainId number -> null");
  ok((await chain.resolveInternalChainId(1)) === "ethereum", "resolve 1 -> ethereum");
  ok((await chain.resolveInternalChainId(9999)) === null, "resolve unknown -> null");
  await throws("validateHttpsRpc http", async () => chain.validateHttpsRpc("http://x.com"));
  await throws("validateHttpsRpc junk", async () => chain.validateHttpsRpc("not a url"));
  ok(chain.validateHttpsRpc("https://x.com") === "https://x.com/", "validateHttpsRpc https ok");
  await throws("add built-in collision", async () => chain.buildAddChainCandidate({ chainId: "0x1", rpcUrls: ["https://x"] }));
  await throws("add http rpc", async () => chain.buildAddChainCandidate({ chainId: "0x14a34", rpcUrls: ["http://x"] }));
  await throws("add missing chainId", async () => chain.buildAddChainCandidate({ rpcUrls: ["https://x"] }));
  const cand = await chain.buildAddChainCandidate({ chainId: "0x14a34", chainName: "T", rpcUrls: ["https://t.example"], nativeCurrency: { symbol: "ETH", decimals: 18 } });
  ok(cand.chain.chainId === 84532 && cand.alreadyExists === false, "add new chain candidate");
}

// ── solDecode (Solana signMessage) ──
{
  const d = sol.decodeSolSignMessage;
  noThrow("sol decode junk b64", () => d("!!!!not base64!!!!"));
  noThrow("sol decode empty", () => d(""));
  noThrow("sol decode huge", () => d("QQ".repeat(500000)));
  // round-trip: utf8 text encodes + decodes as readable
  const text = "Sign in to NumPay\nNonce: 9";
  const b64 = sol.bytesToBase64(new TextEncoder().encode(text));
  const dec = d(b64);
  ok(dec.isUtf8 === true && dec.text === text, "sol decode utf8 round-trip");
  // raw bytes -> not utf8
  const rawB64 = sol.bytesToBase64(new Uint8Array([0xff, 0xfe, 0x00, 0x01]));
  ok(d(rawB64).isUtf8 === false, "sol decode raw bytes -> base64");
  // base64ToBytes is throw-safe
  ok(sol.base64ToBytes("###").length === 0, "sol base64ToBytes junk -> empty");
  // byte round-trip
  const bytes = new Uint8Array([1, 2, 3, 250, 0, 128]);
  ok(sol.base64ToBytes(sol.bytesToBase64(bytes)).join(",") === bytes.join(","), "sol byte round-trip");
}

// ── solana.inspectSolanaTransaction (dApp signTransaction preview) ──
{
  const inspect = solChain.inspectSolanaTransaction;
  // Never throw on hostile / malformed transaction bytes (it renders the approval).
  noThrow("sol tx inspect empty", () => inspect(new Uint8Array()));
  noThrow("sol tx inspect short", () => inspect(new Uint8Array([1, 2, 3])));
  noThrow("sol tx inspect all 0xff", () => inspect(new Uint8Array(64).fill(0xff)));
  noThrow("sol tx inspect huge", () => inspect(new Uint8Array(5000).fill(0x80)));
  // Empty / unparseable -> empty fee payer (the signing-time bind then refuses).
  ok(inspect(new Uint8Array()).feePayer === "", "sol tx inspect empty -> no fee payer");

  // Build a valid legacy SystemProgram.transfer and confirm the fee payer + the
  // System program id decode correctly (the bind the approval relies on).
  const cu16 = (n) => (n <= 0x7f ? [n] : [(n & 0x7f) | 0x80, n >> 7]);
  const feePayer = new Uint8Array(32).fill(7);
  const to = new Uint8Array(32).fill(9);
  const sys = new Uint8Array(32); // System program = all zeros
  const blockhash = new Uint8Array(32).fill(3);
  const instrData = new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // transfer, 0 lamports
  const message = [
    1, 0, 1,                       // header
    ...cu16(3), ...feePayer, ...to, ...sys,
    ...blockhash,
    ...cu16(1),                    // 1 instruction
    2,                             // program id index = sys
    ...cu16(2), 0, 1,              // accounts
    ...cu16(instrData.length), ...instrData,
  ];
  const txBytes = new Uint8Array([...cu16(1), ...new Uint8Array(64), ...message]);
  const got = inspect(txBytes);
  ok(got.feePayer === bs58.encode(feePayer), "sol tx inspect decodes fee payer");
  ok(got.numSigs === 1, "sol tx inspect numSigs = 1");
  ok(got.instructionCount === 1, "sol tx inspect instructionCount = 1");
  ok(got.usesLookupTables === false, "sol tx inspect legacy -> no lookup tables");
  ok(got.programs.some((p) => p.name === "System"), "sol tx inspect labels System program");
}

// ── Fuzz: random inputs must never throw the decoders ──
{
  const hexchars = "0123456789abcdefABCDEFxyzZ-_ ";
  function randHex(n) {
    let s = "0x";
    for (let i = 0; i < n; i++) s += hexchars[(Math.random() * hexchars.length) | 0];
    return s;
  }
  let threw = 0;
  for (let i = 0; i < 2000; i++) {
    const data = randHex((Math.random() * 200) | 0);
    try {
      tx.decodeTxData(data);
      sign.decodePersonalSignMessage(data);
      tx.formatNativeValue(data, 18, "ETH");
      sign.parseTypedData(data);
      sol.decodeSolSignMessage(data);
    } catch {
      threw++;
    }
  }
  ok(threw === 0, "fuzz: 2000 random inputs, no throws (saw " + threw + ")");

  // Random raw bytes through the Solana transaction inspector.
  let threwTx = 0;
  for (let i = 0; i < 2000; i++) {
    const len = (Math.random() * 300) | 0;
    const bytes = new Uint8Array(len);
    for (let j = 0; j < len; j++) bytes[j] = (Math.random() * 256) | 0;
    try {
      solChain.inspectSolanaTransaction(bytes);
    } catch {
      threwTx++;
    }
  }
  ok(threwTx === 0, "fuzz: 2000 random tx byte arrays, no throws (saw " + threwTx + ")");
}

rmSync(out, { recursive: true, force: true });

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
