'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, Briefcase, Activity, CheckSquare, CreditCard, Menu, X, LogOut, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { NAV_ITEMS } from '@/components/layout/Sidebar'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

const NAV_LEFT  = [
  { href: '/dashboard', label: 'ホーム', icon: LayoutDashboard },
  { href: '/deals',     label: '商談',   icon: Briefcase },
]
const NAV_RIGHT = [
  { href: '/activities', label: '活動',     icon: Activity },
  { href: '/tasks',      label: 'タスク',   icon: CheckSquare },
]

// モバイル用の全ページメニュー（ドロワー）。
// BottomNavに載らないページ（商談・資料・ナレッジ・設定等）への唯一の導線と、
// スマホでの事業部切替・ログアウトを提供する
function MobileMenuDrawer({ onClose }: { onClose: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const { activeDivision, divisions, setActiveDivision, currentUser } = useAppStore()
  const userOwnDivisionIds = useAppStore((s) => s.userOwnDivisionIds)
  const [search, setSearch] = useState('')

  // デスクトップのヘッダー検索と同じ動き（顧客ページへ検索クエリ付きで遷移）
  const handleSearch = () => {
    if (!search.trim()) return
    onClose()
    router.push(`/contacts?q=${encodeURIComponent(search.trim())}`)
  }

  // 事業部セレクタは自分の所属事業部のみ（Sidebarと同ロジック）
  const selectableDivisions = useMemo(() => {
    if (userOwnDivisionIds.length === 0) return divisions
    return divisions.filter((d) => userOwnDivisionIds.includes(d.id))
  }, [divisions, userOwnDivisionIds])

  // ドロワー表示中は背景スクロールを止める
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    toast.success('ログアウトしました')
    onClose()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="md:hidden fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl max-h-[80vh] overflow-y-auto safe-area-pb">
        <div className="sticky top-0 bg-white flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
          <span className="font-bold text-gray-800">メニュー</span>
          <button onClick={onClose} aria-label="メニューを閉じる"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        {/* 検索（デスクトップヘッダーのグローバル検索のモバイル版） */}
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSearch() }}
              placeholder="顧客・商談を検索..."
              aria-label="顧客・商談を検索"
              className="w-full pl-9 pr-16 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg
                focus:outline-none focus:ring-2 focus:ring-orange-500 placeholder:text-gray-400"
            />
            {search.trim() && (
              <button
                onClick={handleSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-orange-500 text-white text-xs font-medium rounded-md hover:bg-orange-600"
              >
                検索
              </button>
            )}
          </div>
        </div>

        {/* 事業部切替 */}
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-xs text-gray-400 font-medium mb-1.5">事業部</p>
          <div className="relative">
            <select
              value={activeDivision?.id ?? ''}
              onChange={(e) => {
                const div = selectableDivisions.find((d) => d.id === e.target.value)
                if (div) setActiveDivision(div)
              }}
              className="w-full appearance-none pl-3 pr-8 py-2.5 text-sm font-medium text-gray-700
                bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              {selectableDivisions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* 全ページリンク */}
        <nav className="p-3">
          <div className="grid grid-cols-2 gap-1.5">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href)
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onClose}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-3 rounded-xl text-sm font-medium transition-colors',
                    active ? 'bg-orange-50 text-orange-600' : 'text-gray-600 hover:bg-gray-50'
                  )}
                >
                  <Icon size={18} className="flex-shrink-0" />
                  <span className="truncate">{label}</span>
                </Link>
              )
            })}
          </div>
        </nav>

        {/* ユーザー・ログアウト */}
        <div className="border-t border-gray-100 px-5 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-sm flex-shrink-0">
            {currentUser?.name?.slice(0, 1) ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-700 truncate">{currentUser?.name ?? 'ユーザー'}</p>
            <p className="text-xs text-gray-400 truncate">{currentUser?.email ?? ''}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <LogOut size={14} />
            ログアウト
          </button>
        </div>
      </div>
    </div>
  )
}

export function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)

  // BottomNavに無いページを開いているときは「メニュー」をアクティブ表示にする
  const barHrefs = [...NAV_LEFT, ...NAV_RIGHT].map((n) => n.href)
  const isMenuPageActive = !barHrefs.some((h) => pathname.startsWith(h))

  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 safe-area-pb">
        <div className="flex items-end h-16">
          {NAV_LEFT.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className={cn('flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors',
                pathname.startsWith(href) ? 'text-orange-600' : 'text-gray-500')}>
              <Icon size={22} />
              <span>{label}</span>
            </Link>
          ))}

          {/* Center FAB - 名刺から顧客登録（外出先での最頻アクション） */}
          <div className="flex-1 flex flex-col items-center relative">
            <button
              onClick={() => router.push('/contacts/new?mode=card')}
              aria-label="名刺から顧客を登録"
              className="absolute -top-5 w-14 h-14 bg-orange-500 rounded-full flex items-center justify-center
                shadow-lg shadow-orange-200 hover:bg-orange-600 active:bg-orange-700 transition-all"
            >
              <CreditCard size={24} className="text-white" />
            </button>
            <span className="mt-9 text-xs text-gray-400">名刺登録</span>
          </div>

          {NAV_RIGHT.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className={cn('flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors',
                pathname.startsWith(href) ? 'text-orange-600' : 'text-gray-500')}>
              <Icon size={22} />
              <span>{label}</span>
            </Link>
          ))}

          <button
            onClick={() => setMenuOpen(true)}
            aria-label="全メニューを開く"
            className={cn('flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors',
              isMenuPageActive ? 'text-orange-600' : 'text-gray-500')}
          >
            <Menu size={22} />
            <span>メニュー</span>
          </button>
        </div>
      </nav>

      {menuOpen && <MobileMenuDrawer onClose={() => setMenuOpen(false)} />}
    </>
  )
}
