/// <reference types="vite/client" />

declare module "*.js?raw" {
  const src: string;
  export default src;
}

declare module "*.html?raw" {
  const src: string;
  export default src;
}

declare module "*.md?raw" {
  const src: string;
  export default src;
}
