// The export worker's two fonts are read by esbuild as bytes (the "binary" loader in scripts/build-main.mjs) and become part of its bundle.
declare module "*.ttf" {
  const bytes: Uint8Array;
  export default bytes;
}
