'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, Bell, X, CheckCheck, ArrowLeftRight, TrendingUp } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/store/appStore'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchUnreadTossupCount } from '@/lib/db/tossups'
import { fetchRecentDealStageChanges } from '@/lib/db/activities'
import { formatRelativeTime } from '@/lib/utils'
import type { Activity } from '@/types/database'

// ステージ変更通知の既読基準（この時刻より新しいものをバッジに数える）
const NOTIF_LAST_SEEN_KEY = 'pollock-notif-last-seen'
// 通知に表示する範囲（直近24時間）とポーリング間隔
const NOTIF_WINDOW_MS = 24 * 60 * 60 * 1000
const NOTIF_POLL_MS = 60 * 1000

function loadLastSeen(): number {
  try { return Number(localStorage.getItem(NOTIF_LAST_SEEN_KEY)) || 0 } catch { return 0 }
}

export function Header() {
  const [search, setSearch] = useState('')
  const [notifOpen, setNotifOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [stageChanges, setStageChanges] = useState<Activity[]>([])
  const [lastSeen, setLastSeen] = useState(0)
  const { activeDivision, localTossups, tossupStatuses, currentUser } = useAppStore()
  const router = useRouter()
  const notifRef = useRef<HTMLDivElement>(null)

  // localStorageの既読時刻はハイドレーション完了後に反映する
  // （サーバー描画時は参照できず、初回描画で読むとバッジ数が食い違うため）
  useEffect(() => {
    const timer = setTimeout(() => setLastSeen(loadLastSeen()), 0)
    return () => clearTimeout(timer)
  }, [])

  const loadNotifications = async () => {
    if (!activeDivision?.id || !isSupabaseConfigured()) return
    const since = new Date(Date.now() - NOTIF_WINDOW_MS).toISOString()
    try {
      const [count, changes] = await Promise.all([
        fetchUnreadTossupCount(activeDivision.id),
        fetchRecentDealStageChanges(activeDivision.id, since, currentUser?.id),
      ])
      setUnreadCount(count)
      setStageChanges(changes)
    } catch {
      // 015未適用等で取得できなくても通知ベルは壊さない
    }
  }

  // 初回＋事業部変更時に取得し、以後は60秒ごとにポーリング（⑨第2段の準リアルタイム反映）。
  // 初回分もタイマー経由にして、effect本文での同期setStateを避ける
  useEffect(() => {
    if (!activeDivision?.id) return
    if (isSupabaseConfigured()) {
      const initial = setTimeout(loadNotifications, 0)
      const timer = setInterval(loadNotifications, NOTIF_POLL_MS)
      return () => { clearTimeout(initial); clearInterval(timer) }
    }
    const count = localTossups.filter(
      (t) => t.to_division_id === activeDivision.id &&
             (tossupStatuses[t.id] ?? t.status) === 'unread'
    ).length
    const demoTimer = setTimeout(() => setUnreadCount(count), 0)
    return () => clearTimeout(demoTimer)
  }, [activeDivision?.id, localTossups, tossupStatuses, currentUser?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
    // 検索後も入力値を保持（2回連続検索のため）
  }

  // 未読バッジ = 未読トスアップ + 前回パネルを開いて以降のステージ変更
  const newStageChangeCount = stageChanges.filter(
    (a) => new Date(a.action_date).getTime() > lastSeen
  ).length
  const badgeCount = unreadCount + newStageChangeCount

  const handleOpenNotif = () => {
    setNotifOpen((o) => {
      const next = !o
      if (next) {
        // 開いた時点で最新化し、ステージ変更は既読扱いにする
        loadNotifications()
        const now = Date.now()
        setLastSeen(now)
        try { localStorage.setItem(NOTIF_LAST_SEEN_KEY, String(now)) } catch {}
      }
      return next
    })
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
          onClick={handleOpenNotif}
          aria-label="通知を開く"
          className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <Bell size={20} />
          {badgeCount > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {badgeCount > 9 ? '9+' : badgeCount}
            </span>
          )}
        </button>

        {notifOpen && (
          <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-800">通知</span>
              <button onClick={() => setNotifOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={15} />
              </button>
            </div>

            {unreadCount === 0 && stageChanges.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <CheckCheck size={28} className="mb-2 text-gray-300" />
                <p className="text-sm">新しい通知はありません</p>
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                {unreadCount > 0 && (
                  <button
                    onClick={() => { setNotifOpen(false); router.push('/tossups') }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-orange-50 transition-colors text-left border-b border-gray-50"
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
                )}

                {/* 商談のステージ変更（015のトリガー記録。直近24時間・自分の操作を除く） */}
                {stageChanges.length > 0 && (
                  <>
                    <p className="px-4 pt-3 pb-1 text-[11px] font-bold text-gray-400 uppercase tracking-wide">
                      商談の動き（直近24時間）
                    </p>
                    {stageChanges.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => { setNotifOpen(false); router.push('/deals') }}
                        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                      >
                        <div className="w-9 h-9 bg-blue-50 rounded-full flex items-center justify-center flex-shrink-0">
                          <TrendingUp size={15} className="text-blue-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {a.title?.replace(/^ステージ変更: /, '') ?? '商談'}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{a.memo}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {a.users?.name ? `${a.users.name} · ` : ''}{formatRelativeTime(a.action_date)}
                          </p>
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
