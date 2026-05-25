'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Briefcase, Users, ArrowLeftRight, TrendingUp,
  CheckSquare, CalendarClock, AlertCircle, Clock,
  User, Activity, Crown, Target,
} from 'lucide-react'
import { KPICard } from '@/components/dashboard/KPICard'
import { DailyMission } from '@/components/dashboard/DailyMission'
import { RealtimeTimeline } from '@/components/dashboard/RealtimeTimeline'
import { ManagerView } from '@/components/dashboard/ManagerView'
import { useAppStore } from '@/store/appStore'
import { MOCK_CONTACTS, MOCK_DEALS, MOCK_ACTIVITIES, DEFAULT_DIVISION_STAGES } from '@/lib/mock-data'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchTossupsByDivision } from '@/lib/db/tossups'
import { fetchDealsByDivision } from '@/lib/db/deals'
import { fetchContactsByDivision } from '@/lib/db/contacts'
import { fetchActivitiesByDivision } from '@/lib/db/activities'
import type { Tossup, Deal, Contact, Activity as DbActivity } from '@/types/database'
import { formatCurrency, formatDate, formatRelativeTime, getStaleDays, cn } from '@/lib/utils'

type DashView = 'personal' | 'team' | 'manager'

const STAGES_ORDER = ['リード', '初回面談', '提案中', 'クロージング', '受注']
const STAGE_COLORS = ['bg-orange-100', 'bg-orange-200', 'bg-orange-300', 'bg-orange-400', 'bg-green-400']

function isSameMonth(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}
function isSameWeek(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay())
  return d >= startOfWeek && d <= now
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function firstNameFrom(fullName: string): string {
  const parts = fullName.trim().split(/[\s　]+/)
  return parts.length >= 2 ? parts[parts.length - 1] : fullName
}

// ─── タスクカード（両ビューで共有） ─────────────────────────────
function TaskCard({ task, onClick }: {
  task: { id: string; title?: string; due_date?: string; target_type: string; target_id: string }
  onClick: () => void
}) {
  const days = task.due_date ? daysUntil(task.due_date) : null
  const isOverdue = days !== null && days < 0
  const isToday   = days === 0
  const isNoDue   = days === null

  return (
    <button onClick={onClick}
      className={cn('w-full flex items-start gap-2 p-2 rounded-lg transition-colors text-left',
        isOverdue ? 'bg-red-50 hover:bg-red-100' :
        isToday   ? 'bg-orange-50 hover:bg-orange-100' :
        isNoDue   ? 'bg-gray-50 hover:bg-gray-100 border border-dashed border-gray-200' :
        'bg-gray-50 hover:bg-gray-100'
      )}>
      <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0',
        isOverdue ? 'bg-red-500' : isToday ? 'bg-orange-500' : 'bg-gray-300')} />
      <div className="min-w-0 flex-1">
        <p className={cn('text-xs font-medium truncate',
          isOverdue ? 'text-red-700' : isToday ? 'text-orange-700' : 'text-gray-700')}>
          {task.title ?? 'タスク'}
        </p>
        <p className={cn('text-xs',
          isOverdue ? 'text-red-500' : isToday ? 'text-orange-500' : 'text-gray-400')}>
          {isOverdue ? `期限切れ ${Math.abs(days!)}日` :
           isToday   ? '本日期限' :
           isNoDue   ? '期限未設定' :
           `${days}日後`}
        </p>
      </div>
    </button>
  )
}

