# NUMPAY: Claude Code Kickoff

You are starting the NUMPAY project. Work in MODE=CRITICAL_CODE for the entire run. This is
security and money-handling software, so correctness and verification beat speed.

## Step 0: Read before doing anything

Read these files in full first. Do not write any code or create any file until you have read all three.

1. `NUMPAY_DEEP_RESEARCH_HANDOFF_2026-05-22.md` is the source of requirements.
2. `CLAUDE_WORKING_PRINCIPLES.md` is how you work (verify, stop-and-ask, sanity checks).
3. `CLAUDE.md` is the standing project guidance (output rules, baselines, boundaries).

Then confirm in one short paragraph that you have read them and state the mode you are in. Do not
summarize the whole handoff back to me.

## Precedence rules (resolve conflicts with these, do not ask me)

- The handoff is requirements, not a command to implement everything blindly.
- Security and the non-custodial principle win over convenience or speed, always.
- Where the handoff's "Open questions" conflict with its "Recommended v1 decisions," the
  recommended decisions win.
- Where `CLAUDE.md` and the handoff differ on output style or baselines, `CLAUDE.md` wins.

## Pre-flight corrections (these resolve known contradictions in the handoff, apply them)

1. **Canonical Phase 0 file list.** The handoff lists files to create in two places that disagree.
   Ignore both partial lists and create exactly this set:
   - `docs/THREAT_MODEL.md`
   - `docs/ARCHITECTURE_DECISIONS.md` (single file; this replaces both the `NUMPAY_ARCHITECTURE_DECISIONS.md` name and the `ARCHITECTURE_DECISION_RECORDS/` directory in the handoff)
   - `docs/SECURITY_REQUIREMENTS.md`
   - `docs/CHAIN_SUPPORT_MATRIX.md`
   - `docs/POC_PLAN.md`
   - `docs/LOCAL_DEV_SETUP.md`
   - `test-area/verify_numpay_id_checksum.ts`
   - `test-area/verify_address_binding_signatures.ts`
   - `test-area/verify_payment_intent_signatures.ts`
   - `test-area/verify_no_secret_logging.ts`

2. **Trust-model gap (highest priority).** The handoff declares the backend untrusted and able to
   be compromised, yet relies on it to prevent alias poisoning via stored bindings and server
   signatures. Signed bindings and server-signed payment intents alone do not stop a compromised
   backend from returning a different, validly self-signed binding for an alias. `THREAT_MODEL.md`
   must address this explicitly and pick an independent integrity anchor. Default approach unless
   you find a stronger one: trust-on-first-use client-side pinning of each alias-to-address
   binding (signed by the alias owner's key at registration, cached locally, re-verified on every
   later resolution), plus a tamper-evident append-only audit log of binding changes. Document the
   choice and its limits in `THREAT_MODEL.md`.

3. **Checksum.** Use Verhoeff, not Luhn (it catches adjacent transposition errors Luhn misses).
   Write deterministic test vectors for it.

4. **Production CSP hostnames.** The handoff's "production headers" example uses `.local`
   hostnames. In `SECURITY_REQUIREMENTS.md` use real placeholder domains (for example
   `https://api.numpay.app`, `wss://api.numpay.app`, and a named RPC allowlist). Keep `.local`
   only in `LOCAL_DEV_SETUP.md`.

5. **Genuinely open questions.** Only these are open: ID rotation (Q1), multiple IDs per user (Q2),
   business number ranges and verified profiles (Q3), and launch jurisdictions (Q10). Do not block
   on them. Record them in `ARCHITECTURE_DECISIONS.md` as "Open, needs Thomas," pick a safe
   reversible default for the PoC (one immutable ID per user, no business ranges, no jurisdiction
   claims, no marketing copy), and move on. All other questions follow the recommended v1 decisions
   and the privacy section.

## Mission for this run

