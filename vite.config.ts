import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  define: {
    'import.meta.env.VITE_TARGET': JSON.stringify('web'),
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    minify: 'esbuild',
  },
});
