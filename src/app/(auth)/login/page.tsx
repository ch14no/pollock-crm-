'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Rocket, Eye, EyeOff, Shield } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { useAppStore } from '@/store/appStore'
import { MOCK_ADMIN_USER } from '@/lib/mock-data'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const router = useRouter()
  const setDemoUserId = useAppStore((s) => s.setDemoUserId)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      toast.error('メールアドレスまたはパスワードが正しくありません')
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  const handleDemoLogin = () => {
    setDemoUserId('user-1')
    document.cookie = 'pollock-demo-session=1; path=/; max-age=86400'
    router.push('/dashboard')
    router.refresh()
  }

  const handleAdminDemoLogin = () => {
    setDemoUserId(MOCK_ADMIN_USER.id)
    document.cookie = 'pollock-demo-session=1; path=/; max-age=86400'
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-orange-500 rounded-2xl flex items-center justify-center mb-3 shadow-lg shadow-orange-200">
            <Rocket size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-black text-gray-800">Pollock CRM</h1>
          <p className="text-sm text-gray-500 mt-1">株式会社ポロック グループ統合CRM</p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-5">ログイン</h2>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                メールアドレス
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@pollock.co.jp"
                required
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg
                  focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                パスワード
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-3 py-2.5 pr-10 text-sm border border-gray-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-gray-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <Button type="submit" loading={loading} className="w-full" size="lg">
              ログイン
            </Button>
          </form>

          <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
            <button
              onClick={handleDemoLogin}
              className="w-full text-sm text-orange-600 hover:text-orange-700 font-medium py-2 rounded-lg hover:bg-orange-50 transition-colors"
            >
              デモモードで体験する（営業）→
            </button>
            <button
              onClick={handleAdminDemoLogin}
              className="w-full flex items-center justify-center gap-1.5 text-sm text-purple-600 hover:text-purple-700 font-medium py-2 rounded-lg hover:bg-purple-50 transition-colors"
            >
              <Shield size={14} />
              管理者アカウントでデモ →
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          © 2026 株式会社ポロック
        </p>
      </div>
    </div>
  )
}
