/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/preact" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** "proprietario/repository" su GitHub, impostato dal workflow di pubblicazione. */
  readonly VITE_GITHUB_REPO?: string;
}
