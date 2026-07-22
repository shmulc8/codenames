/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_USE_MOCKS?: string;
  readonly VITE_ENABLE_OCR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
