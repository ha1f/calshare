export interface OgpInput {
  title: string
  dateLabel: string
  location: string | null
  serviceName: string
}
export interface OgpRenderer {
  render(input: OgpInput): Promise<Uint8Array>
}
