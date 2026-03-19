/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        banana: {
          50:  '#FFFBEB',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#F59E0B',
          600: '#D97706',
          700: '#B45309',
          800: '#92400E',
          900: '#78350F',
        },
        cream: {
          50:  '#FAFAF7',
          100: '#F5F3EE',
          200: '#EDE9E0',
          300: '#DDD8CC',
          400: '#C8C1B3',
          500: '#A89E8F',
        },
        ink: {
          50:  '#F8F7F4',
          100: '#EDEAE4',
          200: '#D6D1C8',
          300: '#B3ADA0',
          400: '#8A8278',
          500: '#6B6358',
          600: '#524C42',
          700: '#3D3830',
          800: '#2A2620',
          900: '#1A1714',
        }
      },
      fontFamily: {
        display: ['Syne', 'system-ui', 'sans-serif'],
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'aurora-1': 'aurora1 12s ease-in-out infinite',
        'aurora-2': 'aurora2 16s ease-in-out infinite',
        'aurora-3': 'aurora3 10s ease-in-out infinite',
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'shimmer': 'shimmer 2s linear infinite',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        aurora1: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(40px, -30px) scale(1.08)' },
          '66%': { transform: 'translate(-20px, 20px) scale(0.95)' },
        },
        aurora2: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(-50px, 30px) scale(1.1)' },
          '66%': { transform: 'translate(30px, -40px) scale(0.92)' },
        },
        aurora3: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(25px, 35px) scale(1.06)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.06)',
        'card-hover': '0 4px 8px rgba(0,0,0,0.08), 0 16px 32px rgba(0,0,0,0.1)',
        'banana': '0 4px 24px rgba(245,158,11,0.25), 0 1px 4px rgba(245,158,11,0.1)',
        'banana-lg': '0 8px 40px rgba(245,158,11,0.35), 0 2px 8px rgba(245,158,11,0.15)',
        'inner-banana': 'inset 0 1px 0 rgba(255,255,255,0.15)',
      },
      backgroundImage: {
        'banana-gradient': 'linear-gradient(135deg, #FBBF24 0%, #F59E0B 50%, #D97706 100%)',
        'banana-gradient-soft': 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)',
        'cream-gradient': 'linear-gradient(160deg, #FAFAF7 0%, #F5F3EE 100%)',
      }
    },
  },
  plugins: [],
}
