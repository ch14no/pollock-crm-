'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Users, Briefcase, Activity,
  ArrowLeftRight, Upload, Settings, Rocket, ChevronDown,
  LogOut, BarChart2, CheckSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { createClient } from '@/lib/supabase/client'
import { MOCK_TOSSUPS } from '@/lib/mock-data'
import toast from 'react-hot-toast'

const NAV_ITEMS = [
  { href: '/dashboard',   label: 'ホーム',       icon: LayoutDashboard },
  { href: '/contacts',    label: '顧客',         icon: Users },
  { href: '/deals',       label: '商談',         icon: Briefcase },
  { href: '/activities',  label: '活動履歴',     icon: Activity },
  { href: '/tasks',       label: 'タスク管理',   icon: CheckSquare },
  { href: '/tossups',     label: 'トスアップ',   icon: ArrowLeftRight },
  { href: '/analysis',    label: '分析',         icon: BarChart2 },
  { href: '/import',      label: 'インポート・エクスポート', icon: Upload },
  { href: '/settings',    label: '設定',         icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { activeDivision, divisions, setActiveDivision, openTossupModal, currentUser, localTossups, tossupStatuses } = useAppStore()

  // 自分の事業部宛の未読トスアップ数
  const unreadTossupCount = useMemo(() => {
    const allTossups = [...localTossups, ...MOCK_TOSSUPS]
    return allTossups.filter(
      (t) => t.to_division_id === activeDivision?.id &&
             (tossupStatuses[t.id] ?? t.status) === 'unread'
    ).length
  }, [localTossups, tossupStatuses, activeDivision?.id])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    toast.success('ログアウトしました')
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="hidden md:flex flex-col w-64 h-screen bg-white border-r border-gray-200 fixed left-0 top-0 z-30">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
            <Rocket size={16} className="text-white" />
          </div>
          <span className="font-black text-gray-800 text-lg tracking-tight">Pollock CRM</span>
        </div>
      </div>

      {/* Division Switcher */}
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-xs text-gray-400 font-medium mb-1.5">事業部</p>
        <div className="relative">
          <select
            value={activeDivision?.id ?? ''}
            onChange={(e) => {
              const div = divisions.find((d) => d.id === e.target.value)
              if (div) setActiveDivision(div)
            }}
            className="w-full appearance-none pl-3 pr-8 py-2 text-sm font-medium text-gray-700
              bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2
              focus:ring-orange-500 focus:border-transparent cursor-pointer"
          >
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
        {activeDivision?.color_code && (
          <div className="mt-2 flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: activeDivision.color_code }}
            />
            <span className="text-xs text-gray-500">{activeDivision.name}</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href)
            const isTossup = href === '/tossups'
            const badge = isTossup && unreadTossupCount > 0 ? unreadTossupCount : 0
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    active
                      ? 'bg-orange-50 text-orange-600'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                  )}
                >
                  <Icon size={18} className="flex-shrink-0" />
                  <span className="flex-1">{label}</span>
                  {badge > 0 && (
                    <span className="min-w-5 h-5 px-1 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                      {badge}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Tossup CTA */}
      <div className="px-4 pb-3">
        <button
          onClick={() => openTossupModal()}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl
            bg-orange-500 text-white font-bold text-sm shadow-md
            hover:bg-orange-600 active:bg-orange-700 transition-all duration-150
            hover:shadow-lg"
        >
          <Rocket size={18} />
          トスアップ
        </button>
      </div>

      {/* User profile */}
      <div className="border-t border-gray-100 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-sm flex-shrink-0">
            {currentUser?.name?.slice(0, 1) ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-700 truncate">{currentUser?.name ?? 'ユーザー'}</p>
            <p className="text-xs text-gray-400 truncate">{currentUser?.email ?? ''}</p>
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="ログアウト"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}
