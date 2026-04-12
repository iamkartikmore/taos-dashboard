/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef6ff',
          100: '#d9ecff',
          200: '#bbdbff',
          300: '#8dc3ff',
          400: '#57a2ff',
          500: '#2d7cf6',
          600: '#1a5fdb',
          700: '#154ab2',
          800: '#123b5d',
          900: '#0d2a45',
          950: '#07182b',
        },
        success: { light: '#d9ead3', DEFAULT: '#22c55e', dark: '#15803d' },
        warn:    { light: '#fff2cc', DEFAULT: '#f59e0b', dark: '#b45309' },
        danger:  { light: '#fee2e2', DEFAULT: '#ef4444', dark: '#b91c1c' },
        info:    { light: '#dbeafe', DEFAULT: '#3b82f6', dark: '#1d4ed8' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.3), 0 1px 2px -1px rgb(0 0 0 / 0.3)',
        glow: '0 0 20px rgb(45 124 246 / 0.35)',
      },
    },
  },
  plugins: [],
};
