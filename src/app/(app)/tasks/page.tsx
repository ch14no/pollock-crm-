'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Zap, Target, Users, User, Plus, Check, X, Trash2,
  AlertCircle, ChevronDown, CheckSquare, Layers,
} from 'lucide-react'
import { MOCK_ACTIVITIES, MOCK_CONTACTS, MOCK_TEAM_MEMBERS } from '@/lib/mock-data'
import { useAppStore } from '@/store/appStore'
import type { Challenge, TaskMeta } from '@/store/appStore'
import { cn, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import toast from 'react-hot-toast'

// ─── 象限設定 ─────────────────────────────────────────────────────
const QUADRANTS = [
  { q: 1, label: 'Q1 今すぐやる',    sub: '緊急 × 重要',     bg: 'bg-red-50',    border: 'border-red-200',    badge: 'bg-red-100 text-red-700',    dot: 'bg-red-500'   },
  { q: 2, label: 'Q2 計画的に',      sub: '非緊急 × 重要',   bg: 'bg-blue-50',   border: 'border-blue-200',   badge: 'bg-blue-100 text-blue-700',  dot: 'bg-blue-500'  },
  { q: 3, label: 'Q3 委任・素早く',  sub: '緊急 × 非重要',   bg: 'bg-yellow-50', border: 'border-yellow-200', badge: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500' },
  { q: 4, label: 'Q4 後回し・削除',  sub: '非緊急 × 非重要', bg: 'bg-gray-50',   border: 'border-gray-200',   badge: 'bg-gray-100 text-gray-500',  dot: 'bg-gray-400'  },
] as const

function getQuadrant(meta: TaskMeta | undefined): 1 | 2 | 3 | 4 {
  if (!meta) return 1
  if (meta.urgency && meta.importance)   return 1
  if (!meta.urgency && meta.importance)  return 2
  if (meta.urgency && !meta.importance)  return 3
  return 4
}

// ─── メインページ ─────────────────────────────────────────────────
export default function TasksPage() {
  const router = useRouter()
  const currentUser      = useAppStore((s) => s.currentUser)
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const localActivities  = useAppStore((s) => s.localActivities)
  const taskStatuses     = useAppStore((s) => s.taskStatuses)
  const setTaskStatus    = useAppStore((s) => s.setTaskStatus)
  const taskMeta         = useAppStore((s) => s.taskMeta)
  const localChallenges  = useAppStore((s) => s.localChallenges)
  const addChallenge     = useAppStore((s) => s.addChallenge)
  const updateChallenge  = useAppStore((s) => s.updateChallenge)
  const removeChallenge  = useAppStore((s) => s.removeChallenge)
  const openActivityModal = useAppStore((s) => s.openActivityModal)

  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'super_admin'

  const [tab, setTab] = useState<'tasks' | 'challenges'>('tasks')
  const [scope, setScope] = useState<'personal' | 'team'>('team')
  const [showChallengeForm, setShowChallengeForm] = useState(false)
  const [challengeForm, setChallengeForm] = useState({ title: '', description: '', scope: 'personal' as 'personal' | 'team', deadline: '' })
  const [expandedQ, setExpandedQ] = useState<Set<number>>(new Set([1, 2, 3, 4]))

  // 全タスク（MOCK + local）
  const allActivities = useMemo(() => [...MOCK_ACTIVITIES, ...localActivities], [localActivities])

  const pendingTasks = useMemo(() => allActivities.filter((a) => {
    if (a.activity_type !== 'task') return false
    const effectiveStatus = taskStatuses[a.id] ?? a.status
    return effectiveStatus !== 'done'
  }), [allActivities, taskStatuses])

  // スコープフィルター
  const filteredTasks = useMemo(() => {
    if (scope === 'team') return pendingTasks  // チーム = 全件表示
    // 個人 = 自分に割り当てられたタスクのみ
    return pendingTasks.filter((t) => t.user_id === currentUser?.id)
  }, [pendingTasks, scope, currentUser?.id])

  // 象限別グループ
  const byQuadrant = useMemo(() => {
    const map: Record<number, typeof filteredTasks> = { 1: [], 2: [], 3: [], 4: [] }
    filteredTasks.forEach((t) => {
      const q = getQuadrant(taskMeta[t.id])
      map[q].push(t)
    })
    return map
  }, [filteredTasks, taskMeta])

  // 課題フィルター
  const filteredChallenges = useMemo(() => {
    const divChallenges = localChallenges.filter((c) => !c.divisionId || c.divisionId === activeDivisionId)
    if (scope === 'team') return divChallenges  // チーム = 全件表示
    return divChallenges.filter((c) => c.userId === currentUser?.id)
  }, [localChallenges, scope, activeDivisionId, currentUser?.id])

  const resolveTarget = (t: typeof pendingTasks[0]) => {
    if (t.target_type === 'contact') {
      const c = MOCK_CONTACTS.find((c) => c.id === t.target_id)
      return c ? `${c.name}（${c.companies?.name ?? ''}）` : null
    }
    return null
  }

  const handleAddChallenge = () => {
    if (!challengeForm.title.trim()) { toast.error('タイトルを入力してください'); return }
    const challenge: Challenge = {
      id: `challenge-${Date.now()}`,
      title: challengeForm.title.trim(),
      description: challengeForm.description.trim() || undefined,
      scope: challengeForm.scope,
      deadline: challengeForm.deadline || undefined,
      createdAt: new Date().toISOString(),
      userId: currentUser?.id ?? '',
      status: 'open',
      divisionId: activeDivisionId ?? undefined,
    }
    addChallenge(challenge)
    toast.success(`課題「${challenge.title}」を追加しました`)
    setChallengeForm({ title: '', description: '', scope: 'personal', deadline: '' })
    setShowChallengeForm(false)
  }

  const CHALLENGE_STATUS = {
    open:        { label: '未着手', color: 'bg-gray-100 text-gray-600' },
    in_progress: { label: '対応中', color: 'bg-blue-100 text-blue-700' },
    done:        { label: '完了',   color: 'bg-green-100 text-green-700' },
  }

  return (
    <div className="w-full space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-800">タスク管理</h1>
          <p className="text-sm text-gray-500">
            未完了 {pendingTasks.length}件 · 課題 {localChallenges.filter((c) => c.status !== 'done').length}件
          </p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => openActivityModal()}>
          タスクを追加
        </Button>
      </div>

      {/* タブ + スコープ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex bg-gray-100 p-1 rounded-xl">
          {([['tasks', <CheckSquare size={14} />, 'タスク'], ['challenges', <Layers size={14} />, '課題']] as const).map(([t, icon, label]) => (
            <button key={t} onClick={() => setTab(t as typeof tab)}
              className={cn('flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
                tab === t ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              {icon}{label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(['personal', 'team'] as const).map((s) => (
            <button key={s} onClick={() => setScope(s)}
              className={cn('flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                scope === s ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-200 text-gray-500 hover:bg-gray-50')}>
              {s === 'personal' ? <><User size={11} />個人</> : <><Users size={11} />チーム</>}
            </button>
          ))}
        </div>
      </div>

      {/* ─── タスク4象限ビュー ─── */}
      {tab === 'tasks' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {QUADRANTS.map(({ q, label, sub, bg, border, badge, dot }) => {
            const tasks = byQuadrant[q] ?? []
            const isExpanded = expandedQ.has(q)
            return (
              <div key={q} className={cn('rounded-2xl border p-4', bg, border)}>
                {/* 象限ヘッダー */}
                <button
                  className="w-full flex items-center justify-between mb-3"
                  onClick={() => setExpandedQ((prev) => { const next = new Set(prev); next.has(q) ? next.delete(q) : next.add(q); return next })}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn('w-2.5 h-2.5 rounded-full', dot)} />
                    <span className="font-bold text-gray-700 text-sm">{label}</span>
                    <span className="text-xs text-gray-400">{sub}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-bold', badge)}>{tasks.length}</span>
                    <ChevronDown size={14} className={cn('text-gray-400 transition-transform', !isExpanded && '-rotate-90')} />
                  </div>
                </button>

                {/* タスク一覧 */}
                {isExpanded && (
                  <div className="space-y-2">
                    {tasks.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">タスクなし</p>
                    ) : tasks.map((task) => {
                      const target = resolveTarget(task)
                      const assignee = MOCK_TEAM_MEMBERS.find((m) => m.id === task.user_id)
                      const isMyTask = task.user_id === currentUser?.id
                      return (
                        <div key={task.id}
                          className="bg-white rounded-xl p-3 border border-white/80 shadow-sm cursor-pointer hover:shadow-md transition-all"
                          onClick={() => target && router.push(`/contacts/${task.target_id}`)}>
                          <div className="flex items-start gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); if (isMyTask) setTaskStatus(task.id, 'done') }}
                              disabled={!isMyTask}
                              className={cn('mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                                isMyTask ? 'border-gray-300 hover:border-orange-400 cursor-pointer' : 'border-gray-200 cursor-not-allowed opacity-50')}
                              title={isMyTask ? '完了にする' : '自分のタスクではありません'}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-700 truncate">{task.title ?? 'タスク'}</p>
                              {target && <p className="text-xs text-gray-400 truncate">{target}</p>}
                              <div className="flex items-center gap-2 mt-1">
                                {task.due_date && (
                                  <span className="text-xs text-gray-400">{formatDate(task.due_date)}</span>
                                )}
                                {assignee && !isMyTask && (
                                  <span className="text-xs bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded-full">
                                    {assignee.name}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {/* 象限内タスク追加ショートカット */}
                    <button
                      onClick={() => openActivityModal()}
                      className="w-full flex items-center justify-center gap-1 py-2 text-xs text-gray-400 hover:text-orange-500 hover:bg-white/60 rounded-xl transition-colors">
                      <Plus size={13} />追加
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ─── 課題管理ビュー ─── */}
      {tab === 'challenges' && (
        <div className="space-y-4">
          {/* 追加ボタン */}
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setShowChallengeForm((v) => !v)}>
              課題を追加
            </Button>
          </div>

          {/* 追加フォーム */}
          {showChallengeForm && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3 shadow-sm">
              <p className="text-sm font-bold text-gray-700">新しい課題を追加</p>
              <input type="text" value={challengeForm.title} onChange={(e) => setChallengeForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="課題のタイトル（例：エンジニアのスキルシート格納フォルダを作る）"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
              <textarea value={challengeForm.description} onChange={(e) => setChallengeForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="詳細・背景（任意）" rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">スコープ</label>
                  <div className="flex gap-1.5">
                    {(['personal', 'team'] as const).map((s) => (
                      <button key={s} type="button" onClick={() => setChallengeForm((f) => ({ ...f, scope: s }))}
                        className={cn('flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
                          challengeForm.scope === s ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-200 text-gray-500 hover:bg-gray-50')}>
                        {s === 'personal' ? <><User size={11} />個人</> : <><Users size={11} />チーム</>}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">期限（任意）</label>
                  <input type="date" value={challengeForm.deadline} onChange={(e) => setChallengeForm((f) => ({ ...f, deadline: e.target.value }))}
                    className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowChallengeForm(false)}
                  className="flex items-center gap-1 text-xs text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-100"><X size={12} />キャンセル</button>
                <button onClick={handleAddChallenge}
                  className="flex items-center gap-1 text-xs text-white bg-orange-500 px-3 py-1.5 rounded-lg hover:bg-orange-600 font-medium"><Check size={12} />追加</button>
              </div>
            </div>
          )}

          {/* 課題一覧 */}
          {filteredChallenges.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center">
              <AlertCircle size={32} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 font-medium">課題がありません</p>
              <p className="text-sm text-gray-400 mt-1">長期的に取り組むべき課題をここに記録しましょう</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredChallenges.map((challenge) => {
                const statusCfg = CHALLENGE_STATUS[challenge.status]
                const isOwn = challenge.userId === currentUser?.id
                const isOverdue = challenge.deadline && new Date(challenge.deadline) < new Date() && challenge.status !== 'done'
                return (
                  <div key={challenge.id} className={cn(
                    'bg-white border rounded-2xl p-4 transition-all',
                    challenge.status === 'done' ? 'opacity-60 border-gray-100' :
                    isOverdue ? 'border-red-200 bg-red-50/30' : 'border-gray-100 hover:shadow-sm'
                  )}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className={cn('text-sm font-medium text-gray-800', challenge.status === 'done' && 'line-through text-gray-400')}>
                            {challenge.title}
                          </p>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', statusCfg.color)}>{statusCfg.label}</span>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium',
                            challenge.scope === 'team' ? 'border-blue-200 text-blue-600 bg-blue-50' : 'border-gray-200 text-gray-500')}>
                            {challenge.scope === 'team' ? <span className="flex items-center gap-1"><Users size={10} />チーム</span> : <span className="flex items-center gap-1"><User size={10} />個人</span>}
                          </span>
                          {isOverdue && <span className="text-xs text-red-600 font-medium">期限超過</span>}
                        </div>
                        {challenge.description && (
                          <p className="text-xs text-gray-500 mt-0.5">{challenge.description}</p>
                        )}
                        {challenge.deadline && (
                          <p className="text-xs text-gray-400 mt-1">期限: {formatDate(challenge.deadline)}</p>
                        )}
                      </div>

                      {/* ステータス変更 + 削除 */}
                      {isOwn && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <select
                            value={challenge.status}
                            onChange={(e) => updateChallenge(challenge.id, { status: e.target.value as Challenge['status'] })}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                          >
                            <option value="open">未着手</option>
                            <option value="in_progress">対応中</option>
                            <option value="done">完了</option>
                          </select>
                          <button onClick={() => { removeChallenge(challenge.id); toast.success('課題を削除しました') }}
                            className="p-1 text-gray-300 hover:text-red-500 rounded-lg transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
