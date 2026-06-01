'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, Bell, X, CheckCheck, ArrowLeftRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/store/appStore'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchUnreadTossupCount } from '@/lib/db/tossups'

export function Header() {
  const [search, setSearch] = useState('')
  const [notifOpen, setNotifOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const { activeDivision, localTossups, tossupStatuses } = useAppStore()
  const router = useRouter()
  const notifRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!activeDivision?.id) return
    if (isSupabaseConfigured()) {
      fetchUnreadTossupCount(activeDivision.id).then(setUnreadCount)
    } else {
      const count = localTossups.filter(
        (t) => t.to_division_id === activeDivision.id &&
               (tossupStatuses[t.id] ?? t.status) === 'unread'
      ).length
      setUnreadCount(count)
    }
  }, [activeDivision?.id, localTossups, tossupStatuses])

  useEffect(() => {
    if (!notifOpen) return
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [notifOpen])

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !search.trim()) return
    router.push(`/contacts?q=${encodeURIComponent(search.trim())}`)
    setSearch('')
  }

  return (
    <header className="hidden md:flex items-center h-16 px-6 bg-white border-b border-gray-200 sticky top-0 z-20 gap-4">
      {/* Search */}
      <div className="relative flex-1 max-w-96">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="顧客・商談を検索... (Enterで検索)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleSearch}
          className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg
            focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent
            placeholder:text-gray-400"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex-1" />

      {/* Division indicator */}
      {activeDivision && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 rounded-lg">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: activeDivision.color_code ?? '#6b7280' }}
          />
          <span className="text-xs font-medium text-gray-600">{activeDivision.name}</span>
        </div>
      )}

      {/* Notifications */}
      <div className="relative" ref={notifRef}>
        <button
          onClick={() => setNotifOpen((o) => !o)}
          className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <Bell size={20} />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {notifOpen && (
          <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-800">通知</span>
              <button onClick={() => setNotifOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={15} />
              </button>
            </div>
            {unreadCount > 0 ? (
              <button
                onClick={() => { setNotifOpen(false); router.push('/tossups') }}
                className="w-full flex items-center gap-3 px-4 py-4 hover:bg-orange-50 transition-colors text-left"
              >
                <div className="w-9 h-9 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <ArrowLeftRight size={16} className="text-orange-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">未読のトスアップ</p>
                  <p className="text-xs text-gray-500">{unreadCount}件の未読があります</p>
                </div>
                <span className="w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center flex-shrink-0">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              </button>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <CheckCheck size={28} className="mb-2 text-gray-300" />
                <p className="text-sm">新しい通知はありません</p>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
