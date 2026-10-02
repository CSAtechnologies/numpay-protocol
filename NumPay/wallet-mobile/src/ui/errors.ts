const TECHNICAL_DETAIL =
  /could not coalesce|jsonrpc|trace-?id|payload\s*[=:]|rpc error|server error|execution reverted|0x[0-9a-f]{64,}|\{\s*"(?:id|code|method|params)"/i;

export function safeActionError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw = typeof error === "string"
    ? error
    : String((error as { reason?: unknown; message?: unknown } | null)?.reason
      ?? (error as { message?: unknown } | null)?.message
      ?? "");

  if (!raw || TECHNICAL_DETAIL.test(raw) || raw.length > 240) {
    return fallback;
  }
  if (/user rejected|user denied|cancelled by user/i.test(raw)) return "Request cancelled.";
  if (/network request failed|failed to fetch|timeout|timed out|unavailable|connection/i.test(raw)) {
    return "The network is unavailable right now. Check your connection and try again.";
  }
  if (/insufficient funds|insufficient balance/i.test(raw)) {
    return "There is not enough balance to cover this action and its network fee.";
  }

  const cleaned = raw.replace(/^error:\s*/i, "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}
