/**
 * `env.ASSETS.fetch()` が返す Response はヘッダが読み取り専用なので、呼び出し側が
 * `Cache-Control` 等を追加できるよう包み直す（§2.2）
 */
export async function fetchAsset(assets: Fetcher, url: URL): Promise<Response> {
  const response = await assets.fetch(url)
  return new Response(response.body, response)
}
