import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  define: {
    'import.meta.env.VITE_TARGET': JSON.stringify('minigame'),
  },
  build: {
    outDir: 'dist-minigame-tmp',
    emptyOutDir: true,
    target: 'es2018',
    minify: 'esbuild',
    lib: {
      entry: resolve(__dirname, 'src/main.ts'),
      name: 'DoomsdayGunnerGame',
      formats: ['iife'],
      fileName: () => 'game-bundle.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
