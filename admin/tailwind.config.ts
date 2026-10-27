import type { Config } from 'tailwindcss';
export default { content: ['./index.html','./src/**/*.{ts,tsx}'], theme: { extend: { colors: { brand: '#FF8382', 'brand-dark': '#F56F70' } } }, plugins: [] } satisfies Config;
