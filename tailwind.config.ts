import type { Config } from "tailwindcss";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
		extend: {
			fontFamily: {
				sans: ['Arial', 'Helvetica', 'sans-serif'],
				mono: ['IBM Plex Mono', 'monospace'],
			},
			colors: {
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				sidebar: {
					DEFAULT: 'hsl(var(--sidebar-background))',
					foreground: 'hsl(var(--sidebar-foreground))',
					primary: 'hsl(var(--sidebar-primary))',
					'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
					accent: 'hsl(var(--sidebar-accent))',
					'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
					border: 'hsl(var(--sidebar-border))',
					ring: 'hsl(var(--sidebar-ring))'
				}
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)'
			},
			keyframes: {
				'accordion-down': {
					from: {
						height: '0'
					},
					to: {
						height: 'var(--radix-accordion-content-height)'
					}
				},
				'accordion-up': {
					from: {
						height: 'var(--radix-accordion-content-height)'
					},
					to: {
						height: '0'
					}
				},
				'fade-in': {
					from: { opacity: '0', transform: 'translateY(16px)' },
					to: { opacity: '1', transform: 'translateY(0)' }
				},
				'scale-in': {
					from: { opacity: '0', transform: 'scale(0.96)' },
					to: { opacity: '1', transform: 'scale(1)' }
				},
				'float': {
					'0%, 100%': { transform: 'translateY(0)' },
					'50%': { transform: 'translateY(-14px)' }
				},
				// Логотип на входе плавно наезжает на зрителя — живая, но спокойная заставка.
				'logo-zoom': {
					from: { opacity: '0', transform: 'scale(0.6)' },
					to: { opacity: '1', transform: 'scale(1)' }
				},
				'shimmer': {
					'0%': { transform: 'translateX(-150%)' },
					'18%, 100%': { transform: 'translateX(150%)' }
				},
				// Свечение бежит по кругу логотипа: вращаем конический градиент.
				'logo-spin': {
					from: { transform: 'rotate(0deg)' },
					to: { transform: 'rotate(360deg)' }
				},
				// Пузырьки гидромассажа: всплывают со дна карточки и растворяются.
				'bubble': {
					'0%': { transform: 'translateY(0) scale(0.6)', opacity: '0' },
					'15%': { opacity: '0.75' },
					'100%': { transform: 'translateY(-120px) scale(1.15)', opacity: '0' }
				},
				// Волна на дне карточки — вода мягко покачивается.
				'wave': {
					'0%, 100%': { transform: 'translateX(-8%) scaleY(1)' },
					'50%': { transform: 'translateX(8%) scaleY(1.18)' }
				},
				// Мягкое «дыхание» ореола, чтобы свечение не выглядело механическим.
				'logo-glow': {
					'0%, 100%': { opacity: '0.45' },
					'50%': { opacity: '0.85' }
				},
				// ПЕРЕЛИВ ПЛИТКИ СКЛАДА: «работа есть, но не горит».
				// Блик медленно проходит по карточке — глаз замечает движение,
				// но оно не дёргает и не мешает работать весь день.
				'tile-sheen': {
					'0%': { transform: 'translateX(-120%)' },
					'55%, 100%': { transform: 'translateX(220%)' }
				},
				// ПУЛЬСАЦИЯ ПЛИТКИ СКЛАДА: работы накопилось, пора разгребать.
				// Красная рамка и фон то разгораются, то гаснут.
				'tile-alert': {
					'0%, 100%': {
						borderColor: 'hsl(var(--destructive) / 0.35)',
						backgroundColor: 'hsl(var(--destructive) / 0.04)',
						boxShadow: '0 0 0 0 hsl(var(--destructive) / 0)'
					},
					'50%': {
						borderColor: 'hsl(var(--destructive) / 0.85)',
						backgroundColor: 'hsl(var(--destructive) / 0.12)',
						boxShadow: '0 0 0 4px hsl(var(--destructive) / 0.12)'
					}
				}
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
				'fade-in': 'fade-in 0.6s ease-out both',
				'scale-in': 'scale-in 0.5s ease-out both',
				'float': 'float 6s ease-in-out infinite',
				'logo-zoom': 'logo-zoom 1.1s cubic-bezier(0.22, 1, 0.36, 1) both',
				'shimmer': 'shimmer 7s ease-in-out infinite',
				'logo-spin': 'logo-spin 3.5s linear infinite',
				'logo-glow': 'logo-glow 3.5s ease-in-out infinite',
				'bubble': 'bubble 4.5s ease-in infinite',
				'wave': 'wave 5s ease-in-out infinite',
				// Перелив неспешный: карточка «дышит», а не мигает.
				'tile-sheen': 'tile-sheen 3.5s ease-in-out infinite',
				// Пульсация заметно быстрее перелива — разница читается сразу,
				// даже боковым зрением, без сравнивания плиток между собой.
				'tile-alert': 'tile-alert 1.4s ease-in-out infinite'
			}
		}
	},
	plugins: [require("tailwindcss-animate")],
} satisfies Config;