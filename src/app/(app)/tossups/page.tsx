'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Rocket, ArrowRight, Clock, CheckCircle2, Circle,
  ExternalLink, Plus, ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatRelativeTime, cn } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchTossupsByDivision, updateTossupStatus } from '@/lib/db/tossups'
import type { Tossup, TossupStatus } from '@/types/database'
import toast from 'react-hot-toast'

const STATUS_CONFIG: Record<TossupStatus, { label: string; color: string; icon: React.ElementType }> = {
  unread:      { label: '未読',    color: 'bg-orange-100 text-orange-700', icon: Circle },
  in_progress: { label: '対応中',  color: 'bg-blue-100 text-blue-700',    icon: Clock },
  closed:      { label: '完了',    color: 'bg-green-100 text-green-700',   icon: CheckCircle2 },
}

type FilterTab = 'all' | 'received' | 'sent'

export default function TossupsPage() {
  const router = useRouter()
  const {
    openTossupModal, openDealModal, activeDivision,
    localTossups, tossupStatuses, setTossupStatus, tossupModal,
  } = useAppStore()

  const [filter, setFilter]             = useState<FilterTab>('all')
  const [statusFilter, setStatusFilter] = useState<TossupStatus | 'all'>('all')
  const [expandedIds, setExpandedIds]   = useState<Set<string>>(new Set())

  // ─── Supabase データ ─────────────────────────────────────────────
  const [dbTossups, setDbTossups] = useState<Tossup[]>([])
  const [loading, setLoading]     = useState(false)
  const prevModalOpen = useRef(false)

  const loadTossups = async () => {
    if (!activeDivision?.id || !isSupabaseConfigured()) return
    setLoading(true)
    try {
      const data = await fetchTossupsByDivision(activeDivision.id)
      setDbTossups(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadTossups() }, [activeDivision?.id]) // eslint-disable-line

  // モーダルが閉じたら再取得
  useEffect(() => {
    if (prevModalOpen.current && !tossupModal.isOpen) loadTossups()
    prevModalOpen.current = tossupModal.isOpen
  }, [tossupModal.isOpen]) // eslint-disable-line

  // DB + ローカル（楽観的更新）をマージ
  const allTossups = useMemo((): Tossup[] => {
    if (!isSupabaseConfigured()) return localTossups
    const dbIds = new Set(dbTossups.map((t) => t.id))
    const onlyLocal = localTossups.filter((t) => !dbIds.has(t.id))
    return [...onlyLocal, ...dbTossups]
  }, [dbTossups, localTossups])

  // 事業部フィルタ
  const divTossups = useMemo(
    () => allTossups.filter((t) =>
      t.from_division_id === activeDivision?.id || t.to_division_id === activeDivision?.id
    ),
    [allTossups, activeDivision?.id]
  )

  const filtered = useMemo(() => divTossups.filter((t) => {
    const effectiveStatus = tossupStatuses[t.id] ?? t.status
    const matchStatus = statusFilter === 'all' || effectiveStatus === statusFilter
    if (!matchStatus) return false
    if (filter === 'received') return t.to_division_id === activeDivision?.id
    if (filter === 'sent')     return t.from_division_id === activeDivision?.id
    return true
  }), [divTossups, filter, statusFilter, activeDivision?.id, tossupStatuses])

  const unreadCount = divTossups.filter(
    (t) => (tossupStatuses[t.id] ?? t.status) === 'unread' && t.to_division_id === activeDivision?.id
  ).length

  const counts = useMemo(() => ({
    all:      divTossups.length,
    received: divTossups.filter((t) => t.to_division_id === activeDivision?.id).length,
    sent:     divTossups.filter((t) => t.from_division_id === activeDivision?.id).length,
  }), [divTossups, activeDivision?.id])

  // ステータス変更（DB + ローカル）
  const handleStatusChange = async (id: string, status: TossupStatus) => {
    setTossupStatus(id, status)  // 楽観的更新
    if (isSupabaseConfigured() && !id.startsWith('toss-local-')) {
      updateTossupStatus(id, status).catch(() => {
        toast.error('ステータスの更新に失敗しました')
      })
      // DB再取得してステータスを確定反映
      loadTossups()
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="w-full max-w-4xl">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-800">トスアップ管理</h1>
          {loading ? (
            <p className="text-sm text-gray-400 mt-0.5">読み込み中...</p>
          ) : unreadCount > 0 ? (
            <p className="text-sm text-orange-600 font-medium mt-0.5">
              未読 {unreadCount}件あります — 早めに確認しましょう
            </p>
          ) : (
            <p className="text-sm text-gray-500 mt-0.5">
              {activeDivision?.name} の送受信一覧
            </p>
          )}
        </div>
        <Button icon={<Rocket size={16} />} onClick={() => openTossupModal()}>
          新規トスアップ
        </Button>
      </div>

      {/* フィルター */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          {(['all', 'received', 'sent'] as FilterTab[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                filter === f ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700')}>
              {{ all: 'すべて', received: '受信', sent: '送信' }[f]}
              <span className="ml-1.5 text-xs opacity-70">({counts[f]})</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          {(['all', 'unread', 'in_progress', 'closed'] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn('px-3 py-1.5 rounded-full text-sm font-medium transition-colors border',
                statusFilter === s ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50')}>
              {{ all: '全ステータス', unread: '未読', in_progress: '対応中', closed: '完了' }[s]}
            </button>
          ))}
        </div>
      </div>

      {/* リスト */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="🚀"
          title="トスアップがありません"
          description="他の事業部の顧客をトスアップして、グループシナジーを最大化しましょう！"
          action={<Button onClick={() => openTossupModal()} icon={<Rocket size={16} />}>最初のトスアップを送る</Button>}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((tossup) => {
            const effectiveStatus = tossupStatuses[tossup.id] ?? tossup.status
            const { label, color, icon: StatusIcon } = STATUS_CONFIG[effectiveStatus]
            const isReceived  = tossup.to_division_id === activeDivision?.id
            const isExpanded  = expandedIds.has(tossup.id)
            const isLongMsg   = tossup.message.length > 80
            const displayMsg  = isLongMsg && !isExpanded
              ? tossup.message.slice(0, 80) + '…'
              : tossup.message

            return (
              <div key={tossup.id}
                className={cn(
                  'bg-white border rounded-2xl p-5 shadow-sm transition-all',
                  effectiveStatus === 'unread' && isReceived
                    ? 'border-orange-300 bg-orange-50/30'
                    : 'border-gray-100'
                )}>
                {/* ヘッダー行 */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-700 flex-wrap">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: tossup.from_division?.color_code ?? '#6b7280' }} />
                      {tossup.from_division?.name ?? '—'}
                    </span>
                    <ArrowRight size={14} className="text-orange-400 flex-shrink-0" />
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: tossup.to_division?.color_code ?? '#6b7280' }} />
                      {tossup.to_division?.name ?? '—'}
                    </span>
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full font-semibold',
                      isReceived ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-500'
                    )}>
                      {isReceived ? '受信' : '送信'}
                    </span>
                  </div>
                  <span className={cn('inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full flex-shrink-0', color)}>
                    <StatusIcon size={11} />
                    {label}
                  </span>
                </div>

                {/* 顧客・企業情報 */}
                {tossup.contacts ? (
                  <button
                    onClick={() => router.push(`/contacts/${tossup.contacts!.id}`)}
                    className="flex items-center gap-1.5 text-xs font-bold text-orange-600 hover:text-orange-700 hover:underline mb-2 transition-colors"
                  >
                    <ExternalLink size={11} />
                    {tossup.companies?.name}
                    {` / ${tossup.contacts.name}`}
                  </button>
                ) : tossup.companies ? (
                  <p className="text-xs font-bold text-gray-500 mb-2">{tossup.companies.name}</p>
                ) : null}

                {/* メッセージ（展開/折り畳み） */}
                <div>
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{displayMsg}</p>
                  {isLongMsg && (
                    <button
                      onClick={() => toggleExpand(tossup.id)}
                      className="flex items-center gap-1 mt-1 text-xs text-orange-500 hover:text-orange-700 transition-colors"
                    >
                      <ChevronDown size={12} className={cn('transition-transform', isExpanded && 'rotate-180')} />
                      {isExpanded ? '折り畳む' : 'すべて表示'}
                    </button>
                  )}
                </div>

                {/* フッター */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 flex-wrap gap-2">
                  <span className="text-xs text-gray-400">
                    {tossup.from_user?.name ?? '不明'} · {formatRelativeTime(tossup.created_at)}
                  </span>

                  <div className="flex gap-2 flex-wrap">
                    {/* 受信側アクション */}
                    {isReceived && effectiveStatus !== 'closed' && (
                      <>
                        {effectiveStatus === 'unread' && (
                          <button
                            onClick={() => handleStatusChange(tossup.id, 'in_progress')}
                            className="text-xs text-blue-600 hover:text-blue-700 font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 border border-blue-200 transition-colors"
                          >
                            対応中にする
                          </button>
                        )}
                        {tossup.contacts && (
                          <button
                            onClick={() => openDealModal({ prefillContactId: tossup.contacts!.id })}
                            className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 font-medium px-3 py-1.5 rounded-lg hover:bg-orange-50 border border-orange-200 transition-colors"
                          >
                            <Plus size={12} />
                            商談を作成
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (window.confirm('このトスアップを完了にしますか？')) {
                              handleStatusChange(tossup.id, 'closed')
                            }
                          }}
                          className="text-xs text-green-600 hover:text-green-700 font-medium px-3 py-1.5 rounded-lg hover:bg-green-50 border border-green-200 transition-colors"
                        >
                          完了にする
                        </button>
                      </>
                    )}

                    {/* 送信側の状態表示 */}
                    {!isReceived && effectiveStatus === 'closed' && (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle2 size={13} />
                        相手が完了処理済み
                      </span>
                    )}
                    {!isReceived && effectiveStatus === 'in_progress' && (
                      <span className="text-xs text-blue-600 flex items-center gap-1">
                        <Clock size={13} />
                        相手が対応中
                      </span>
                    )}
                    {!isReceived && effectiveStatus === 'unread' && (
                      <span className="text-xs text-orange-500 flex items-center gap-1">
                        <Circle size={13} />
                        未読
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
