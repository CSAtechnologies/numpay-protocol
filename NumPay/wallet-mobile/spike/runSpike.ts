/**
 * RN spike: the go/no-go gate from NUMPAY_MOBILE_PLAN_2026-07-10.md §2.
 *
 * Runs ON DEVICE (Hermes):
 *  1. Runtime probes (getRandomValues, Buffer, TextEncoder/Decoder).
 *  2. The committed 33 address vectors through core's real validator.
 *  3. Derivation of every chain family from the reference mnemonic, compared
 *     byte-for-byte with expected.json generated on desktop by the same core
 *     code (gen-expected.mjs).
 *  4. One signature round trip per signature scheme the wallet uses:
 *     EVM (secp256k1+keccak+RLP via ethers, sign → recover),
 *     Solana (ed25519 detached — the primitive core's hand-rolled sender uses —
 *     plus a @solana/web3.js Transaction sign+verify for the dapp path),
 *     Sui (ed25519 over the SLIP-0010 key), and raw secp256k1 sign/verify with
 *     the BTC / LTC / TRON / XRP derived keys.
 *
 * Everything is offline: no RPC, no broadcast, no funds.
 */
import { ethers } from "ethers";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { argon2id } from "@noble/hashes/argon2";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import argon2 from "react-native-argon2";

import { isValidChainAddress } from "@numpay/core/addressValidation";
import { deriveNonEvmAddresses } from "@numpay/core/chains";
import { importFromMnemonic } from "@numpay/core/wallet";

/* eslint-disable @typescript-eslint/no-var-requires */
const vectors = require("../../wallet-extension/test/address-vectors.json") as Record<
  string,
  { valid: string[]; invalid: string[] } | string
>;
const expected = require("./expected.json") as Record<string, string>;

export interface SpikeResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

