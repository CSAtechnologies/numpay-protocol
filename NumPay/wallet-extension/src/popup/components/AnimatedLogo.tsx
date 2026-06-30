const NP_PURPLE = "#786EE9";

/**
 * Pure-vector NumPay mark that builds itself once on mount: the purple tile
 * forms in, the white "N" snake-draws along its single centerline (up the left
 * bar, down the diagonal, up the right bar), then the foot/dash bounces up into
 * place. Geometry traced from public/logo.png and normalized to a 100x100
 * viewBox; the tile fills the icon (6..94) so it reads as the real app-icon
 * mark, with a soft purple drop-shadow (see .npl-svg in index.css).
 *
 * No JS animation loop and no remote assets — all motion lives in CSS keyframes
 * (see src/popup/index.css, ".npl-*"). The reveal mask is stroked wide with
 * round caps so the final N is 100% solid (no mask seams). Under
 * prefers-reduced-motion the keyframes are skipped and the final static mark
 * renders as-is. Shared by Unlock and the onboarding pages so the animated
 * mark is identical everywhere.
 */
export default function AnimatedLogo({ size = 76 }: { size?: number }) {
  return (
    <svg
      className="npl-svg"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="NumPay"
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        {/* Snake centerline used as a reveal mask. White = visible; as the
            stroke draws (dashoffset 1000 -> 0) it uncovers the N body. Stroked
            wide with round caps so the final body polygon is 100% revealed
            (crisp, no mask seams). */}
        <mask id="npl-reveal" maskUnits="userSpaceOnUse">
          <path
            className="npl-snake"
            d="M28.33 62.3 L28.33 22.93 L71.48 62.68 L71.48 23.12"
            fill="none"
            stroke="#fff"
            strokeWidth={14}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1000}
          />
        </mask>
      </defs>

      {/* Rounded-square brand tile (full-bleed app icon) */}
      <rect className="npl-tile" x="6" y="6" width="88" height="88" rx="13.2" ry="13.2" fill={NP_PURPLE} />

      {/* N body — left bar, diagonal and right bar as ONE crisp polygon (outline
          traced from logo.png). The two bars float above the foot. Revealed by
          the snake mask, so the final edges are exactly this polygon. */}
      <path
        mask="url(#npl-reveal)"
        fill="#fff"
        d="M23.22 22.93 L35.14 22.93 L66.37 53.79 L66.56 23.12 L76.4 23.12 L76.4 62.68 L60.88 62.68 L33.63 35.62 L33.44 62.3 L23.22 62.3 Z"
      />

      {/* Foot — the dash with the triangular bump that rises toward the
          diagonal. Bounces up into place after the N finishes drawing. */}
      <path
        className="npl-foot"
        fill="#fff"
        d="M41.39 53.3 L56.72 67.98 L76.4 67.98 L76.4 77.07 L23.22 77.07 L23.22 67.98 L41.39 67.98 Z"
      />
    </svg>
  );
}
