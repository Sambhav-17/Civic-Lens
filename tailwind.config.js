/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        midnight: '#070B14',
        surface: { DEFAULT: '#101827', 2: '#162033', 3: '#1D2940' },
        cyan: { DEFAULT: '#36D9FF', soft: '#36D9FF1f' },
        safety: '#FF9D42',
        critical: '#FF4D5A',
        success: '#48E0A4',
        ink: { DEFAULT: '#F4F7FC', 2: '#9AA8BD', 3: '#6B7A90' },
        line: 'rgba(154,168,189,0.14)',
      },
      fontFamily: {
        sans: ['Manrope', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { xl2: '1.25rem' },
      boxShadow: {
        glow: '0 0 0 1px rgba(54,217,255,.25), 0 10px 40px -12px rgba(54,217,255,.45)',
        panel: '0 1px 0 0 rgba(255,255,255,.04) inset, 0 24px 60px -24px rgba(0,0,0,.6)',
      },
      keyframes: {
        ping2: { '0%': { transform: 'scale(1)', opacity: '.7' }, '100%': { transform: 'scale(2.6)', opacity: '0' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: { ping2: 'ping2 1.8s cubic-bezier(0,0,.2,1) infinite', shimmer: 'shimmer 1.6s infinite' },
    },
  },
  plugins: [],
};
