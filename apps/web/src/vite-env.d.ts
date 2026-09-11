/// <reference types="vite/client" />

declare global {
  const __APP_VERSION__: string;
}

declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}

export {};

