import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
          soft: 'rgb(var(--primary-soft) / <alpha-value>)',
          dark: 'rgb(var(--primary-dark) / <alpha-value>)',
        },
        surface: 'rgb(var(--surface) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
      },
      boxShadow: {
        card: '0 1px 3px rgba(15,23,42,.06), 0 8px 24px -12px rgba(15,23,42,.12)',
        float: '0 12px 32px -12px rgba(15,23,42,.25)',
      },
      animation: {
        'fade-in': 'fadeIn .3s ease-out',
        'pop': 'pop .35s cubic-bezier(.2,1.4,.4,1)',
        'scan': 'scan 1.6s ease-in-out infinite',
        'pulse-ring': 'pulseRing 1.8s ease-out infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        pop: { '0%': { opacity: '0', transform: 'scale(.6)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        scan: { '0%,100%': { top: '8%' }, '50%': { top: '88%' } },
        pulseRing: { '0%': { boxShadow: '0 0 0 0 rgba(34,197,94,.45)' }, '100%': { boxShadow: '0 0 0 18px rgba(34,197,94,0)' } },
      },
    },
  },
  plugins: [],
} satisfies Config;
