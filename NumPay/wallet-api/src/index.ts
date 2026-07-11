/**
 * NumPay Wallet API proxy - step 1 skeleton.
 * Spec: NUMPAY_WALLET_API_SPEC_2026-07-04.md (project root).
 *
 * Stateless edge worker. No DB, no request persistence, no logging that
 * pairs an address with an IP (spec section 6).
 */

import { handlePrices } from "./prices";
import { handleTokens } from "./tokens";

const VERSION = "0.3.2";

/** Local shape of the Workers rate-limit binding (fixed-window counter). */
interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  RL_INSTALL: RateLimiter;
  RL_IP: RateLimiter;
  PRICES_KV: KVNamespace;
  /** Comma-separated allowed Origin values. Empty/unset = check skipped (dev). */
  ALLOWED_ORIGINS?: string;
  // Provider keys (secrets). Unused in step 1; wired in from step 2 onward.
  MORALIS_KEY?: string;
  GOLDRUSH_KEY?: string;
  COINGECKO_KEY?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function error(status: number, code: string, headers: Record<string, string> = {}): Response {
  return json({ error: code }, status, headers);
}

/** Origin allow-list. Spoofable outside a browser: a first filter, not a boundary (spec 5). */
function originAllowed(request: Request, env: Env): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  const origin = request.headers.get("Origin");
  return origin !== null && allowed.includes(origin);
}

/**
 * Rate limiting per spec section 5. Fails open: if a limiter binding
 * errors, the request is served rather than dropped.
 */
async function rateLimited(request: Request, env: Env, installId: string | null): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  try {
    if (installId !== null) {
      const { success } = await env.RL_INSTALL.limit({ key: installId });
      if (!success) return true;
    }
    const { success } = await env.RL_IP.limit({ key: ip });
    return !success;
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "GET") return error(405, "method_not_allowed");
    if (!originAllowed(request, env)) return error(403, "forbidden_origin");

    const { pathname } = new URL(request.url);

    // Health carries no install ID and only counts against the IP bucket.
    if (pathname === "/v1/health") {
      if (await rateLimited(request, env, null)) {
        return error(429, "rate_limited", { "Retry-After": "30" });
      }
      return json({
        ok: true,
        service: "numpay-wallet-api",
        version: VERSION,
        // token-meta/token-market were dropped from v1: their upstreams are
        // keyless and scale client-side (spec section 4 amendment).
        upstreams: {
          prices: "live",
          tokens: "live",
        },
      });
    }

    if (!pathname.startsWith("/v1/")) return error(404, "not_found");

    const installId = request.headers.get("X-NumPay-Install");
    if (installId === null || !UUID_RE.test(installId)) {
      return error(400, "missing_or_invalid_install_id");
    }
    if (await rateLimited(request, env, installId)) {
      return error(429, "rate_limited", { "Retry-After": "30" });
    }

    if (pathname === "/v1/prices") return handlePrices(env, ctx);

    const tokensMatch = pathname.match(/^\/v1\/tokens\/([a-z]+)\/([^/]+)$/);
    if (tokensMatch) return handleTokens(tokensMatch[1]!, tokensMatch[2]!, env, ctx);

    return error(404, "not_found");
  },
} satisfies ExportedHandler<Env>;
