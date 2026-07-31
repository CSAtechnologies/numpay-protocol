/**
 * /download/android/{variant} - a permanent URL for each published APK.
 *
 * WHY THIS EXISTS RATHER THAN LINKING STORAGE DIRECTLY. The site, the in-app
 * "Get the update" button and any QR code all need a download link that outlives
 * the decision about where files are stored. An R2 public bucket hands out a
 * `pub-<hash>.r2.dev` hostname that is not known until the bucket exists, and
 * moving hosts later would strand every link already printed, shared, or baked
 * into a shipped build. A redirect here costs one hop and makes that a
 * one-line change in this file instead.
 *
 * This route sits OUTSIDE /v1/, so it carries no install ID and no rate-limit
 * bucket: it is a public download link that has to work from a browser, a QR
 * scan or a messaging app, none of which will send a wallet's headers. It is
 * also outside the Origin allow-list for the same reason.
 *
 * It never serves bytes. A 302 keeps the file on storage that has free egress
 * and no request-size ceiling, and keeps the worker's own limits irrelevant.
 */

/** Where the published APKs actually live. Empty until storage is set up. */
const TARGETS: Record<string, string> = {
  // Fill each with the public object URL once the bucket exists, e.g.
  //   arm64: "https://pub-<hash>.r2.dev/numpay-6-arm64-v8a.apk",
  // Keep the keys: they are the public URL surface and are already linked from
  // the site and printed on the download page.
  arm64: "",
  arm32: "",
  universal: "",
};

/**
 * Published while the targets are empty, so a premature link says something
 * true and boring instead of 404ing. 503 rather than 404 because the resource
 * is real and not yet available, which is also what stops a search engine or a
 * link checker recording it as permanently gone.
 */
function notYetPublished(): Response {
  return new Response(
    JSON.stringify({
      error: "not_yet_published",
      detail: "This build is not available for download yet.",
    }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

/** Returns null when the path is not a download route. */
export function handleDownload(pathname: string): Response | null {
  const m = pathname.match(/^\/download\/android\/([a-z0-9]+)$/);
  if (m === null) return null;

  const target = TARGETS[m[1]!];
  if (target === undefined) {
    return new Response(
      JSON.stringify({ error: "unknown_variant" }),
      { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }
  if (target === "") return notYetPublished();

  return Response.redirect(target, 302);
}
