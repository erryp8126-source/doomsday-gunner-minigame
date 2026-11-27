/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TARGET: 'web' | 'minigame';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
