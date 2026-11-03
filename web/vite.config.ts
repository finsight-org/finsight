import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { readWebConfig } from './src/config.ts';
import { fileURLToPath } from 'node:url';
export default defineConfig(({ command, mode }) => {
  if (command === 'build') readWebConfig(loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_'));
  return {
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'], restoreMocks: true },
  };
});