// ─── パイプライン棒グラフ（両ビューで共有） ─────────────────────
function PipelineChart({ activeDeals, stageOrder }: { activeDeals: { stage_id: string; amount: number }[]; stageOrder: string[] }) {
  const pipeline = stageOrder.map((stage) => {
    const deals = activeDeals.filter((d) => d.stage_id === stage)
    return { stage, count: deals.length, amount: deals.reduce((s, d) => s + d.amount, 0) }
  })
  const maxCount = Math.max(...pipeline.map((p) => p.count), 1)

  if (activeDeals.length === 0) return <p className="text-sm text-gray-400 text-center py-6">進行中の商談はありません</p>

  return (
    <div className="space-y-3">
      {pipeline.map(({ stage, count, amount }, i) => (
        <div key={stage} className="flex items-center gap-3">
          <span className="text-sm text-gray-600 w-28 flex-shrink-0">{stage}</span>
          <div className="flex-1 bg-gray-100 rounded-full h-2.5">
            <div className={`h-2.5 rounded-full transition-all ${STAGE_COLORS[i]}`}
              style={{ width: count === 0 ? '0%' : `${(count / maxCount) * 100}%` }} />
          </div>
          <span className="text-xs text-gray-500 w-8 text-right flex-shrink-0">{count}件</span>
          <span className="text-xs font-medium text-gray-700 w-28 text-right flex-shrink-0">
            {amount > 0 ? formatCurrency(amount) : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── メインコンポーネント ────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter()
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const activeDivision   = useAppStore((s) => s.activeDivision)
  const currentUser      = useAppStore((s) => s.currentUser)
  const localDeals       = useAppStore((s) => s.localDeals)
  const localActivities  = useAppStore((s) => s.localActivities)
  const localTossups     = useAppStore((s) => s.localTossups)
  const teamGoals        = useAppStore((s) => s.teamGoals)
  const taskStatuses     = useAppStore((s) => s.taskStatuses)
  const divisionStages   = useAppStore((s) => s.divisionStages)

  const [dbDivTossups, setDbDivTossups] = useState<Tossup[]>([])
  const [dbDeals,      setDbDeals]      = useState<Deal[]>([])
  const [dbContacts,   setDbContacts]   = useState<Contact[]>([])
  const [dbActivities, setDbActivities] = useState<DbActivity[]>([])

  useEffect(() => {
    if (!activeDivisionId || !isSupabaseConfigured()) return
    fetchTossupsByDivision(activeDivisionId).then(setDbDivTossups)
    fetchDealsByDivision(activeDivisionId).then(setDbDeals)
    fetchContactsByDivision(activeDivisionId).then(setDbContacts)
    fetchActivitiesByDivision(activeDivisionId).then(setDbActivities)
  }, [activeDivisionId])

  // 事業部別ステージから受注/失注IDを動的解決（フォールバック: '受注'/'失注'）
  const divStages = useMemo(() => {
    const divId = activeDivisionId ?? ''
    return divisionStages[divId] ?? DEFAULT_DIVISION_STAGES[divId] ?? null
  }, [divisionStages, activeDivisionId])

  const wonStageIds  = useMemo(() => new Set(divStages ? divStages.filter((s) => s.isWon).map((s) => s.id)  : ['受注']), [divStages])
  const lostStageIds = useMemo(() => new Set(divStages ? divStages.filter((s) => s.isLost).map((s) => s.id) : ['失注']), [divStages])
  const activeStageIds = useMemo(
    () => divStages ? new Set(divStages.filter((s) => !s.isWon && !s.isLost).map((s) => s.id)) : null,
    [divStages]
  )
  const pipelineStageOrder = useMemo(
    () => divStages ? divStages.filter((s) => !s.isWon && !s.isLost).map((s) => s.name) : STAGES_ORDER.filter((s) => s !== '受注'),
    [divStages]
  )

  const isWon    = (stageId: string) => wonStageIds.has(stageId)
  const isLost   = (stageId: string) => lostStageIds.has(stageId)
  const isActive = (stageId: string) => activeStageIds ? activeStageIds.has(stageId) : !isWon(stageId) && !isLost(stageId)

  const [view, setView] = useState<DashView>('personal')

  const allDeals = useMemo(
    () => isSupabaseConfigured() ? [...dbDeals, ...localDeals] : [...(MOCK_DEALS as unknown as Deal[]), ...localDeals],
    [dbDeals, localDeals]
  )
  const allActivities = useMemo(() => {
    if (!isSupabaseConfigured()) return [...(MOCK_ACTIVITIES as unknown as DbActivity[]), ...localActivities]
    const dbIds = new Set(dbActivities.map((a) => a.id))
    const onlyLocal = localActivities.filter((a) => !dbIds.has(a.id))
    return [...onlyLocal, ...dbActivities]
  }, [dbActivities, localActivities])

  // ─── チームデータ ───────────────────────────────────────────────
  const divDeals    = useMemo(() => allDeals.filter((d) => d.division_id === activeDivisionId), [allDeals, activeDivisionId])
  const divContacts = useMemo(
    () => isSupabaseConfigured() ? dbContacts : (MOCK_CONTACTS as unknown as Contact[]).filter((c) => c.division_id === activeDivisionId),
    [dbContacts, activeDivisionId]
  )
  const divTossups  = useMemo((): Tossup[] => {
    if (isSupabaseConfigured()) return dbDivTossups
    return localTossups.filter((t) => t.from_division_id === activeDivisionId || t.to_division_id === activeDivisionId)
  }, [dbDivTossups, localTossups, activeDivisionId])
  const divContactIds = useMemo(() => new Set(divContacts.map((c) => c.id)), [divContacts])
  const divDealIds    = useMemo(() => new Set(divDeals.map((d) => d.id)), [divDeals])
  const divActivities = useMemo(
    () => allActivities.filter((a) =>
      (a.target_type === 'contact' && divContactIds.has(a.target_id)) ||
      (a.target_type === 'deal'    && divDealIds.has(a.target_id))
    ),
    [allActivities, divContactIds, divDealIds]
  )

  const teamActiveDeals   = divDeals.filter((d) => isActive(d.stage_id))
  const teamWonDeals      = divDeals.filter((d) => isWon(d.stage_id))
  const teamClosedDeals   = divDeals.filter((d) => isWon(d.stage_id) || isLost(d.stage_id))
  const teamWinRate       = teamClosedDeals.length > 0 ? Math.round((teamWonDeals.length / teamClosedDeals.length) * 100) : null
  const teamWonAmountMonth = teamWonDeals.filter((d) => isSameMonth(d.updated_at)).reduce((s, d) => s + d.amount, 0)
  const teamNewContactsMonth = divContacts.filter((c) => isSameMonth(c.created_at)).length
  const teamTossupMonth   = divTossups.filter((t) => isSameMonth(t.created_at)).length
  const teamStaleCount    = teamActiveDeals.filter((d) => getStaleDays(d.updated_at) >= 5).length

  const teamTasks      = divActivities.filter((a) => a.activity_type === 'task' && (taskStatuses[a.id] ?? a.status) !== 'done')
  const teamOverdue    = teamTasks.filter((t) => t.due_date && daysUntil(t.due_date) < 0)
  const teamToday      = teamTasks.filter((t) => t.due_date && daysUntil(t.due_date) === 0)
  const teamUpcoming   = teamTasks.filter((t) => t.due_date && daysUntil(t.due_date) > 0 && daysUntil(t.due_date) <= 3)
  const teamClosingSoon = teamActiveDeals
    .filter((d) => d.close_date && daysUntil(d.close_date) >= 0 && daysUntil(d.close_date) <= 30)
    .sort((a, b) => new Date(a.close_date!).getTime() - new Date(b.close_date!).getTime())

  // ─── 個人データ ─────────────────────────────────────────────────
  const myDeals = useMemo(
    () => allDeals.filter((d) => d.assigned_user_id === currentUser?.id),
    [allDeals, currentUser?.id]
  )
  const myActiveDeals = myDeals.filter((d) => isActive(d.stage_id))
  const myWonDeals    = myDeals.filter((d) => isWon(d.stage_id))
  const myWonAmountMonth = myWonDeals.filter((d) => isSameMonth(d.updated_at)).reduce((s, d) => s + d.amount, 0)
  const myClosedDeals = myDeals.filter((d) => isWon(d.stage_id) || isLost(d.stage_id))
  const myWinRate     = myClosedDeals.length > 0 ? Math.round((myWonDeals.length / myClosedDeals.length) * 100) : null

  const myActivities      = useMemo(
    () => allActivities.filter((a) => a.user_id === currentUser?.id),
    [allActivities, currentUser?.id]
  )
  const myActivitiesMonth  = myActivities.filter((a) => isSameMonth(a.action_date))
  const myActivitiesWeek   = myActivities.filter((a) => isSameWeek(a.action_date))
  const myAssignedContacts = useMemo(
    () => isSupabaseConfigured()
      ? dbContacts.filter((c) => c.assigned_user_id === currentUser?.id)
      : (MOCK_CONTACTS as unknown as Contact[]).filter((c) => c.assigned_user_id === currentUser?.id),
    [dbContacts, currentUser?.id]
  )

  const myTasks = useMemo(
    () => allActivities
      .filter((a) => a.user_id === currentUser?.id && a.activity_type === 'task' && (taskStatuses[a.id] ?? a.status) !== 'done')
      .sort((a, b) => {
        // 期限切れ → 今日 → 近い順 → 期限なし
        const da = a.due_date ? daysUntil(a.due_date) : 9999
        const db = b.due_date ? daysUntil(b.due_date) : 9999
        return da - db
      }),
    [allActivities, currentUser?.id, taskStatuses]
  )
  const myOverdue  = myTasks.filter((t) => t.due_date && daysUntil(t.due_date) < 0)

  // タスクに紐づく顧客ページへのナビゲーションパスを解決
  const getTaskNavPath = (task: typeof myTasks[0]): string => {
    if (task.target_type === 'contact') return `/contacts/${task.target_id}`
    if (task.target_type === 'deal') {
      const deal = allDeals.find((d) => d.id === task.target_id)
      if (deal?.contact_id) return `/contacts/${deal.contact_id}`
    }
    return '/activities'
  }
  const myClosingSoon = myActiveDeals
    .filter((d) => d.close_date && daysUntil(d.close_date) >= 0 && daysUntil(d.close_date) <= 30)
    .sort((a, b) => new Date(a.close_date!).getTime() - new Date(b.close_date!).getTime())

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'おはようございます'
    if (h < 18) return 'こんにちは'
    return 'お疲れ様です'
  })()
  const displayName = firstNameFrom(currentUser?.name ?? '')

  return (
    <div className="space-y-6 w-full">
      {/* ─── ヘッダー + ビュー切り替え ─── */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-800">ダッシュボード</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {greeting}、{displayName}さん。
            {(view === 'team' || view === 'manager') && activeDivision && (
              <span className="font-medium text-gray-600"> {activeDivision.name}</span>
            )}
            {view === 'team' ? ' チームのデータを表示中' : view === 'manager' ? ' チーム管理モード' : ' 個人の進捗を表示中'}
          </p>
        </div>

        {/* 個人 / チーム / チーム管理 トグル */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => setView('personal')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
              view === 'personal' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <User size={14} />
            個人
          </button>
          <button
            onClick={() => setView('team')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
              view === 'team' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <Users size={14} />
            チーム
            {activeDivision && <span className="text-xs opacity-60">({activeDivision.name})</span>}
          </button>
          {(currentUser?.role === 'manager' || currentUser?.role === 'super_admin') && (
            <button
              onClick={() => setView('manager')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                view === 'manager' ? 'bg-white shadow-sm text-orange-600' : 'text-gray-500 hover:text-gray-700'
              )}
            >
              <Crown size={14} />
              チーム管理
            </button>
          )}
        </div>
      </div>

      {/* ─── Today's Mission（チーム管理モード以外で表示） ─── */}
      {view !== 'manager' && <DailyMission personalMode={view === 'personal'} />}

      {/* ════════════ チーム管理ビュー ════════════ */}
      {view === 'manager' && <ManagerView divisionId={activeDivisionId} />}

      {/* ════════════ 個人ビュー ════════════ */}
      {view === 'personal' && (
        <>
          {/* 個人 KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              label="担当商談"
              value={myActiveDeals.length}
              unit="件"
              sublabel={`見込み額 ${formatCurrency(myActiveDeals.reduce((s, d) => s + d.amount, 0))}`}
              icon={<Briefcase size={18} />}
            />
            <KPICard
              label="担当顧客"
              value={myAssignedContacts.length}
              unit="社"
              sublabel={`商談あり ${new Set(myDeals.map((d) => d.contact_id)).size}社`}
              icon={<Users size={18} />}
            />
            <KPICard
              label="今月の活動"
              value={myActivitiesMonth.length}
              unit="件"
              sublabel={`今週 ${myActivitiesWeek.length}件`}
              icon={<Activity size={18} />}
            />
            <KPICard
              label="今月の受注額"
              value={myWonAmountMonth === 0 ? '—' : `${(myWonAmountMonth / 10000).toFixed(0)}万`}
              sublabel={myWinRate !== null ? `成約率 ${myWinRate}%` : '成約実績なし'}
              icon={<TrendingUp size={18} />}
              highlight
            />
          </div>

          {/* 今月の目標進捗（マネージャーが設定した場合のみ表示） */}
          {(() => {
            const now = new Date()
            const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
            const goal = currentUser ? teamGoals[currentUser.id] : undefined
            if (!goal || goal.month !== monthKey) return null
            const items = [
              goal.dealAmount && { label: '今月の受注目標', actual: myWonAmountMonth, goal: goal.dealAmount, fmt: (n: number) => `${(n/10000).toFixed(0)}万円` },
              goal.contactCount && { label: '新規顧客目標', actual: myAssignedContacts.filter((c) => { const d = new Date(c.created_at); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() }).length, goal: goal.contactCount, fmt: (n: number) => `${n}社` },
              goal.activityCount && { label: '活動数目標', actual: myActivitiesMonth.length, goal: goal.activityCount, fmt: (n: number) => `${n}件` },
            ].filter(Boolean) as { label: string; actual: number; goal: number; fmt: (n: number) => string }[]
            if (items.length === 0) return null
            return (
              <div className="bg-white border border-orange-100 rounded-2xl shadow-sm p-5">
                <p className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                  <Target size={15} className="text-orange-500" />
                  今月の目標進捗
                  <span className="text-xs font-normal text-gray-400">マネージャーが設定した目標</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {items.map(({ label, actual, goal: g, fmt }) => {
                    const pct = Math.min(Math.round((actual / g) * 100), 100)
                    const over = actual >= g
                    return (
                      <div key={label}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-gray-500">{label}</span>
                          <span className={cn('font-bold', over ? 'text-green-600' : 'text-gray-700')}>
                            {fmt(actual)} / {fmt(g)} {over && '✓'}
                          </span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className={cn('h-2 rounded-full transition-all', over ? 'bg-green-400' : pct >= 70 ? 'bg-orange-400' : 'bg-orange-200')}
                            style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{pct}%達成</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* 個人アラート */}
          {(myOverdue.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button onClick={() => router.push('/activities')}
                className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-left hover:bg-red-100 transition-colors">
                <AlertCircle size={18} className="text-red-500 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-red-700">期限切れタスク</p>
                  <p className="text-xs text-red-600">{myOverdue.length}件のタスクが期限を過ぎています</p>
                </div>
                <span className="text-xs text-red-600 font-medium">確認する →</span>
              </button>
            </div>
          )}

          {/* 個人パイプライン + タスク */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-gray-800">自分の担当商談</h2>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">
                    見込み額合計 {formatCurrency(myActiveDeals.reduce((s, d) => s + d.amount, 0))}
                  </span>
                  <button onClick={() => router.push('/deals')} className="text-xs text-orange-600 hover:underline">
                    カンバンで見る →
                  </button>
                </div>
              </div>
              <PipelineChart activeDeals={myActiveDeals} stageOrder={pipelineStageOrder} />
            </div>

            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-gray-800 flex items-center gap-2">
                  <CheckSquare size={16} className="text-orange-500" />
                  自分のタスク
                </h2>
                <button onClick={() => router.push('/tasks')} className="text-xs text-orange-600 hover:underline">すべて見る</button>
              </div>
              {myTasks.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-2xl mb-2">🎉</p>
                  <p className="text-sm font-medium text-gray-600">タスクは完了！</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {myTasks.slice(0, 5).map((t) => (
                    <TaskCard key={t.id} task={t}
                      onClick={() => router.push(getTaskNavPath(t))} />
                  ))}
                  {myTasks.length > 5 && (
                    <button
                      onClick={() => router.push('/activities')}
                      className="w-full text-xs text-orange-600 hover:underline pt-1 text-center"
                    >
                      他 {myTasks.length - 5}件のタスクを見る →
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 個人クロージング間近 */}
          {myClosingSoon.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-gray-800 flex items-center gap-2">
                  <CalendarClock size={16} className="text-orange-500" />
                  自分の担当でクロージング間近
                </h2>
                <span className="text-xs text-gray-400">{myClosingSoon.length}件</span>
              </div>
              <ClosingSoonTable deals={myClosingSoon} onRowClick={() => router.push('/deals')} />
            </div>
          )}

          {/* 個人活動タイムライン */}
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-gray-800">自分の活動履歴</h2>
                <p className="text-xs text-gray-400 mt-0.5">自分が記録した直近の活動</p>
              </div>
              <button onClick={() => router.push('/activities')} className="text-xs text-orange-600 hover:underline">すべて見る</button>
            </div>
            {myActivities.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">まだ活動を記録していません</div>
            ) : (
              <MyActivityList
                activities={myActivities.slice(0, 6)}
                contactsById={new Map(divContacts.map((c) => [c.id, c]))}
                onContactClick={(id) => router.push(`/contacts/${id}`)}
              />
            )}
          </div>
        </>
      )}

      {/* ════════════ チームビュー ════════════ */}
      {view === 'team' && (
        <>
          {/* チーム KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              label="進行中の商談"
              value={teamActiveDeals.length}
              unit="件"
              sublabel={`見込み額合計 ${formatCurrency(teamActiveDeals.reduce((s, d) => s + d.amount, 0))}`}
              icon={<Briefcase size={18} />}
            />
            <KPICard
              label="新規顧客（今月）"
              value={teamNewContactsMonth}
              unit="社"
              sublabel={`累計 ${divContacts.length}社`}
              icon={<Users size={18} />}
            />
            <KPICard
              label="トスアップ（今月）"
              value={teamTossupMonth}
              unit="件"
              sublabel={`累計 ${divTossups.length}件`}
              icon={<ArrowLeftRight size={18} />}
            />
            <KPICard
              label="今月の受注額"
              value={teamWonAmountMonth === 0 ? '—' : `${(teamWonAmountMonth / 10000).toFixed(0)}万`}
              sublabel={teamWinRate !== null ? `成約率 ${teamWinRate}%` : '成約実績なし'}
              icon={<TrendingUp size={18} />}
              highlight
            />
          </div>

          {/* チームアラート */}
          {(teamStaleCount > 0 || teamOverdue.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {teamStaleCount > 0 && (
                <button onClick={() => router.push('/deals')}
                  className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-left hover:bg-red-100 transition-colors">
                  <AlertCircle size={18} className="text-red-500 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-red-700">滞留商談あり</p>
                    <p className="text-xs text-red-600">{teamStaleCount}件が5日以上更新されていません</p>
                  </div>
                  <span className="text-xs text-red-600 font-medium">確認する →</span>
                </button>
              )}
              {teamOverdue.length > 0 && (
                <button onClick={() => router.push('/activities')}
                  className="flex items-center gap-3 px-4 py-3 bg-yellow-50 border border-yellow-200 rounded-xl text-left hover:bg-yellow-100 transition-colors">
                  <Clock size={18} className="text-yellow-600 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-yellow-700">期限切れタスク</p>
                    <p className="text-xs text-yellow-600">{teamOverdue.length}件のタスクが期限を過ぎています</p>
                  </div>
                  <span className="text-xs text-yellow-700 font-medium">確認する →</span>
                </button>
              )}
            </div>
          )}

          {/* チームパイプライン + タスク */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-gray-800">パイプライン進捗</h2>
                <span className="text-xs text-gray-400">
                  見込み額合計 {formatCurrency(teamActiveDeals.reduce((s, d) => s + d.amount, 0))}
                </span>
              </div>
              <PipelineChart activeDeals={teamActiveDeals} stageOrder={pipelineStageOrder} />
            </div>

            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-gray-800 flex items-center gap-2">
                  <CheckSquare size={16} className="text-orange-500" />
                  今日のタスク
                </h2>
                <button onClick={() => router.push('/tasks')} className="text-xs text-orange-600 hover:underline">すべて見る</button>
              </div>
              {teamOverdue.length + teamToday.length + teamUpcoming.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-2xl mb-2">🎉</p>
                  <p className="text-sm font-medium text-gray-600">今日のタスクは完了！</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {[...teamOverdue, ...teamToday, ...teamUpcoming].map((t) => (
                    <TaskCard key={t.id} task={t}
                      onClick={() => router.push(t.target_type === 'contact' ? `/contacts/${t.target_id}` : '/activities')} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* チームクロージング間近 */}
          {teamClosingSoon.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-gray-800 flex items-center gap-2">
                  <CalendarClock size={16} className="text-orange-500" />
                  クロージング間近（30日以内）
                </h2>
                <span className="text-xs text-gray-400">{teamClosingSoon.length}件</span>
              </div>
              <ClosingSoonTable deals={teamClosingSoon} onRowClick={() => router.push('/deals')} />
            </div>
          )}

          {/* チームタイムライン */}
          <RealtimeTimeline />
        </>
      )}
    </div>
  )
}

// ─── 共有サブコンポーネント ───────────────────────────────────────
function ClosingSoonTable({
  deals, onRowClick,
}: { deals: { id: string; title: string; contacts?: { name?: string } | null; amount: number; close_date?: string }[]; onRowClick: () => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-400 border-b border-gray-100">
            <th className="text-left py-2 font-medium">商談名</th>
            <th className="text-left py-2 font-medium">顧客</th>
            <th className="text-right py-2 font-medium">見込み額</th>
            <th className="text-right py-2 font-medium">期限</th>
            <th className="text-right py-2 font-medium">残日数</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {deals.map((deal) => {
            const days = daysUntil(deal.close_date!)
            return (
              <tr key={deal.id} onClick={onRowClick} className="hover:bg-orange-50 cursor-pointer transition-colors">
                <td className="py-2.5 font-medium text-gray-800 max-w-40 truncate">{deal.title}</td>
                <td className="py-2.5 text-gray-500 truncate max-w-32">{deal.contacts?.name ?? '—'}</td>
                <td className="py-2.5 text-right font-bold text-gray-700">{formatCurrency(deal.amount)}</td>
                <td className="py-2.5 text-right text-gray-500">{formatDate(deal.close_date!)}</td>
                <td className="py-2.5 text-right">
                  <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full',
                    days <= 7 ? 'bg-red-100 text-red-600' : days <= 14 ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-600')}>
                    {days}日
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MyActivityList({
  activities, contactsById, onContactClick,
}: {
  activities: { id: string; activity_type: string; title?: string; memo?: string; action_date: string; target_type: string; target_id: string }[]
  contactsById: Map<string, Contact>
  onContactClick: (id: string) => void
}) {
  const TYPE_LABEL: Record<string, string> = {
    call: '電話', email: 'メール', meeting: '面談', task: 'タスク', tossup: 'トスアップ', note: 'メモ',
  }
  const TYPE_COLOR: Record<string, string> = {
    call: 'bg-blue-100 text-blue-600', email: 'bg-purple-100 text-purple-600',
    meeting: 'bg-green-100 text-green-600', task: 'bg-yellow-100 text-yellow-600',
    tossup: 'bg-orange-100 text-orange-600', note: 'bg-gray-100 text-gray-600',
  }

  return (
    <ul className="divide-y divide-gray-50">
      {activities.map((a) => {
        const contact = a.target_type === 'contact' ? contactsById.get(a.target_id) : undefined
        return (
          <li key={a.id}
            className="flex gap-3 px-5 py-3.5 hover:bg-gray-50 cursor-pointer transition-colors"
            onClick={() => contact && onContactClick(contact.id)}>
            <span className={cn('text-xs font-semibold px-2 py-0.5 rounded self-start mt-0.5 whitespace-nowrap', TYPE_COLOR[a.activity_type])}>
              {TYPE_LABEL[a.activity_type] ?? a.activity_type}
            </span>
            <div className="flex-1 min-w-0">
              {a.title && <p className="text-sm font-medium text-gray-700 truncate">{a.title}</p>}
              {contact && <p className="text-xs text-gray-400 mt-0.5 truncate">{contact.name}（{contact.companies?.name ?? ''}）</p>}
            </div>
            <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">{formatRelativeTime(a.action_date)}</span>
          </li>
        )
      })}
    </ul>
  )
}