export async function runSpike(): Promise<SpikeResult[]> {
  const results: SpikeResult[] = [];
  const t = (name: string, pass: boolean, detail = "") => {
    results.push({ name, pass, detail });
    console.log(`[SPIKE] ${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  };

  // ── 1. Runtime probes ─────────────────────────────────────────────────────
  try {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    t("probe: crypto.getRandomValues", a.some((x) => x !== 0));
  } catch (e) {
    t("probe: crypto.getRandomValues", false, String(e));
  }
  t("probe: Buffer global", typeof Buffer !== "undefined" && Buffer.from("aa", "hex").length === 1);
  t(
    "probe: TextEncoder/TextDecoder",
    typeof TextEncoder !== "undefined" &&
      typeof TextDecoder !== "undefined" &&
      new TextDecoder().decode(new TextEncoder().encode("ok")) === "ok"
  );

  // ── 2. Address vectors through core's validator ──────────────────────────
  let vecPass = 0;
  let vecFail = 0;
  const vecFails: string[] = [];
  for (const [chain, sets] of Object.entries(vectors)) {
    if (typeof sets === "string") continue; // _comment
    for (const a of sets.valid) {
      if (isValidChainAddress(a, chain, false)) vecPass++;
      else { vecFail++; vecFails.push(`${chain} valid rejected: ${a}`); }
    }
    for (const a of sets.invalid) {
      if (!isValidChainAddress(a, chain, false)) vecPass++;
      else { vecFail++; vecFails.push(`${chain} invalid accepted: ${a}`); }
    }
  }
  t(`vectors: ${vecPass}/${vecPass + vecFail} address checks`, vecFail === 0, vecFails.slice(0, 3).join("; "));
  t(
    "vectors: EVM validator",
    isValidChainAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "ethereum", true) &&
      !isValidChainAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb9226", "ethereum", true)
  );

  // ── 3. Derivation parity vs desktop ───────────────────────────────────────
  const MNEMONIC = expected.mnemonic;
  let evm: { address: string; privateKey: string } | null = null;
  try {
    evm = importFromMnemonic(MNEMONIC);
    t("derive: EVM matches desktop", evm.address === expected.evm, evm.address);
  } catch (e) {
    t("derive: EVM matches desktop", false, String(e));
  }

  let non: Awaited<ReturnType<typeof deriveNonEvmAddresses>> | null = null;
  try {
    non = await deriveNonEvmAddresses(MNEMONIC);
  } catch (e) {
    t("derive: non-EVM (all chains)", false, String(e));
  }
  if (non) {
    for (const chain of ["bitcoin", "solana", "sui", "tron", "xrp", "litecoin"] as const) {
      t(`derive: ${chain} matches desktop`, non[chain].address === expected[chain], non[chain].address);
    }
  }

  // ── 4. Signature round trips ──────────────────────────────────────────────
  const msg = new TextEncoder().encode("NumPay RN spike message");

  if (evm) {
    try {
      const w = new ethers.Wallet(evm.privateKey);
      const raw = await w.signTransaction({
        type: 2,
        chainId: 8453,
        nonce: 0,
        to: w.address,
        value: 1n,
        gasLimit: 21000n,
        maxFeePerGas: 1_000_000_000n,
        maxPriorityFeePerGas: 100_000_000n,
      });
      const parsed = ethers.Transaction.from(raw);
      t("sign: EVM tx sign → recover", parsed.from === w.address, parsed.from ?? "no from");
    } catch (e) {
      t("sign: EVM tx sign → recover", false, String(e));
    }
    try {
      const rnd = ethers.Wallet.createRandom();
      t("sign: EVM createRandom (entropy path)", !!rnd.address);
    } catch (e) {
      t("sign: EVM createRandom (entropy path)", false, String(e));
    }
  }

  if (non) {
    try {
      const sig = nacl.sign.detached(msg, non.solana.secretKey);
      const ok = nacl.sign.detached.verify(msg, sig, bs58.decode(non.solana.address));
      t("sign: Solana ed25519 detached (core sender primitive)", ok);
    } catch (e) {
      t("sign: Solana ed25519 detached (core sender primitive)", false, String(e));
    }
    try {
      const kp = Keypair.fromSecretKey(non.solana.secretKey);
      const tx = new Transaction({
        recentBlockhash: bs58.encode(new Uint8Array(32).fill(7)),
        feePayer: kp.publicKey,
      });
      tx.add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 }));
      tx.sign(kp);
      t("sign: Solana web3.js tx sign+verify (dapp path)", tx.verifySignatures());
    } catch (e) {
      t("sign: Solana web3.js tx sign+verify (dapp path)", false, String(e));
    }
    try {
      const sig = nacl.sign.detached(msg, non.sui.secretKey);
      const ok = nacl.sign.detached.verify(msg, sig, non.sui.secretKey.slice(32));
      t("sign: Sui ed25519 (SLIP-0010 key)", ok);
    } catch (e) {
      t("sign: Sui ed25519 (SLIP-0010 key)", false, String(e));
    }
    for (const chain of ["bitcoin", "litecoin", "tron", "xrp"] as const) {
      try {
        const priv = hexToBytes(non[chain].privateKey);
        const digest = sha256(msg);
        const sig = secp256k1.sign(digest, priv);
        const ok = secp256k1.verify(sig.toCompactRawBytes(), digest, secp256k1.getPublicKey(priv));
        t(`sign: ${chain} secp256k1 sign/verify`, ok);
      } catch (e) {
        t(`sign: ${chain} secp256k1 sign/verify`, false, String(e));
      }
    }
  }

  // ── 5. Native argon2 parity (the vault's PIN-stretch KDF) ─────────────────
  // Proves react-native-argon2 (argon2kt/JNI) maps password, hex salt, and
  // params exactly like @noble's argon2id, so the vault's native stretch is
  // the same KDF as the extension vault. Tiny m so the pure-JS reference
  // finishes quickly; the real-params timing shows up on the home screen.
  try {
    const pin = "123456";
    const salt = new Uint8Array(16).map((_, i) => i * 7 + 3);
    const saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, "0")).join("");
    const params = { m: 64, t: 2, p: 1 };
    const t0 = Date.now();
    const native = await argon2(pin, saltHex, {
      mode: "argon2id",
      iterations: params.t,
      memory: params.m,
      parallelism: params.p,
      hashLength: 32,
      saltEncoding: "hex",
    });
    const nativeMs = Date.now() - t0;
    const ref = argon2id(new TextEncoder().encode(pin), salt, { ...params, dkLen: 32 });
    const refHex = Array.from(ref, (b) => b.toString(16).padStart(2, "0")).join("");
    t(
      "argon2: native matches @noble reference",
      native.rawHash === refHex,
      `native ${nativeMs} ms @ m=64; raw ${native.rawHash.slice(0, 16)}…`
    );
  } catch (e) {
    t("argon2: native matches @noble reference", false, String(e));
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`[SPIKE] DONE: ${passed} passed, ${failed} failed`);
  return results;
}
