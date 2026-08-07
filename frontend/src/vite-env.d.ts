/// <reference types="vite/client" />

// Inline declaration for `import.meta.glob` with the `?raw` query.
// Vite's userland types do not surface the string overload for
// plain raw content, so we mirror it here.
declare module '*?raw' {
  const src: string
  export default src
}
