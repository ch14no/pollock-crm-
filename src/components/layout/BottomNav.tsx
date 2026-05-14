'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, Activity, CheckSquare, Rocket } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'

const NAV_LEFT  = [
  { href: '/dashboard', label: 'ホーム', icon: LayoutDashboard },
  { href: '/contacts',  label: '顧客',  icon: Users },
]
const NAV_RIGHT = [
  { href: '/activities', label: '活動',     icon: Activity },
  { href: '/tasks',      label: 'タスク',   icon: CheckSquare },
]

export function BottomNav() {
  const pathname = usePathname()
  const { openTossupModal } = useAppStore()

  return (
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

        {/* Center FAB - Tossup */}
        <div className="flex-1 flex flex-col items-center relative">
          <button
            onClick={() => openTossupModal()}
            className="absolute -top-5 w-14 h-14 bg-orange-500 rounded-full flex items-center justify-center
              shadow-lg shadow-orange-200 hover:bg-orange-600 active:bg-orange-700 transition-all"
          >
            <Rocket size={24} className="text-white" />
          </button>
          <span className="mt-9 text-xs text-gray-400">トスアップ</span>
        </div>

        {NAV_RIGHT.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}
            className={cn('flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors',
              pathname.startsWith(href) ? 'text-orange-600' : 'text-gray-500')}>
            <Icon size={22} />
            <span>{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}
