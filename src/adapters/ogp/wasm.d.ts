// wrangler の既定 `CompiledWasm` ルール（`**/*.wasm`）で import した `.wasm` は
// コンパイル済みの WebAssembly.Module になる。TypeScript は拡張子から型を推論できないため
// ここでアンビエント宣言する（server/deps.ts の動的 import と satoriOgpRenderer.test.ts の
// 静的 import が対象）。
declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}
