/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', 'sans-serif'],
        display: ['"Space Grotesk"', 'sans-serif'],
      },
      colors: {
        brutal: {
          /* Dark Concrete Neo-Brutalism */
          bg: '#1A1A1A',  /* page background */
          surface: '#242424',  /* card / panel surface */
          border: '#3A3A3A',  /* subtle borders between sections */
          accent: '#B8F55A',  /* muted acid-yellow - main accent */
          'accent-dim': '#B8A830',  /* dimmed accent for secondary use */
          bone: '#F5F0E8',  /* primary text / bone-white */
          'bone-dim': '#A09890',  /* muted text */
          /* Legacy aliases (kept for compatibility) */
          yellow: '#B8F55A',
          'yellow-light': '#2A2820',
          black: '#F5F0E8', /* inverted: text on dark bg */
          blue: '#5B9CF6',
          pink: '#F472B6',
          red: '#F87171',
          white: '#F5F0E8',
        },
      },
      boxShadow: {
        'brutal': '4px 4px 0px 0px #000000',
        'brutal-sm': '3px 3px 0px 0px #000000',
        'brutal-none': '0px 0px 0px 0px #000000',
      },
      borderWidth: {
        '2': '2px',
        '3': '3px',
      },
    },
  },
  plugins: [
    function ({ addComponents, addUtilities, theme }) {
      addComponents({
        // Neo-card: bordered card with brutal shadow (dark concrete)
        '.neo-card': {
          backgroundColor: '#242424',
          //border: '1px outset #f5f0e80a',
          boxShadow: '3px 3px 0px 0px #F5F0E8',
          borderRadius: '0px',
        },
        // Neo-btn: button base with active sink effect
        '.neo-btn': {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          fontFamily: '"Space Grotesk", sans-serif',
          fontWeight: '700',
          fontSize: '0.875rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          border: '2px solid #555555',
          boxShadow: '4px 4px 0px 0px #000000',
          padding: '0.625rem 1.25rem',
          cursor: 'pointer',
          transition: 'all 150ms ease',
          userSelect: 'none',
          '&:active': {
            transition: 'transform 30ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 30ms cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: '0px 0px 0px 0px #000000',
            transform: 'translate(4px, 4px)',
          },
          '&:disabled': {
            opacity: '0.4',
            cursor: 'not-allowed',
          },
        },
        // Neo-btn variants
        '.neo-btn-primary': {
          backgroundColor: '#B8F55A',
          color: '#1A1A1A',
          borderColor: '#2A2A2A',
          '&:hover:not(:disabled)': {
            backgroundColor: '#B8F55A',
            borderColor: '#2A2A2A',
            color: '#1A1A1A',
          },
        },
        '.neo-btn-secondary': {
          backgroundColor: '#2A2A2A',
          color: '#F5F0E8',
          '&:hover:not(:disabled)': {
            backgroundColor: '#3A3A3A',
          },
        },
        '.neo-btn-destructive': {
          backgroundColor: '#2A1F1A',
          color: '#F87171',
          borderColor: '#F87171',
          '&:hover:not(:disabled)': {
            backgroundColor: '#F87171',
            color: '#1A1A1A',
          },
        },
        // Neo-input: bordered input (dark concrete)
        '.neo-input': {
          width: '100%',
          fontFamily: '"Space Grotesk", sans-serif',
          fontWeight: '500',
          backgroundColor: '#222222',
          color: '#F5F0E8',
          border: '2px solid #555555',
          padding: '0.625rem 0.875rem',
          fontSize: '1rem',
          outline: 'none',
          borderRadius: '0px',
          transition: 'all 150ms ease',
          '&:focus': {
            boxShadow: '3px 3px 0px 0px #7ABF3A',
            borderColor: '#B8F55A',
          },
          '&::placeholder': {
            color: '#A09890',
            fontWeight: '400',
          },
          // fix calendar/date icons on dark bg
          colorScheme: 'dark',
        },
      });

      addUtilities({
        '.brutal-border': {
          border: '2px solid #555555',
        },
        '.brutal-shadow': {
          boxShadow: '4px 4px 0px 0px #000000',
        },
        '.brutal-shadow-sm': {
          boxShadow: '3px 3px 0px 0px #000000',
        },
        '.text-uppercase-bold': {
          textTransform: 'uppercase',
          fontWeight: '700',
        },
      });
    },
  ],
};
