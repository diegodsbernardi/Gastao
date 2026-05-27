/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#FFF4ED',
          100: '#FFE6D5',
          500: '#FF6B35',
          600: '#E65A2A',
          700: '#C24A22',
        },
        cream: '#FAF6EE',
        ink: '#2C2C2C',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
