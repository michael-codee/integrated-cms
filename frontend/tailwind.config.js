/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        royal: {
          50: '#eef3ff', 100: '#dbe5ff', 200: '#bccdfd', 300: '#8eaafa', 400: '#5b7ff4', 500: '#3459ea',
          600: '#2443d4', 700: '#1d3fa6', 800: '#1c3485', 900: '#1b2f69', 950: '#121d40',
        },
        gold: {
          50: '#fffbea', 100: '#fff3c4', 200: '#ffe78a', 300: '#ffd54a', 400: '#fdc31d', 500: '#f2a807',
          600: '#d68002', 700: '#b15a06', 800: '#90450c', 900: '#76390d',
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'system-ui', 'sans-serif'],
        serif: ['Lora', 'Georgia', 'serif'],
      },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)' },
    },
  },
  plugins: [],
};
