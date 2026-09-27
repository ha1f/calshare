import type { OgpInput, OgpRenderer } from '../../ports/ogpRenderer'

/** 1×1 透明 PNG */
const TRANSPARENT_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function createFakeOgpRenderer(): OgpRenderer & { calls: OgpInput[] } {
  const calls: OgpInput[] = []
  return {
    calls,
    render: async (input: OgpInput) => {
      calls.push(input)
      return decodeBase64(TRANSPARENT_PIXEL_PNG_BASE64)
    },
  }
}
