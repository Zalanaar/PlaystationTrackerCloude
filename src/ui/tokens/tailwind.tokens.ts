// Подключение: tailwind.config.ts -> theme.extend = tokens. Цвета только через CSS-переменные, сырых hex в компонентах нет.
export const tokens = {
  colors: {
    bg: 'var(--bg)', surface: 'var(--surface)', 'surface-2': 'var(--surface-2)', 'surface-3': 'var(--surface-3)',
    border: 'var(--border)', 'border-strong': 'var(--border-strong)',
    text: 'var(--text)', 'text-2': 'var(--text-2)', 'text-3': 'var(--text-3)',
    accent: 'var(--accent)', 'accent-ink': 'var(--accent-ink)', 'accent-soft': 'var(--accent-soft)',
    tint: 'var(--tint)',
    playing: 'var(--st-playing)', completed: 'var(--st-completed)', backlog: 'var(--st-backlog)',
    dropped: 'var(--st-dropped)', shelved: 'var(--st-shelved)', service: 'var(--st-service)', unsorted: 'var(--st-none)',
    success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)',
    platinum: 'var(--platinum)', gold: 'var(--gold)', silver: 'var(--silver)', bronze: 'var(--bronze)',
    'on-cover': 'var(--on-cover-bg)',
  },
  borderRadius: { sm: 'var(--r-sm)', md: 'var(--r-md)', lg: 'var(--r-lg)', cover: 'var(--r-cover)', pill: 'var(--r-pill)' },
  fontFamily: { body: 'var(--font-body)', display: 'var(--font-display)', num: 'var(--font-num)' },
  boxShadow: { card: 'var(--shadow-card)', hover: 'var(--shadow-hover)', pop: 'var(--shadow-pop)' },
  spacing: {
    1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 8: '32px', 10: '40px', 12: '48px', 16: '64px',
  },
  transitionDuration: { fast: 'var(--dur-fast)', DEFAULT: 'var(--dur-base)', slow: 'var(--dur-slow)' },
  transitionTimingFunction: { DEFAULT: 'var(--ease-ui)' },
  maxWidth: { container: 'var(--container)' },
} as const;
