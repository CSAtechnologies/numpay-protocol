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
import nacl from "tweetnacl";

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
const solChain = await bundle("../packages/core/src/chains/solana.ts", "solanaChain");
const engine = await bundle("../packages/core/src/dapp/signEngine.ts", "signEngine");
const solEngine = await bundle("../packages/core/src/dapp/solEngine.ts", "solEngine");

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

// ── signEngine.previewDappRequest: validation + binding, NEVER throw ──
{
  const preview = engine.previewDappRequest;
  const ACC = "0x1111111111111111111111111111111111111111";
  const OTHER = "0x2222222222222222222222222222222222222222";
  const native = { symbol: "ETH", decimals: 18 };
  const base = { chainId: 1, account: ACC, native };

  // personal_sign, both param orders, address bound to the connected account.
  const ps = preview({ method: "personal_sign", params: ["0x68656c6c6f", ACC], ...base });
  ok(ps.ok === true && ps.detail.kind === "personal_sign", "preview personal_sign ok");
  ok(ps.ok && ps.detail.message.isUtf8 === true, "preview personal_sign decodes utf8");
  const psRev = preview({ method: "personal_sign", params: [ACC, "0x68656c6c6f"], ...base });
  ok(psRev.ok === true, "preview personal_sign reversed param order ok");

  // Address mismatch is rejected, not silently signed by the wrong key.
  const mism = preview({ method: "personal_sign", params: ["0x68656c6c6f", OTHER], ...base });
  ok(mism.ok === false && mism.code === 4100, "preview address mismatch -> 4100");

  // eth_sign (blind sign) and any unknown method are unsupported.
  ok(preview({ method: "eth_sign", params: [ACC, "0xdead"], ...base }).code === 4200, "preview eth_sign -> 4200 unsupported");
  ok(preview({ method: "wallet_scam", params: [], ...base }).code === 4200, "preview unknown method -> 4200");

  // typed data: valid parses + risk surfaces; Permit2 warns.
  const permit2 = JSON.stringify({
    types: { EIP712Domain: [], PermitSingle: [{ name: "a", type: "uint256" }] },
    primaryType: "PermitSingle",
    domain: { name: "Permit2", chainId: 1, verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3" },
    message: { a: "1" },
  });
  const td = preview({ method: "eth_signTypedData_v4", params: [ACC, permit2], ...base });
  ok(td.ok === true && td.detail.kind === "typed_data", "preview typed data ok");
  ok(td.ok && td.risk.some((f) => f.level === "warn"), "preview Permit2 typed data -> warn");
  ok(preview({ method: "eth_signTypedData_v4", params: [ACC, "not json"], ...base }).ok === false, "preview typed data bad json -> reject");

  // eth_sendTransaction: value formatted with native currency, from bound.
  const stx = preview({ method: "eth_sendTransaction", params: [{ to: OTHER, value: "0xde0b6b3a7640000" }], ...base });
  ok(stx.ok === true && stx.detail.kind === "send_tx", "preview send_tx ok");
  ok(stx.ok && stx.detail.valueLabel === "1 ETH", "preview send_tx value label 1 ETH");
  ok(stx.ok && stx.detail.tx.from.toLowerCase() === ACC, "preview send_tx binds from to account");
  const approveData = "0x095ea7b3" + "0".repeat(24) + OTHER.slice(2) + "f".repeat(64);
  const stxApprove = preview({ method: "eth_sendTransaction", params: [{ to: OTHER, data: approveData }], ...base });
  ok(stxApprove.ok && stxApprove.risk.some((f) => f.level === "warn"), "preview unlimited approve -> warn");
  ok(preview({ method: "eth_sendTransaction", params: [{}], ...base }).ok === false, "preview empty tx (no to/data) -> reject");

  // Fuzz: junk method/params must never throw and always yield a typed result.
  let bad = 0;
  const junk = [null, undefined, 42, "x", {}, [], [null], [{}], [1, 2, 3]];
  for (let i = 0; i < 3000; i++) {
    const m = junk[(Math.random() * junk.length) | 0];
    const p = junk[(Math.random() * junk.length) | 0];
    try {
      const r = preview({ method: m, params: p, chainId: (Math.random() * 1e9) | 0, account: ACC, native });
      if (typeof r.ok !== "boolean") bad++;
    } catch {
      bad++;
    }
  }
  ok(bad === 0, "fuzz: 3000 junk previews, no throw + always typed (saw " + bad + ")");
}

// ── signEngine.signDappRequest: routes to the signer with normalized args ──
{
  const sign = engine.signDappRequest;
  const ACC = "0x1111111111111111111111111111111111111111";
  const calls = [];
  const mockSigner = {
    signMessage: async (bytes) => { calls.push(["signMessage", bytes]); return "0xSIG_MSG"; },
    signTypedData: async (domain, types, message) => { calls.push(["signTypedData", domain, types, message]); return "0xSIG_TYPED"; },
    sendTransaction: async (txReq) => { calls.push(["sendTransaction", txReq]); return { hash: "0xTXHASH" }; },
  };

  // personal_sign -> signMessage(raw bytes of the message)
  const sig1 = await sign({ method: "personal_sign", params: ["0x68656c6c6f", ACC] }, mockSigner);
  ok(sig1 === "0xSIG_MSG", "sign personal_sign returns signature");
  const passedBytes = calls[0][1];
  ok(passedBytes instanceof Uint8Array && passedBytes.length === 5, "sign personal_sign passes raw 5 message bytes");

  // eth_signTypedData_v4 -> signTypedData with EIP712Domain stripped
  const typed = JSON.stringify({
    types: { EIP712Domain: [{ name: "name", type: "string" }], Mail: [{ name: "x", type: "string" }] },
    primaryType: "Mail", domain: { name: "M", chainId: 1 }, message: { x: "hi" },
  });
  const sig2 = await sign({ method: "eth_signTypedData_v4", params: [ACC, typed] }, mockSigner);
  ok(sig2 === "0xSIG_TYPED", "sign typed data returns signature");
  const [, dom, types, msg] = calls[1];
  ok(!("EIP712Domain" in types) && "Mail" in types, "sign typed data strips EIP712Domain");
  ok(dom.name === "M" && msg.x === "hi", "sign typed data forwards domain + message");

  // eth_sendTransaction -> sendTransaction(normalized), returns tx hash
  const hash = await sign({ method: "eth_sendTransaction", params: [{ from: ACC, to: "0x2222222222222222222222222222222222222222", value: "0x1", gas: "0x5208" }] }, mockSigner);
  ok(hash === "0xTXHASH", "sign send_tx returns tx hash");
  const sentTx = calls[2][1];
  ok(sentTx.to && sentTx.value === "0x1" && sentTx.gasLimit === "0x5208" && sentTx.from === undefined, "sign send_tx normalizes gas->gasLimit and drops from");
}

// ── solEngine: WalletConnect solana requests (preview + sign) ──
// Shared fixtures: a real ed25519 keypair as the connected account, and a
// hand-built serialized legacy transaction (compact-u16 sig count + zeroed
// signature slots + message) so the fee-payer bind is exercised on the same
// byte layout signSolanaTransaction parses.
{
  const kp = nacl.sign.keyPair();
  const other = nacl.sign.keyPair();
  const ACC = bs58.encode(kp.publicKey);

  // All compact-u16 values in the builder are < 128, so they encode as 1 byte.
  function buildSolTx(feePayerBytes, numSigs = 1) {
    const keys = [feePayerBytes, new Uint8Array(32)]; // payer + system program
    const message = Uint8Array.from([
      numSigs, 0, 1,                    // header
      keys.length,                      // key count
      ...keys.flatMap((k) => [...k]),
      ...new Array(32).fill(7),         // recent blockhash
      1,                                // instruction count
      1,                                // programIdIndex -> system program
      1, 0,                             // 1 account index: fee payer
      2, 9, 9,                          // 2 data bytes
    ]);
    const tx = new Uint8Array(1 + numSigs * 64 + message.length);
    tx[0] = numSigs;                    // sig-count varint, slots left zeroed
    tx.set(message, 1 + numSigs * 64);
    return tx;
  }
  const txB64 = Buffer.from(buildSolTx(kp.publicKey)).toString("base64");

  // chain-id helpers
  const { isSolanaMainnetCaip2, SOL_MAINNET_CAIP2, SOL_MAINNET_CAIP2_LEGACY } = solEngine;
  ok(isSolanaMainnetCaip2(SOL_MAINNET_CAIP2) === true, "sol caip2 canonical mainnet accepted");
  ok(isSolanaMainnetCaip2(SOL_MAINNET_CAIP2_LEGACY) === true, "sol caip2 legacy mainnet accepted");
  ok(isSolanaMainnetCaip2("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1") === false, "sol caip2 devnet rejected");
  ok(isSolanaMainnetCaip2("eip155:1") === false, "sol caip2 evm id rejected");
  ok(isSolanaMainnetCaip2(null) === false, "sol caip2 non-string rejected");

  // preview: solana_signMessage
  const preview = solEngine.previewSolanaDappRequest;
  const helloB58 = bs58.encode(Buffer.from("hello"));
  const pm = preview({ method: "solana_signMessage", params: { message: helloB58, pubkey: ACC }, account: ACC });
  ok(pm.ok === true && pm.detail.kind === "sol_message", "sol preview signMessage ok");
  ok(pm.ok && pm.detail.message.isUtf8 === true && pm.detail.message.text === "hello", "sol preview decodes utf8 hello");
  ok(preview({ method: "solana_signMessage", params: { message: helloB58 }, account: ACC }).ok === true, "sol preview pubkey omitted -> bound to account");
  ok(preview({ method: "solana_signMessage", params: { message: helloB58, pubkey: bs58.encode(other.publicKey) }, account: ACC }).code === 4100, "sol preview pubkey mismatch -> 4100");
  ok(preview({ method: "solana_signMessage", params: {}, account: ACC }).ok === false, "sol preview missing message -> reject");
  ok(preview({ method: "solana_signMessage", params: { message: "not base58 0OIl!" }, account: ACC }).ok === false, "sol preview non-base58 message -> reject");
  ok(preview({ method: "solana_signMessage", params: { message: "1".repeat(128 * 1024 + 1) }, account: ACC }).ok === false, "sol preview oversized message -> reject");
  ok(preview({ method: "solana_signMessage", params: [helloB58, ACC], account: ACC }).ok === false, "sol preview array params (spec violation) -> reject");

  // preview: unsupported methods (incl. EVM methods on a solana chain)
  ok(preview({ method: "solana_requestAirdrop", params: {}, account: ACC }).code === 4200, "sol preview unknown sol method -> 4200");
  ok(preview({ method: "personal_sign", params: {}, account: ACC }).code === 4200, "sol preview evm method -> 4200");

  // preview: solana_signAllTransactions (sign-only batch)
  const batch = preview({ method: "solana_signAllTransactions", params: { transactions: [txB64, txB64] }, account: ACC });
  ok(batch.ok === true && batch.detail.kind === "sol_tx_batch", "sol preview batch ok");
  ok(batch.ok && batch.detail.inspections.length === 2 && batch.detail.feePayerMismatch === false, "sol preview batch inspects each tx");
  const foreignB64 = Buffer.from(buildSolTx(other.publicKey)).toString("base64");
  const batchMix = preview({ method: "solana_signAllTransactions", params: { transactions: [txB64, foreignB64] }, account: ACC });
  ok(batchMix.ok === true && batchMix.detail.feePayerMismatch === true, "sol preview batch: one foreign payer flags the whole batch");
  ok(preview({ method: "solana_signAllTransactions", params: { transactions: [] }, account: ACC }).ok === false, "sol preview empty batch -> reject");
  ok(preview({ method: "solana_signAllTransactions", params: { transactions: new Array(11).fill(txB64) }, account: ACC }).ok === false, "sol preview oversized batch (11) -> reject");
  ok(preview({ method: "solana_signAllTransactions", params: { transactions: [txB64, 42] }, account: ACC }).ok === false, "sol preview non-string in batch -> reject");
  ok(preview({ method: "solana_signAllTransactions", params: { transactions: ["!!!"] }, account: ACC }).ok === false, "sol preview bad base64 in batch -> reject");

  // preview: solana_signTransaction / signAndSend
  const pt = preview({ method: "solana_signTransaction", params: { transaction: txB64 }, account: ACC });
  ok(pt.ok === true && pt.detail.kind === "sol_tx" && pt.detail.send === false, "sol preview signTransaction ok, send=false");
  ok(pt.ok && pt.detail.feePayerMismatch === false, "sol preview fee payer matches account");
  ok(pt.ok && pt.detail.inspection.instructionCount === 1, "sol preview inspects 1 instruction");
  ok(pt.ok && pt.detail.inspection.programs.some((p) => p.id === bs58.encode(new Uint8Array(32))), "sol preview lists the program id");
  const ps2 = preview({ method: "solana_signAndSendTransaction", params: { transaction: txB64 }, account: ACC });
  ok(ps2.ok === true && ps2.detail.kind === "sol_tx" && ps2.detail.send === true, "sol preview signAndSend -> send=true");
  const mism = preview({ method: "solana_signTransaction", params: { transaction: txB64 }, account: bs58.encode(other.publicKey) });
  ok(mism.ok === true && mism.detail.feePayerMismatch === true, "sol preview foreign fee payer -> mismatch flagged");
  ok(preview({ method: "solana_signTransaction", params: {}, account: ACC }).ok === false, "sol preview missing transaction -> reject");
  ok(preview({ method: "solana_signTransaction", params: { transaction: "!!!not-base64!!!" }, account: ACC }).ok === false, "sol preview bad base64 -> reject");
  ok(preview({ method: "solana_signTransaction", params: { transaction: "A".repeat(128 * 1024 + 4) }, account: ACC }).ok === false, "sol preview oversized transaction -> reject");

  // preview fuzz: junk must never throw and always yield a typed result.
  {
    let bad = 0;
    const junk = [null, undefined, 42, "x", {}, [], [null], { message: 7 }, { transaction: {} }, { message: "@@", pubkey: 3 }];
    for (let i = 0; i < 2000; i++) {
      const m = junk[(Math.random() * junk.length) | 0];
      const p = junk[(Math.random() * junk.length) | 0];
      try {
        const r = preview({ method: m, params: p, account: ACC });
        if (typeof r.ok !== "boolean") bad++;
      } catch {
        bad++;
      }
    }
    ok(bad === 0, "fuzz: 2000 junk sol previews, no throw + always typed (saw " + bad + ")");
  }

  // sign: solana_signMessage produces a verifiable detached ed25519 signature
  const sign = solEngine.signSolanaDappRequest;
  const rm = await sign({ method: "solana_signMessage", params: { message: helloB58, pubkey: ACC }, account: ACC }, kp.secretKey);
  const msgSig = bs58.decode(rm.signature);
  ok(msgSig.length === 64, "sol sign message signature is 64 bytes");
  ok(nacl.sign.detached.verify(Buffer.from("hello"), msgSig, kp.publicKey), "sol sign message signature verifies");
  ok(rm.transaction === undefined, "sol sign message result has no transaction field");

  // sign: solana_signTransaction signs slot 0 and returns both fields
  const rt = await sign({ method: "solana_signTransaction", params: { transaction: txB64 }, account: ACC }, kp.secretKey);
  const signed = Buffer.from(rt.transaction, "base64");
  const slotSig = signed.subarray(1, 65);
  const msgBytes = signed.subarray(1 + 64);
  ok(Buffer.from(bs58.decode(rt.signature)).equals(slotSig), "sol sign tx: result signature == slot 0 signature");
  ok(nacl.sign.detached.verify(msgBytes, slotSig, kp.publicKey), "sol sign tx: slot 0 signature verifies over the message");

  // sign: solana_signAllTransactions signs every slot 0, order preserved
  const rb = await sign({ method: "solana_signAllTransactions", params: { transactions: [txB64, txB64] }, account: ACC }, kp.secretKey);
  ok(Array.isArray(rb.transactions) && rb.transactions.length === 2, "sol sign batch returns both txs");
  {
    let allOk = true;
    for (const sB64 of rb.transactions) {
      const bytes = Buffer.from(sB64, "base64");
      const s = bytes.subarray(1, 65);
      const m = bytes.subarray(65);
      if (!nacl.sign.detached.verify(m, s, kp.publicKey)) allOk = false;
    }
    ok(allOk, "sol sign batch: every slot-0 signature verifies");
    ok(rb.transactions[0] === rb.transactions[1], "sol sign batch: identical inputs -> identical signed outputs (order/determinism)");
  }
  await throws("sol sign batch foreign fee payer throws", () =>
    sign({ method: "solana_signAllTransactions", params: { transactions: [txB64, Buffer.from(buildSolTx(other.publicKey)).toString("base64")] }, account: ACC }, kp.secretKey));

  // sign: hard gates fire BEFORE any signing / network
  await throws("sol sign tx foreign fee payer throws", () =>
    sign({ method: "solana_signTransaction", params: { transaction: Buffer.from(buildSolTx(other.publicKey)).toString("base64") }, account: ACC }, kp.secretKey));
  await throws("sol signAndSend multi-signer throws before broadcast", () =>
    sign({ method: "solana_signAndSendTransaction", params: { transaction: Buffer.from(buildSolTx(kp.publicKey, 2)).toString("base64") }, account: ACC }, kp.secretKey));
  await throws("sol sign missing message throws", () =>
    sign({ method: "solana_signMessage", params: {}, account: ACC }, kp.secretKey));
}

rmSync(out, { recursive: true, force: true });

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
