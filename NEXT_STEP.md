# NUMPAY: Next Step

> Current mobile UI work: [September 17 resume](NUMPAY_UI_RESUME_2026-09-17.md).
> The whole-mobile redesign is authorized. Read that note before the older
> planning material below.

> Historical May planning page. For the September BPAN task, read
> [Fresh Base BPAN status](NUMPAY_BPAN_BASE_2026-09-06.md). For the latest
> recorded Android release/distribution state, read
> [July 31 APK notes](NUMPAY_APK_DISTRIBUTION_2026-07-31.md).

Last updated: 2026-05-22, end of session, mid-Phase-0.

This file is the single page to read on resume. It assumes the reader has read `NUMPAY_CC_KICKOFF.md` and `CHANGELOG.md`.

## Where we are

Phase 0 docs are written. Sanity check delivered to Thomas. Work paused at Thomas's request for a break. Test-area scripts not yet written. No production code written. No remote push.

State on disk:

```
docs/THREAT_MODEL.md           done
docs/ARCHITECTURE_DECISIONS.md done
docs/SECURITY_REQUIREMENTS.md  done
docs/CHAIN_SUPPORT_MATRIX.md   done
docs/POC_PLAN.md               done
docs/LOCAL_DEV_SETUP.md        done
test-area/                     not yet created
extension/, web/, backend/     not yet created (Phase 1)
```

Mode is still `CRITICAL_CODE`.

## What to do when work resumes

### Step 1. Read Thomas's review of the sanity check.

He has the summary already. He may have decisions on the items in section "Open items" of `CHANGELOG.md`. Apply any of those before moving on.

### Step 2. Write the four `test-area/` scripts.

Per the kickoff, the canonical Phase 0 file list is:

```
test-area/verify_numpay_id_checksum.ts       Verhoeff. Must pass.
test-area/verify_address_binding_signatures.ts  Runnable skeleton. Phase 0 may pass-skip.
test-area/verify_payment_intent_signatures.ts   Runnable skeleton. Phase 0 may pass-skip.
test-area/verify_no_secret_logging.ts           Scans the tree. Must pass.
```

Set up tooling first: a small `package.json` in `test-area/` with `tsx` and pinned deps. Run `pnpm audit` after install. Write the four scripts. Run them. Save real output under `test-area/results/`.

The checksum and no-secret-logging scripts MUST pass at Phase 0 exit. The binding and payment-intent scripts can target stubbed functions; what matters is that they run and would fail loud if the real implementation regresses.

### Step 3. HARD STOP and report.

Per the kickoff: after Phase 0 docs and scripts exist, stop for one review before any production code. Wait for Thomas to say "GO Phase 1." Do not scaffold the extension, backend, or web app until that approval lands.

Report contents:
- Confirm the four scripts run, paste real output.
- Confirm `pnpm audit` is clean or list waived items.
- Summarise any deltas from the doc set caused by writing the scripts.
- Restate the open items waiting for Thomas.

### Step 4 onwards. Only on "GO Phase 1."

Then start the M1 milestone from `docs/POC_PLAN.md`: repo scaffold, workspaces, Docker Compose, lint, vitest.

## Open items waiting for Thomas

Carried from the sanity check, in order of how much they shape next decisions:

1. **Argon2id library.** Adopt the proposed fix (use `@noble/hashes` argon2id, drop `argon2-browser`)? Confirm.
2. **The four open ADRs**, even if confirmed as "keep PoC defaults": ADR-016 rotation, ADR-017 multiple IDs per user, ADR-018 business ranges and verified profiles, ADR-019 launch jurisdictions.
3. **Mnemonic length.** 12 only, or 12+24 as a user option for v1?
4. **Dev TLS choice.** mkcert, caddy, or plain http on localhost for the dev `api.numpay.local`?
5. **Rate-limit values.** Adopt the starting numbers in `SECURITY_REQUIREMENTS.md` section 4, or tune now?

None of these block writing the four `test-area/` scripts.

## Hard rules still in effect

- No code outside `docs/` and `test-area/` until "GO Phase 1."
- No remote push, no git push, no GitHub.
- No mainnet RPC, anywhere, ever in v1.
- No telemetry, no third-party SDK.
- No `<all_urls>` in any manifest.
- No custodial features. No fiat. No swaps.
- Output rules from `CLAUDE.md`: no em-dash, no en-dash separators in any client-facing or doc text.

## How to verify state on resume

Quick check the resumer can run to confirm nothing changed under their feet:

```
ls docs/
ls test-area/ 2>/dev/null  # should not exist yet, or only contain Phase 0 scripts
git status                  # should show only the doc set as new files if a local git was init'd
```

If anything is unexpected (a `node_modules/` somewhere, an unfamiliar branch, an extra file under `docs/`), investigate before touching anything.

## Contact points in the doc set

- Trust-model decision: `docs/THREAT_MODEL.md` section 4.2.
- Phase 1 exit criteria: `docs/POC_PLAN.md` section 6.
- CSP enforcement target: `docs/SECURITY_REQUIREMENTS.md` section 2.1.
- Open ADRs: `docs/ARCHITECTURE_DECISIONS.md` ADR-016 through ADR-019.
- Local dev hostnames: `docs/LOCAL_DEV_SETUP.md` section 3.
