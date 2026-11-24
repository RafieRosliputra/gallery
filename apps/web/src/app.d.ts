/** @type {import('@sveltejs/kit').Config} */
export {};

declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface Platform {}
  }

  interface ImportMetaEnv {
    /** `1` builds the UI against MSW fixtures (CI screenshots and e2e). */
    readonly VITE_MOCKS?: string;
  }
}
