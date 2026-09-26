import { Layout } from './Layout'

export interface NotFoundProps {
  serviceName: string
}

/** hidden・期限切れのページを表示する（§4.1）。ページの存在自体を区別させないため、通常の 404 と同じ文言にする */
export function NotFound({ serviceName }: NotFoundProps) {
  return (
    <Layout title={`ページが見つかりません - ${serviceName}`}>
      <h1>このページは表示できません</h1>
      <p>URL をご確認ください。期限が切れている可能性があります。</p>
    </Layout>
  )
}