Build the NUMPAY v1 proof of concept, non-custodial, extension-first, exactly as scoped in the
handoff. Phase 1 covers ETH and SOL only on testnet/devnet. BTC, TRON, and XRP are Phase 2 and out
of scope for this run.

## How to work (autonomy rules)

- Work autonomously through every reversible, local step. Do not ask permission to create files,
  scaffold the repo, write tests, install documented dependencies, or run things locally.
- Maintain a visible TODO checklist. Work top to bottom, update it as you go, and keep it accurate.
- Verify, do not guess. For any crypto or chain library API (viem, @solana/web3.js, @scure/bip39,
  @scure/bip32, @noble/*), pull live docs with `use context7` or fetch the official docs. Do not
  rely on training data for these, the APIs drift.
- Never claim a test passes without running it. Run it and paste the real output.
- After installing dependencies, run a dependency audit and pin versions.
- Apply the `CLAUDE.md` output rules to any user-facing UI text (no em-dash, write like a person).
- If you hit a true blocker or an ambiguity that changes architecture, security, or money handling,
  STOP and use the Golden Approach format from the working principles: what you have, what is
  missing, 2 to 3 options, and your recommendation. Then wait.

## Hard stops (pause and wait for my explicit approval)

- After Phase 0 docs exist, STOP for one review before writing any production code. Give me a tight
  summary, the resolved trust-model decision, and the open items. Wait for me to say "GO Phase 1."
  This is the only mandatory mid-run gate.
- Never push to any remote or GitHub. Local only. Local git for your own checkpoints is fine but
  not required.
- Never touch mainnet or real funds. Testnet and devnet only.
- Never add custodial features, server-held keys, fiat rails, or swaps.
- Never request broad extension permissions (no `<all_urls>`) and never use remotely hosted scripts
  or `eval` in the extension.
- Ask before adding any dependency outside the stack documented in the handoff.

## Execution plan

1. **Phase 0 docs.** Create the canonical file set above. `THREAT_MODEL.md` must resolve the
   trust-model gap. `SECURITY_REQUIREMENTS.md` must encode the OWASP API baseline, the strict CSP
   (corrected hostnames), and the "no secret logging" rule. `CHAIN_SUPPORT_MATRIX.md` covers the
   five chains with v1 scope marked. Write the four `test-area` scripts as real, runnable tests
   (they can target stubbed functions at this stage), and make the checksum and no-secret-logging
   tests pass now.
2. **CHECKPOINT.** Stop and report. Wait for "GO Phase 1."
3. **Repo scaffold.** Set up the local workspace per the recommended stack: TypeScript throughout,
   React plus Vite plus Tailwind for the Manifest V3 extension, NestJS plus PostgreSQL plus Redis
   for the backend, an ORM (Prisma or Drizzle, pick one and document it), and Docker Compose for
   local Postgres and Redis. Create the database tables from the handoff schema.
4. **Phase 1 PoC.** Build, in order: extension shell, local encrypted vault (strong KDF, WebCrypto),
   generate and import wallet (BIP-39), derive ETH and SOL addresses, register a NUMPAY ID against
   the local backend, produce and verify an address-binding proof, resolve an ID to an address with
   the TOFU pinning from the threat model, and send one testnet transfer on each of Sepolia and
   Solana devnet. Keep all keys local. The backend stores no secrets.
5. **Verify and report.** Run the `test-area` scripts and the Phase 1 exit-criteria checks. Paste
   real output. Confirm: keys never leave the client, backend stores no secrets, no private key or
   mnemonic appears in any log.

## Definition of done for this run

- All Phase 0 docs exist and the trust-model gap is resolved in writing.
- Repo scaffolds and runs locally via Docker Compose.
- Phase 1 PoC sends a testnet transfer on ETH and SOL with local-only keys.
- `test-area` scripts run and pass, with real output shown.
- A final report lists what was built, test results, decisions made, open items, and the next step.

Begin with Step 0.
