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
        ink: { 900: '#0e1f4d', 950: '#0a1638' },
        river: { 300: '#7cc0f2', 400: '#4aa6ea', 500: '#2a8bd8', 600: '#1d6fb6' },
        mist: '#f3f6fb',
        gold: {
          50: '#fffbea', 100: '#fff3c4', 200: '#ffe78a', 300: '#ffd54a', 400: '#fdc31d', 500: '#f2a807',
          600: '#d68002', 700: '#b15a06', 800: '#90450c', 900: '#76390d',
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'system-ui', 'sans-serif'],
        serif: ['Lora', 'Georgia', 'serif'],
        display: ['Lora', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(14,31,77,.05), 0 1px 3px rgba(14,31,77,.07)',
        lift: '0 6px 18px -6px rgba(14,31,77,.28)',
        btn: '0 1px 0 rgba(255,255,255,.18) inset, 0 2px 6px -2px rgba(29,63,166,.55)',
        'btn-gold': '0 1px 0 rgba(255,255,255,.45) inset, 0 2px 6px -2px rgba(214,128,2,.55)',
      },
      keyframes: {
        ripple: { from: { transform: 'scale(0)', opacity: '0.45' }, to: { transform: 'scale(1)', opacity: '0' } },
        pop: { '0%': { transform: 'scale(.92)' }, '60%': { transform: 'scale(1.04)' }, '100%': { transform: 'scale(1)' } },
        'rail-in': { from: { transform: 'scaleY(0)' }, to: { transform: 'scaleY(1)' } },
        'lower-third': { from: { transform: 'translateX(-8%)', opacity: '0' }, to: { transform: 'translateX(0)', opacity: '1' } },
        'stage-flash': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '.55' } },
      },
      animation: {
        ripple: 'ripple .55s ease-out forwards',
        pop: 'pop .22s ease-out',
        'rail-in': 'rail-in .2s ease-out',
        'lower-third': 'lower-third .45s cubic-bezier(.2,.8,.2,1)',
        'stage-flash': 'stage-flash 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
