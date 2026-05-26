const path = require("path");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    path.join(__dirname, "src/**/*.{js,ts,jsx,tsx,mdx}"),
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          base: "#0a0912",
          raised: "#110f1e",
          card: "#181530",
          card2: "#201b3d",
        },
        line: {
          DEFAULT: "#2a2450",
          strong: "#3a3268",
        },
        ink: {
          DEFAULT: "#f2f0ff",
          muted: "#8a83b8",
          mute2: "#6b6590",
        },
        brand: {
          50: "#f3f1ff",
          100: "#e7e2ff",
          200: "#d0c7ff",
          300: "#b8acff",
          400: "#a394ff",
          500: "#7c6df0",
          600: "#5b4cdb",
          700: "#4a3db8",
          800: "#382d8a",
          900: "#201b3d",
          950: "#110f1e",
          glow: "rgba(124,109,240,0.35)",
        },
        success: "#34d399",
        amber: "#fbbf24",
        danger: "#f87171",
      },
      fontFamily: {
        sans: ["Geist", "system-ui", "-apple-system", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 8px 24px rgba(124,109,240,0.35)",
        "glow-lg": "0 12px 40px rgba(124,109,240,0.45)",
      },
    },
  },
  plugins: [],
};
