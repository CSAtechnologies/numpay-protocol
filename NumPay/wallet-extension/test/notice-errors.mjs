import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const out = mkdtempSync(join(tmpdir(), "numpay-notices-"));

try {
  const coreEntry = join(out, "errors.cjs");
  await build({
    stdin: {
      contents: [
        'export { parseSwapError } from "./packages/core/src/swap";',
        'export { friendlyTxError, parseSendError } from "./packages/core/src/sendErrors";',
      ].join("\n"),
      resolveDir: root,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: coreEntry,
    logLevel: "error",
  });
  const { parseSwapError, friendlyTxError, parseSendError } = createRequire(import.meta.url)(coreEntry);

  const providerBlob = 'could not coalesce error (error={ "code": 19, "message": "Temporary internal error", "trace-id": "abc" }, payload={"jsonrpc":"2.0","method":"eth_sendRawTransaction","params":["0x' + "12".repeat(180) + '"]})';
  const parsed = parseSwapError(providerBlob, "Bridge");
  assert.equal(parsed.title, "Network Node Error");
  assert.doesNotMatch(parsed.body, /jsonrpc|payload|trace-id|0x12/i);
  assert.doesNotMatch(parsed.hint, /jsonrpc|payload|trace-id|0x12/i);

  const unknownBlob = 'Request rejected: {"transaction":"0x' + "ab".repeat(120) + '","code":-32000}';
  const unknown = parseSwapError(unknownBlob, "Swap");
  assert.doesNotMatch(unknown.body, /\{"transaction"|0xab/i);
  assert.match(unknown.body, /network node reported a temporary error|technical transaction data is shown/i);

  assert.equal(parseSwapError("No bridge routes found", "Bridge").title, "No Route Found");
  assert.equal(parseSendError("waiting for network confirmation").title, "Confirming BPAN Mapping");
  assert.doesNotMatch(friendlyTxError(providerBlob), /jsonrpc|payload|0x12/i);

  const noticeEntry = join(out, "notice.cjs");
  await build({
    entryPoints: [resolve(root, "wallet-extension/src/popup/components/AlertCard.tsx")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: noticeEntry,
    logLevel: "error",
  });
  const { default: AlertCard, InlineNotice } = createRequire(import.meta.url)(noticeEntry);
  const danger = renderToStaticMarkup(React.createElement(AlertCard, {
    title: "Transaction blocked", body: "Review the amount.", tone: "danger",
  }));
  assert.match(danger, /role="alert"/);
  assert.match(danger, /notice-card--danger/);
  assert.doesNotMatch(danger, /Nothing was sent|Try this:/);
  const caution = renderToStaticMarkup(React.createElement(AlertCard, {
    title: "Still confirming", body: "Try again soon.", tone: "amber",
  }));
  assert.match(caution, /role="status"/);
  assert.match(caution, /notice-card--amber/);
  const field = renderToStaticMarkup(React.createElement(InlineNotice, { message: "Check this field." }));
  assert.match(field, /inline-notice--danger/);
  assert.match(field, /role="alert"/);

  console.log("Notice UI and provider-error redaction passed.");
} finally {
  assert.equal(dirname(out), resolve(tmpdir()));
  rmSync(out, { recursive: true, force: true });
}
