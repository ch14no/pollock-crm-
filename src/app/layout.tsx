import type { Metadata, Viewport } from 'next'
import { Noto_Sans_JP } from 'next/font/google'
import './globals.css'
import { Toaster } from 'react-hot-toast'

const notoSansJP = Noto_Sans_JP({
  subsets: ['latin'],
  variable: '--font-noto',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Pollock Core CRM',
  description: '株式会社ポロック グループ統合CRM',
  icons: {
    icon: '/characters/char-painter.png',
    apple: '/pollock-logo.png',
  },
  // iOSの「ホーム画面に追加」でスタンドアロン起動させる（PWA化）
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Pollock CRM',
  },
}

export const viewport: Viewport = {
  themeColor: '#f97316',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${notoSansJP.variable} h-full`}>
      <body className="min-h-full bg-gray-50 font-sans antialiased">
        {children}
        <Toaster
          position="bottom-right"
          // モバイルの下部ナビ（h-16）とセーフエリアにトーストが重ならないよう底上げする
          containerStyle={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)' }}
          toastOptions={{
            style: {
              borderRadius: '12px',
              background: '#1f2937',
              color: '#fff',
              fontSize: '14px',
            },
            success: {
              iconTheme: { primary: '#22c55e', secondary: '#fff' },
            },
            error: {
              iconTheme: { primary: '#ef4444', secondary: '#fff' },
            },
          }}
        />
      </body>
    </html>
  )
}
