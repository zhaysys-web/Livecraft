import type { Config } from "tailwindcss";

/**
 * LiveCraft 设计 Tokens
 * 深色沉浸式基底 + 极光渐变点缀 + 玻璃拟态
 */
const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#050508",
          900: "#0a0a11",
          850: "#0e0e16",
          800: "#14141d",
          700: "#1d1d29",
        },
        aurora: {
          violet: "#8b5cf6",
          cyan: "#22d3ee",
          fuchsia: "#e879f9",
          blue: "#60a5fa",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "system-ui",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "sans-serif",
        ],
        display: [
          "var(--font-space-grotesk)",
          "var(--font-inter)",
          "PingFang SC",
          "Hiragino Sans GB",
          "sans-serif",
        ],
      },
      boxShadow: {
        "glow-violet": "0 0 44px -8px rgba(139, 92, 246, 0.55)",
        "glow-cyan": "0 0 44px -8px rgba(34, 211, 238, 0.45)",
        card: "0 8px 40px -12px rgba(0, 0, 0, 0.65)",
      },
      keyframes: {
        "aurora-drift": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(4%, -6%) scale(1.08)" },
          "66%": { transform: "translate(-5%, 4%) scale(0.95)" },
        },
        breathe: {
          "0%, 100%": { opacity: "0.55", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.04)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(139,92,246,0.45)" },
          "70%": { boxShadow: "0 0 0 12px rgba(139,92,246,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(139,92,246,0)" },
        },
      },
      animation: {
        "aurora-drift": "aurora-drift 18s ease-in-out infinite",
        breathe: "breathe 3.2s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
        "pulse-ring": "pulse-ring 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
