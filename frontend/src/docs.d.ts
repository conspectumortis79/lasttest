// Type declarations for Vite's `?raw` import suffix. The bundled
// `vite/client` types do not surface this module shape to
// arbitrary userland paths, so we declare each known file
// explicitly. The runtime resolution is handled by Vite; this
// file is purely to satisfy TypeScript's static checker.
declare module './docs/USER_GUIDE.md?raw' {
  const content: string
  export default content
}
declare module './docs/USER_GUIDE.en.md?raw' {
  const content: string
  export default content
}
declare module './docs/README.md?raw' {
  const content: string
  export default content
}
declare module './docs/README.de.md?raw' {
  const content: string
  export default content
}
