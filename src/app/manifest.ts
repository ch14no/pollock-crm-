import type { MetadataRoute } from 'next'

// PWAマニフェスト: スマホの「ホーム画面に追加」でアプリのように起動できるようにする。
// 将来のプッシュ通知（要望⑧の代替手段）導入の土台でもある
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pollock Core CRM',
    short_name: 'Pollock CRM',
    description: '株式会社ポロック グループ統合CRM',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#f9fafb',
    theme_color: '#f97316',
    icons: [
      {
        src: '/pollock-logo.png',
        sizes: '500x500',
        type: 'image/png',
      },
    ],
  }
}
