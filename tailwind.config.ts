import type { Config } from 'tailwindcss';
const c = (n: string) => `rgb(var(--${n}) / <alpha-value>)`;
export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { bg: c('bg'), surface: c('surface'), ink: c('ink'), muted: c('muted'), line: c('line'), brand: c('brand'), accent: c('accent'), pop: c('pop') },
      fontFamily: {
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
} satisfies Config;
