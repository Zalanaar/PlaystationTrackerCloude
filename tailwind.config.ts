import type { Config } from 'tailwindcss';
import { tokens } from './src/ui/tokens/tailwind.tokens';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: tokens as unknown as NonNullable<Config['theme']>['extend'] }, // tokens объявлены as const (readonly)
  plugins: [],
};

export default config;
