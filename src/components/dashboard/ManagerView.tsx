'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  TrendingUp, CheckSquare, Activity, Target,
  AlertCircle, ChevronDown, ChevronUp, Edit2, Check, X,
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import type { TeamGoal } from '@/store/appStore'
import { MOCK_CONTACTS, MOCK_DEALS, MOCK_ACTIVITIES, MOCK_TEAM_MEMBERS } from '@/lib/mock-data'
import { formatCurrency, getInitials, cn } from '@/lib/utils'
import type { User } from '@/types/database'

function isSameMonth(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}
function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}
const currentMonthKey = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// ─── 目標達成率バー ─────────────────────────────────────────────
function GoalBar({ label, actual, goal, format }: {
  label: string; actual: number; goal?: number; format: (n: number) => string
}) {
  if (!goal) return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-700">{format(actual)}</span>
    </div>
  )
  const pct = Math.min(Math.round((actual / goal) * 100), 100)
  const over = actual >= goal
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-500">{label}</span>
        <span className={cn('font-medium', over ? 'text-green-600' : 'text-gray-700')}>
          {format(actual)} / {format(goal)}
          {over && ' ✓'}
        </span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-1.5">
        <div
          className={cn('h-1.5 rounded-full transition-all', over ? 'bg-green-400' : pct >= 70 ? 'bg-orange-400' : 'bg-orange-200')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ─── 目標設定フォーム ────────────────────────────────────────────
function GoalEditor({ member, current, onSave, onCancel }: {
  member: User; current?: TeamGoal; onSave: (goal: TeamGoal) => void; onCancel: () => void
}) {
  const [dealAmount, setDealAmount]     = useState(current?.dealAmount ? String(current.dealAmount / 10000) : '')
  const [contactCount, setContactCount] = useState(current?.contactCount ? String(current.contactCount) : '')
  const [activityCount, setActivityCount] = useState(current?.activityCount ? String(current.activityCount) : '')

  const handleSave = () => {
    onSave({
      month: currentMonthKey(),
      dealAmount: dealAmount ? parseInt(dealAmount, 10) * 10000 : undefined,
      contactCount: contactCount ? parseInt(contactCount, 10) : undefined,
      activityCount: activityCount ? parseInt(activityCount, 10) : undefined,
    })
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
      <p className="text-xs font-bold text-gray-500 mb-2">今月の目標を設定 — {member.name}</p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">受注目標（万円）</label>
          <input type="number" value={dealAmount} onChange={(e) => setDealAmount(e.target.value)}
            placeholder="例: 100"
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">新規顧客（件）</label>
          <input type="number" value={contactCount} onChange={(e) => setContactCount(e.target.value)}
            placeholder="例: 5"
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">活動数（件）</label>
          <input type="number" value={activityCount} onChange={(e) => setActivityCount(e.target.value)}
            placeholder="例: 20"
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50" />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <X size={12} />キャンセル
        </button>
        <button onClick={handleSave}
          className="flex items-center gap-1 text-xs text-white bg-orange-500 hover:bg-orange-600 px-3 py-1.5 rounded-lg transition-colors font-medium">
          <Check size={12} />保存
        </button>
      </div>
    </div>
  )
}

// ─── メンバーカード ──────────────────────────────────────────────
function MemberCard({ member, divisionId }: { member: User; divisionId: string | null }) {
  const router = useRouter()
  const { teamGoals, setTeamGoal, taskStatuses, localDeals, localActivities } = useAppStore()
  const [showGoalEditor, setShowGoalEditor] = useState(false)
  const [showTasks, setShowTasks] = useState(false)

  const allDeals      = useMemo(() => [...MOCK_DEALS, ...localDeals], [localDeals])
  const allActivities = useMemo(() => [...MOCK_ACTIVITIES, ...localActivities], [localActivities])

  // この営業担当のデータ（事業部フィルタあり）
  const myDeals = allDeals.filter(
    (d) => d.assigned_user_id === member.id && (!divisionId || d.division_id === divisionId)
  )
  const myActiveDeals   = myDeals.filter((d) => d.stage_id !== '受注' && d.stage_id !== '失注')
  const myWonDeals      = myDeals.filter((d) => d.stage_id === '受注')
  const myWonAmountMonth = myWonDeals.filter((d) => isSameMonth(d.updated_at)).reduce((s, d) => s + d.amount, 0)

  const myActivities      = allActivities.filter((a) => a.user_id === member.id)
  const myActivitiesMonth = myActivities.filter((a) => isSameMonth(a.action_date))

  const myNewContactsMonth = MOCK_CONTACTS.filter(
    (c) => c.assigned_user_id === member.id && isSameMonth(c.created_at)
  ).length

  const myTasks = allActivities.filter(
    (a) => a.user_id === member.id && a.activity_type === 'task' && (taskStatuses[a.id] ?? a.status) !== 'done'
  )
  const myOverdueTasks = myTasks.filter((t) => t.due_date && daysUntil(t.due_date) < 0)
  const myTodayTasks   = myTasks.filter((t) => t.due_date && daysUntil(t.due_date) === 0)

  const goal = teamGoals[member.id]
  const goalIsCurrentMonth = goal?.month === currentMonthKey()
  const activeGoal = goalIsCurrentMonth ? goal : undefined

  const handleSaveGoal = (g: TeamGoal) => {
    setTeamGoal(member.id, g)
    setShowGoalEditor(false)
  }

  const closedDeals = myDeals.filter((d) => d.stage_id === '受注' || d.stage_id === '失注')
  const winRate = closedDeals.length > 0 ? Math.round((myWonDeals.length / closedDeals.length) * 100) : null

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 flex flex-col">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-sm flex-shrink-0">
          {getInitials(member.name)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-800 text-sm truncate">{member.name}</p>
          <p className="text-xs text-gray-400">
            {member.role === 'manager' ? 'マネージャー' : '営業'}
          </p>
        </div>
        <button
          onClick={() => { setShowGoalEditor((v) => !v); setShowTasks(false) }}
          className={cn(
            'flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-all',
            showGoalEditor ? 'bg-orange-500 text-white border-orange-500' : 'text-gray-500 border-gray-200 hover:border-orange-300 hover:text-orange-600'
          )}
        >
          <Edit2 size={11} />
          目標設定
        </button>
      </div>

      {/* 指標サマリー */}
      <div className="space-y-2.5 flex-1">
        <GoalBar
          label="今月の受注額"
          actual={myWonAmountMonth}
          goal={activeGoal?.dealAmount}
          format={(n) => n === 0 ? '¥0' : `${(n / 10000).toFixed(0)}万円`}
        />
        <GoalBar
          label="今月の新規顧客"
          actual={myNewContactsMonth}
          goal={activeGoal?.contactCount}
          format={(n) => `${n}社`}
        />
        <GoalBar
          label="今月の活動数"
          actual={myActivitiesMonth.length}
          goal={activeGoal?.activityCount}
          format={(n) => `${n}件`}
        />

        {/* 追加指標 */}
        <div className="pt-2 border-t border-gray-50 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">進行中の商談</span>
            <span className="font-medium text-gray-700">
              {myActiveDeals.length}件
              <span className="text-gray-400 ml-1">
                ({formatCurrency(myActiveDeals.reduce((s, d) => s + d.amount, 0))})
              </span>
            </span>
          </div>
          {winRate !== null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">成約率</span>
              <span className={cn('font-bold', winRate >= 50 ? 'text-green-600' : 'text-orange-500')}>
                {winRate}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* タスク状況 */}
      <button
        onClick={() => { setShowTasks((v) => !v); setShowGoalEditor(false) }}
        className={cn(
          'mt-3 pt-3 border-t border-gray-50 w-full flex items-center justify-between text-xs transition-colors',
          myOverdueTasks.length > 0 ? 'text-red-500' : 'text-gray-500'
        )}
      >
        <div className="flex items-center gap-2">
          <CheckSquare size={13} />
          <span>
            未完了タスク {myTasks.length}件
            {myOverdueTasks.length > 0 && (
              <span className="ml-1.5 font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">
                期限切れ {myOverdueTasks.length}件
              </span>
            )}
            {myTodayTasks.length > 0 && (
              <span className="ml-1.5 font-bold text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full">
                本日期限 {myTodayTasks.length}件
              </span>
            )}
          </span>
        </div>
        {myTasks.length > 0 && (showTasks ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
      </button>

      {/* タスク一覧（展開時） */}
      {showTasks && myTasks.length > 0 && (
        <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
          {[...myOverdueTasks, ...myTodayTasks, ...myTasks.filter((t) => {
            if (!t.due_date) return true
            const d = daysUntil(t.due_date)
            return d > 0
          })].slice(0, 6).map((task) => {
            const days = task.due_date ? daysUntil(task.due_date) : null
            const isOverdue = days !== null && days < 0
            const isToday   = days === 0
            const contact = task.target_type === 'contact'
              ? MOCK_CONTACTS.find((c) => c.id === task.target_id)
              : null
            return (
              <button key={task.id}
                onClick={() => contact ? router.push(`/contacts/${contact.id}`) : router.push('/activities')}
                className={cn(
                  'w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors',
                  isOverdue ? 'bg-red-50 hover:bg-red-100 text-red-700' :
                  isToday ? 'bg-orange-50 hover:bg-orange-100 text-orange-700' :
                  'bg-gray-50 hover:bg-gray-100 text-gray-700'
                )}>
                <p className="font-medium truncate">{task.title ?? 'タスク'}</p>
                <p className={cn('text-xs mt-0.5', isOverdue ? 'text-red-400' : isToday ? 'text-orange-400' : 'text-gray-400')}>
                  {contact ? `${contact.name} · ` : ''}
                  {isOverdue ? `期限切れ ${Math.abs(days!)}日` : isToday ? '本日期限' : days !== null ? `${days}日後` : '期限未設定'}
                </p>
              </button>
            )
          })}
        </div>
      )}

      {/* 目標設定フォーム */}
      {showGoalEditor && (
        <GoalEditor
          member={member}
          current={activeGoal}
          onSave={handleSaveGoal}
          onCancel={() => setShowGoalEditor(false)}
        />
      )}
    </div>
  )
}

// ─── メインのマネージャービュー ──────────────────────────────────
export function ManagerView({ divisionId }: { divisionId: string | null }) {
  const router = useRouter()
  const { localDeals, localActivities, taskStatuses } = useAppStore()

  const allDeals      = useMemo(() => [...MOCK_DEALS, ...localDeals], [localDeals])
  const allActivities = useMemo(() => [...MOCK_ACTIVITIES, ...localActivities], [localActivities])

  // この事業部のメンバー（MOCK + admin追加ユーザーは今回は省略）
  const teamMembers = MOCK_TEAM_MEMBERS

  // チーム集計
  const divDeals = allDeals.filter((d) => !divisionId || d.division_id === divisionId)
  const divActiveDeals = divDeals.filter((d) => d.stage_id !== '受注' && d.stage_id !== '失注')
  const divWonAmountMonth = divDeals
    .filter((d) => d.stage_id === '受注' && isSameMonth(d.updated_at))
    .reduce((s, d) => s + d.amount, 0)

  const divContactIds = useMemo(
    () => new Set(MOCK_CONTACTS.filter((c) => !divisionId || c.division_id === divisionId).map((c) => c.id)),
    [divisionId]
  )
  const divDealIds = useMemo(() => new Set(divDeals.map((d) => d.id)), [divDeals])

  const divActivitiesMonth = allActivities.filter(
    (a) =>
      isSameMonth(a.action_date) &&
      ((a.target_type === 'contact' && divContactIds.has(a.target_id)) ||
        (a.target_type === 'deal' && divDealIds.has(a.target_id)))
  )
  const divPendingTasks = allActivities.filter(
    (a) =>
      a.activity_type === 'task' &&
      (taskStatuses[a.id] ?? a.status) !== 'done' &&
      ((a.target_type === 'contact' && divContactIds.has(a.target_id)) ||
        (a.target_type === 'deal' && divDealIds.has(a.target_id)))
  )
  const divOverdueTasks = divPendingTasks.filter((t) => t.due_date && daysUntil(t.due_date) < 0)

  return (
    <div className="space-y-6">
      {/* チームKPIサマリー */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'チーム進行中商談',
            value: divActiveDeals.length,
            sub: `見込み ${formatCurrency(divActiveDeals.reduce((s, d) => s + d.amount, 0))}`,
            icon: <TrendingUp size={16} />,
            color: 'text-orange-500',
          },
          {
            label: '今月チーム受注額',
            value: divWonAmountMonth === 0 ? '—' : `${(divWonAmountMonth / 10000).toFixed(0)}万`,
            sub: 'チーム合計',
            icon: <Target size={16} />,
            color: 'text-green-500',
            highlight: true,
          },
          {
            label: '今月の活動数',
            value: divActivitiesMonth.length,
            sub: `メンバー ${teamMembers.length}名`,
            icon: <Activity size={16} />,
            color: 'text-blue-500',
          },
          {
            label: '未完了タスク',
            value: divPendingTasks.length,
            sub: divOverdueTasks.length > 0 ? `期限切れ ${divOverdueTasks.length}件` : '期限切れなし',
            icon: <CheckSquare size={16} />,
            color: divOverdueTasks.length > 0 ? 'text-red-500' : 'text-gray-500',
          },
        ].map(({ label, value, sub, icon, color, highlight }) => (
          <div key={label} className={cn(
            'bg-white border rounded-2xl shadow-sm p-4',
            highlight ? 'border-orange-200 bg-orange-50' : 'border-gray-100'
          )}>
            <div className={cn('flex items-center gap-2 mb-2', color)}>
              {icon}
              <span className="text-xs font-medium text-gray-500">{label}</span>
            </div>
            <p className={cn('text-2xl font-black', highlight ? 'text-orange-600' : 'text-gray-800')}>{value}</p>
            <p className={cn('text-xs mt-0.5', divOverdueTasks.length > 0 && label === '未完了タスク' ? 'text-red-500 font-medium' : 'text-gray-400')}>
              {sub}
            </p>
          </div>
        ))}
      </div>

      {/* 期限切れタスクアラート */}
      {divOverdueTasks.length > 0 && (
        <button
          onClick={() => router.push('/activities')}
          className="w-full flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-left hover:bg-red-100 transition-colors"
        >
          <AlertCircle size={18} className="text-red-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-red-700">チームの期限切れタスクあり</p>
            <p className="text-xs text-red-600">{divOverdueTasks.length}件 — 各メンバーカードで詳細を確認してください</p>
          </div>
          <span className="text-xs text-red-600 font-medium">全タスクを見る →</span>
        </button>
      )}

      {/* メンバーカード */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-800">メンバーごとの進捗</h2>
          <p className="text-xs text-gray-400">目標設定ボタンから今月の目標を入力できます</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {teamMembers.map((member) => (
            <MemberCard key={member.id} member={member} divisionId={divisionId} />
          ))}
        </div>
      </div>
    </div>
  )
}
