/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark "control room" palette.
        background: 'hsl(222 47% 5%)', // app base
        card: 'hsl(222 40% 8%)', // surfaces / panels
        muted: 'hsl(220 26% 14%)', // inputs, hovers, elevated fills
        'muted-foreground': 'hsl(215 18% 60%)',
        border: 'hsl(220 24% 17%)',
        foreground: 'hsl(210 40% 98%)', // primary text
        primary: 'hsl(210 40% 98%)',
        accent: 'hsl(239 84% 67%)', // indigo
        'accent-foreground': 'hsl(0 0% 100%)',
      },
      boxShadow: {
        // Soft elevation + a subtle accent glow for emphasis.
        panel: '0 1px 0 0 hsl(220 24% 20% / 0.6), 0 8px 24px -12px hsl(0 0% 0% / 0.7)',
        glow: '0 0 0 1px hsl(239 84% 67% / 0.3), 0 8px 28px -8px hsl(239 84% 67% / 0.45)',
      },
      backgroundImage: {
        'grid-glow':
          'radial-gradient(1200px 600px at 80% -10%, hsl(239 84% 67% / 0.10), transparent 60%), radial-gradient(900px 500px at 0% 0%, hsl(199 89% 55% / 0.06), transparent 55%)',
      },
    },
  },
  plugins: [],
};
