/** @type {import('tailwindcss').Config} */

// HERON-Gestaltung
// ────────────────
// Die Farben stammen nicht aus dem Gefühl, sondern aus der Marke: #005A9A und
// #5A5959 sind exakt die beiden Farbwerte der Logodatei, #0064AA und #0E9BD8
// die im Elementor-Kit von heron.at hinterlegten Blautöne.
//
// Die Formensprache ist bewusst rechtwinklig und flach: keine Rundungen, keine
// farbigen Schlagschatten, keine Verläufe. Getrennt wird über Weißraum und
// Haarlinien. Deshalb steht unten `borderRadius` durchgehend auf 0 — so werden
// alle vorhandenen `rounded-*`-Klassen im Markup eckig, ohne dass jede einzelne
// Zeile angefasst werden muss. Nur `full` bleibt rund, für das, was wirklich
// ein Kreis ist (Ziffernmarken, Ladeanzeigen).
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Das HERON-Blau. 500 ist der Logowert, 600 der Webwert von heron.at.
        heron: {
          50:  '#EAF3F9',
          100: '#CFE4F1',
          200: '#9DC8E3',
          300: '#5AA5D0',
          400: '#0E9BD8', // helles Akzentblau aus dem Kit
          500: '#005A9A', // Logo-Blau
          600: '#0064AA', // Web-Blau
          700: '#004E85',
          800: '#003A63',
          900: '#002742',
        },
        // Neutrale, leicht kühle Flächen statt der früheren Cremetöne.
        cream: {
          50:  '#FAFBFC',
          100: '#F2F4F6',
          200: '#E4E8EC',
          300: '#CFD5DB',
          400: '#AEB6BE',
          500: '#8A939C',
        },
        // Schrift und dunkle Flächen. 500 ist das Grau der Wortmarke.
        ink: {
          50:  '#F7F8F9',
          100: '#EDEFF1',
          200: '#D8DCE0',
          300: '#AAB1B8',
          400: '#7B8288',
          500: '#5A5959', // Logo-Grau
          600: '#48494B',
          700: '#333333', // Textfarbe von heron.at
          800: '#232528',
          900: '#16181A',
        },
      },
      fontFamily: {
        // Futura PT in der normalen Breite — keine Condensed. Der Kontrast im
        // Satz entsteht allein über Schnittstärke, Versalien und Laufweite,
        // nicht über eine zweite, schmale Schrift. Das wirkt ruhiger und
        // moderner als der gestauchte Plakatsatz.
        display: ['Futura PT', 'system-ui', 'sans-serif'],
        sans: ['Futura PT', 'system-ui', 'sans-serif'],
        // Futura hat keine dicktengleiche Fassung; für die Prompt-Ausgabe
        // nimmt die Systemschrift den Platz ein.
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        none: '0', sm: '0', DEFAULT: '0', md: '0', lg: '0',
        xl: '0', '2xl': '0', '3xl': '0',
        full: '9999px',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'shimmer': 'shimmer 1.5s linear infinite',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        // Kein Hochskalieren mehr — das Aufploppen war ein gutes Stück des
        // „KI-Looks". Nur noch ein ruhiges Einblenden.
        scaleIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
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
        // Zwei sehr zurückhaltende, neutrale Schatten. Die farbigen
        // Leuchtschatten sind ersatzlos entfallen.
        'card': '0 1px 2px rgba(22,24,26,0.06)',
        'card-hover': '0 2px 8px rgba(22,24,26,0.10)',
      },
    },
  },
  plugins: [],
}
