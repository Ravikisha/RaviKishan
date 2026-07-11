const { violet, blackA, mauve, green } = require('@radix-ui/colors');
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ['"Inter"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        ...mauve,
        ...violet,
        ...green,
        ...blackA,
        // fixed decorative tokens (identical across themes — safe for glows/dots)
        ink: "#0A0B0F",
        panel: "#14161C",
        line: "#23262F",
        mist: "#9AA1B2",
        chalk: "#ECEEF3",
        amber: {
          DEFAULT: "#FFB020",
          soft: "#FFCB5C",
          dim: "#7A5410",
        },
        teal: "#4ED0C0",
        // semantic tokens (CSS vars — flip with light/dark theme)
        bg: "var(--c-bg)",
        surface: "var(--c-surface)",
        edge: "var(--c-edge)",
        muted: "var(--c-muted)",
        fg: "var(--c-fg)",
        accent: "var(--c-accent)",
        accentText: "var(--c-accent-text)",
        accentFg: "var(--c-accent-fg)",
        live: "var(--c-live)",
      },
      keyframes: {
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
        blink: {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0" },
        },
        gridpan: {
          from: { backgroundPosition: "0 0" },
          to: { backgroundPosition: "40px 40px" },
        },
        risein: {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        meteor: {
          "0%": {
            transform: "rotate(var(--angle)) translateX(0)",
            opacity: "1",
          },
          "70%": { opacity: "1" },
          "100%": {
            transform: "rotate(var(--angle)) translateX(-500px)",
            opacity: "0",
          },
        },
        overlayShow: {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
        contentShow: {
          from: { opacity: 0, transform: 'translate(-50%, -48%) scale(0.96)' },
          to: { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
        },
        orbit: {
          "0%": {
            transform:
              "rotate(0deg) translateY(calc(var(--radius) * 1px)) rotate(0deg)",
          },
          "100%": {
            transform:
              "rotate(360deg) translateY(calc(var(--radius) * 1px)) rotate(-360deg)",
          },
        },
      },
      animation: {
        overlayShow: 'overlayShow 150ms cubic-bezier(0.16, 1, 0.3, 1)',
        contentShow: 'contentShow 150ms cubic-bezier(0.16, 1, 0.3, 1)',
        orbit: "orbit calc(var(--duration)*1s) linear infinite",
        meteor: "meteor 5s linear infinite",
        marquee: "marquee var(--marquee-dur, 40s) linear infinite",
        blink: "blink 1s step-end infinite",
        gridpan: "gridpan 6s linear infinite",
        risein: "risein 0.7s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [
    require("tailwindcss-animation-delay"),
  ],
}
