/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                // ── Primary Brand (Indigo) ─────────────────────────────────
                "primary": "#4F46E5",
                "primary-hover": "#4338CA",
                "primary-light": "#EEF2FF",
                "primary-dark": "#3730A3",

                // ── Energy / Celebration (Coral) ───────────────────────────
                "accent": "#E07A5F",
                "accent-hover": "#D6654A",
                "accent-light": "#FDF0EC",

                // ── Page Backgrounds ───────────────────────────────────────
                "page-bg": "#F9F8F6",        // warm off-white — the canvas
                "surface": "#FFFFFF",         // cards, inputs
                "surface-alt": "#F5F2EB",    // slight warm cream for nested areas

                // ── Text ──────────────────────────────────────────────────
                "text-main": "#2D2A26",       // near-black warm brown
                "text-muted": "#6E6962",      // secondary text
                "text-faint": "#A09890",      // placeholder, metadata

                // ── Borders ───────────────────────────────────────────────
                "border-subtle": "#E5E2DC",   // barely-there warm border

                // ── Status / Semantic ──────────────────────────────────────
                "success": "#16A34A",
                "success-light": "#F0FDF4",
                "warning": "#D97706",
                "warning-light": "#FFFBEB",
                "danger": "#DC2626",
                "danger-light": "#FEF2F2",
                "info": "#2563EB",
                "info-light": "#EFF6FF",

                // ── Difficulty badges ──────────────────────────────────────
                "beginner-text": "#15803D",
                "beginner-bg": "#F0FDF4",
                "intermediate-text": "#B45309",
                "intermediate-bg": "#FFFBEB",
                "advanced-text": "#B91C1C",
                "advanced-bg": "#FEF2F2",

                // ── Legacy (kept for blog, legal, admin pages) ─────────────
                "navy": "#1E3A5F",
                "navy-dark": "#152B47",
                "navy-light": "#2A4A70",
                "teal": "#14B8A6",
                "background-light": "#F9F8F6",
                "background-subtle": "#F5F2EB",
                "background-dark": "#1E3A5F",
                "text-primary": "#2D2A26",
                "text-secondary": "#6E6962",
                "text-light": "#2D2A26",
                "text-dark": "#F8FAFC",
                "secondary": "#E07A5F",

                // Neutral scale (for blog/admin)
                "neutral-50":  "#FAFAF9",
                "neutral-100": "#F5F5F4",
                "neutral-200": "#E7E5E4",
                "neutral-300": "#D6D3D1",
                "neutral-400": "#A8A29E",
                "neutral-500": "#78716C",
                "neutral-600": "#57534E",
                "neutral-700": "#44403C",
                "neutral-800": "#292524",
                "neutral-900": "#1C1917",
            },
            fontFamily: {
                "sans":    ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
                "display": ["Lexend", "Inter", "ui-sans-serif", "sans-serif"],
                "body":    ["Noto Sans", "Inter", "sans-serif"],
                "serif":   ["Literata", "Georgia", "serif"],   // story mode
            },
            boxShadow: {
                // Warm-tinted soft shadows
                'soft':     '0 2px 8px 0 rgba(45, 42, 38, 0.06)',
                'card':     '0 4px 16px 0 rgba(45, 42, 38, 0.08)',
                'hover':    '0 8px 24px 0 rgba(45, 42, 38, 0.10)',
                'modal':    '0 24px 64px 0 rgba(45, 42, 38, 0.16)',
                'glow':     '0 0 0 3px rgba(79, 70, 229, 0.15)',
                'glow-accent': '0 0 0 3px rgba(224, 122, 95, 0.20)',
                // Keep legacy
                'xl': '0 20px 25px -5px rgba(0,0,0,0.10), 0 10px 10px -5px rgba(0,0,0,0.04)',
            },
            borderRadius: {
                'xl':  '12px',
                '2xl': '16px',
                '3xl': '20px',
                '4xl': '24px',
            },
            maxWidth: {
                'content': '680px',   // optimal reading line length
                'prose':   '680px',
            },
            animation: {
                'fadeIn':         'fadeIn 0.25s ease-out',
                'slideUp':        'slideUp 0.3s ease-out',
                'float':          'float 6s ease-in-out infinite',
                'pulse-subtle':   'pulse-subtle 2s ease-in-out infinite',
                'bounce-subtle':  'bounce-subtle 2s ease-in-out infinite',
                'shimmer':        'shimmer 1.6s linear infinite',
                'spin-slow':      'spin 2s linear infinite',
                'celebrate':      'celebrate 0.5s ease-out',
            },
            keyframes: {
                fadeIn: {
                    '0%':   { opacity: '0', transform: 'translateY(6px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                slideUp: {
                    '0%':   { opacity: '0', transform: 'translateY(16px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                float: {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%':      { transform: 'translateY(-8px)' },
                },
                'pulse-subtle': {
                    '0%, 100%': { opacity: '1', transform: 'scale(1)' },
                    '50%':      { opacity: '0.8', transform: 'scale(1.03)' },
                },
                'bounce-subtle': {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%':      { transform: 'translateY(-3px)' },
                },
                shimmer: {
                    '0%':   { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                },
                celebrate: {
                    '0%':   { transform: 'scale(0.8)', opacity: '0' },
                    '60%':  { transform: 'scale(1.1)' },
                    '100%': { transform: 'scale(1)', opacity: '1' },
                },
            },
        },
    },
}
