// Shared Send-flow error copy. The extension and mobile render errors with the
// same titled AlertCard pattern (amber vs danger, optional hint, optional
// "nothing was sent" reassurance); keeping the message parsing here means the
// wording and severity of every failure state stays identical across surfaces.

// ethers "could not coalesce error" embeds the entire signed raw tx + RPC
// payload in the message when a node returns a nonstandard rejection (dRPC
// wrapped honest rejections as code 19 "Temporary internal error"). Never
// render that blob in the error banner; and cap anything else to a sane size.
export function friendlyTxError(raw: string): string {
  if (/could not coalesce error|temporary internal error/i.test(raw)) {
    return "The network node reported a temporary error while broadcasting. Check the Activity page before retrying: the transfer may or may not have gone through.";
  }
  return raw.length > 300 ? raw.slice(0, 300) + "…" : raw;
}

// Map the Send flow's raw error strings to a titled card. `safe` shows the
// "nothing was sent" reassurance and is reserved for states where the user
// plausibly fears money moved; form nudges don't need it.
export interface SendErrorView {
  title: string;
  body: string;
  hint?: string;
  tone: "danger" | "amber";
  safe: boolean;
}

export function parseSendError(msg: string): SendErrorView {
  if (/waiting for network confirmation/i.test(msg)) {
    return { title: "Mapping Not Confirmed Yet", body: msg, tone: "amber", safe: false };
  }
  if (/no .* address mapped to bpan/i.test(msg)) {
    return { title: "No Mapping Found", body: msg, tone: "amber", safe: false };
  }
  if (/is not a valid .* address/i.test(msg)) {
    return { title: "Invalid Mapping", body: msg, tone: "danger", safe: false };
  }
  if (/conflicting addresses/i.test(msg)) {
    return { title: "Do Not Send", body: msg, tone: "danger", safe: true };
  }
  if (/independent providers|bpan lookup failed/i.test(msg)) {
    return { title: "Could Not Verify BPAN", body: msg, tone: "amber", safe: true };
  }
  if (/no address is set for/i.test(msg)) {
    return { title: "Name Not Found", body: msg, tone: "amber", safe: false };
  }
  if (/name lookup failed/i.test(msg)) {
    return { title: "Lookup Failed", body: msg, tone: "amber", safe: false };
  }
  if (/address changed/i.test(msg)) {
    return { title: "Address Changed", body: msg, tone: "amber", safe: false };
  }
  if (/insufficient balance|insufficient funds/i.test(msg)) {
    return {
      title: "Insufficient Balance", body: msg,
      hint: "Network fees count against the balance too, so lower the amount slightly.",
      tone: "danger", safe: true,
    };
  }
  if (/wallet is locked|wallet not loaded/i.test(msg)) {
    return { title: "Wallet Locked", body: msg, tone: "amber", safe: false };
  }
  if (/^enter /i.test(msg)) {
    return { title: "Check the Details", body: msg, tone: "amber", safe: false };
  }
  if (/temporary error while broadcasting/i.test(msg)) {
    return { title: "Network Node Error", body: msg, tone: "danger", safe: false };
  }
  return { title: "Transaction Failed", body: msg, tone: "danger", safe: false };
}
