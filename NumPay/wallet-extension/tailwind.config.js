/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          200: "#c9beff",
          300: "#a394ff",   // brand-2 (lighter accent)
          400: "#8b7bfb",
          500: "#7c6df0",   // primary brand
          600: "#5b4cdb",
          700: "#4a3dba",
        },
        accent: {
          green: "#34d399",
          red: "#f87171",
          amber: "#fbbf24",
          blue: "#3b82f6",
        },
        surface: {
          0: "var(--surface-0)",
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
          4: "var(--surface-4)",
        },
        border: {
          DEFAULT: "var(--border)",
          light: "var(--border-light)",
        },
        muted: "var(--muted)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
      },
    },
  },
  plugins: [],
};
