'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users, User, Plus, Check, X, Trash2,
  AlertCircle, ChevronDown, CheckSquare, Layers, Kanban,
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import type { Challenge, TaskMeta } from '@/store/appStore'
import { cn, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchActivitiesByUser, fetchActivitiesByContactIds, updateActivityStatus, deleteActivity, updateActivityFields, reassignTask, fetchTaskKanbanStages } from '@/lib/db/activities'
import { fetchContactsByDivision } from '@/lib/db/contacts'
import { fetchDivisionUsers } from '@/lib/db/users'
import { fetchChallenges, createChallenge, updateChallengeStatus, deleteChallenge } from '@/lib/db/challenges'
import { DEFAULT_DIVISION_TASK_STAGES } from '@/lib/mock-data'
import { TaskKanbanBoard } from '@/components/tasks/TaskKanbanBoard'
import type { Activity, Contact, User as UserType } from '@/types/database'
import toast from 'react-hot-toast'

// ─── 象限設定 ─────────────────────────────────────────────────────
const QUADRANTS = [
  { q: 1, label: 'Q1 今すぐやる',    sub: '緊急 × 重要',     bg: 'bg-red-50',    border: 'border-red-200',    badge: 'bg-red-100 text-red-700',    dot: 'bg-red-500',    urgency: true,  importance: true  },
  { q: 2, label: 'Q2 計画的に',      sub: '非緊急 × 重要',   bg: 'bg-blue-50',   border: 'border-blue-200',   badge: 'bg-blue-100 text-blue-700',  dot: 'bg-blue-500',   urgency: false, importance: true  },
  { q: 3, label: 'Q3 委任・素早く',  sub: '緊急 × 非重要',   bg: 'bg-yellow-50', border: 'border-yellow-200', badge: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500', urgency: true,  importance: false },
  { q: 4, label: 'Q4 後回し・削除',  sub: '非緊急 × 非重要', bg: 'bg-gray-50',   border: 'border-gray-200',   badge: 'bg-gray-100 text-gray-500',  dot: 'bg-gray-400',   urgency: false, importance: false },
] as const

function getQuadrant(meta: TaskMeta | undefined): 1 | 2 | 3 | 4 {
  if (!meta) return 1
  if (meta.urgency && meta.importance)  return 1
  if (!meta.urgency && meta.importance) return 2
  if (meta.urgency && !meta.importance) return 3
  return 4
}

// ─── メインページ ─────────────────────────────────────────────────
export default function TasksPage() {
  const router = useRouter()
  const currentUser       = useAppStore((s) => s.currentUser)
  const activeDivisionId  = useAppStore((s) => s.activeDivisionId)
  const localActivities   = useAppStore((s) => s.localActivities)
  const taskStatuses      = useAppStore((s) => s.taskStatuses)
  const setTaskStatus     = useAppStore((s) => s.setTaskStatus)
  const taskMeta          = useAppStore((s) => s.taskMeta)
  const removeLocalActivity  = useAppStore((s) => s.removeLocalActivity)
  const updateLocalActivity  = useAppStore((s) => s.updateLocalActivity)
  const setTaskStage         = useAppStore((s) => s.setTaskStage)
  const taskStageMap         = useAppStore((s) => s.taskStageMap)
  const openActivityModal    = useAppStore((s) => s.openActivityModal)
  const activityModalIsOpen  = useAppStore((s) => s.activityModal.isOpen)

  // 列定義はDBが真実源（025_task_kanban_stages.sql）。DBからのハイドレーションは
  // 他の事業部マスタと同様に layout.tsx で一括実施される。
  // 行が無い事業部はlocalStorage→デフォルトの順でフォールバックする
  const divisionTaskStages = useAppStore((s) => s.divisionTaskStages)

  const kanbanStages = activeDivisionId
    ? (divisionTaskStages[activeDivisionId] ?? DEFAULT_DIVISION_TASK_STAGES[activeDivisionId] ?? DEFAULT_DIVISION_TASK_STAGES['div-1'])
    : []

  const [tab, setTab]     = useState<'kanban' | 'tasks' | 'challenges'>('kanban')
  const [scope, setScope] = useState<'personal' | 'team'>('team')
  const [expandedQ, setExpandedQ] = useState<Set<number>>(new Set([1, 2, 3, 4]))
  const [deleteConfirmId,   setDeleteConfirmId]   = useState<string | null>(null)
  const [completeConfirmId, setCompleteConfirmId] = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)

  // ─── Supabase データ ─────────────────────────────────────────────
  const [dbTasks, setDbTasks]         = useState<Activity[]>([])
  const [contactsMap, setContactsMap] = useState<Record<string, Contact>>({})
  const [divisionMembers, setDivisionMembers] = useState<UserType[]>([])
  const [dbChallenges, setDbChallenges] = useState<Challenge[]>([])
  const [loading, setLoading]         = useState(false)
  const prevModalOpen = useRef(false)

  const loadTasks = async () => {
    if (!activeDivisionId || !isSupabaseConfigured() || !currentUser) return
    setLoading(true)
    try {
      const contacts = await fetchContactsByDivision(activeDivisionId)
      const cMap: Record<string, Contact> = {}
      contacts.forEach((c) => { cMap[c.id] = c })
      setContactsMap(cMap)

      fetchDivisionUsers(activeDivisionId).then(setDivisionMembers)

      const contactIds = contacts.map((c) => c.id)
      const rawActs = scope === 'personal'
        ? await fetchActivitiesByUser(currentUser.id)
        : await fetchActivitiesByContactIds(contactIds)

      const tasks = rawActs.filter((a) => a.activity_type === 'task')
      setDbTasks(tasks)
      // DBのカンバンステージをストアに反映（ローカルで既にドラッグ済みのものは上書きしない）
      const stageMap = await fetchTaskKanbanStages(tasks.map((t) => t.id)).catch(() => ({}))
      Object.entries(stageMap).forEach(([id, stageId]) => {
        if (!taskStageMap[id]) setTaskStage(id, stageId) // ローカル未設定のみDBから適用
      })
    } catch {
      // 握りつぶすと「他のメンバーのタスクだけ表示されない」無音故障になる
      // （URL長制限による取得失敗で実際に発生した）ため必ず通知する
      toast.error('タスクの読み込みに失敗しました。ページを再読み込みしてください', { duration: 6000 })
    } finally {
      setLoading(false)
    }
  }

  const loadChallenges = async () => {
    if (!activeDivisionId || !isSupabaseConfigured()) return
    const challenges = await fetchChallenges(activeDivisionId)
    setDbChallenges(challenges)
  }

  useEffect(() => {
    loadTasks()
    loadChallenges()
  }, [activeDivisionId, scope, currentUser?.id]) // eslint-disable-line

  // アクティビティモーダルが閉じたら再取得
  useEffect(() => {
    if (prevModalOpen.current && !activityModalIsOpen) loadTasks()
    prevModalOpen.current = activityModalIsOpen
  }, [activityModalIsOpen]) // eslint-disable-line

  // ─── タスクリスト（DB + ローカル楽観的更新） ────────────────────
  const allTasks = useMemo((): Activity[] => {
    const base = isSupabaseConfigured() ? dbTasks : localActivities.filter((a) => a.activity_type === 'task')
    const dbIds = new Set(base.map((a) => a.id))
    const onlyLocal = localActivities.filter((a) => a.activity_type === 'task' && !dbIds.has(a.id))
    return [...onlyLocal, ...base]
  }, [dbTasks, localActivities])

  const pendingTasks = useMemo(() => allTasks.filter((a) => {
    const effectiveStatus = taskStatuses[a.id] ?? a.status
    return effectiveStatus !== 'done'
  }), [allTasks, taskStatuses])

  const completedTasks = useMemo(() => allTasks.filter((a) => {
    const effectiveStatus = taskStatuses[a.id] ?? a.status
    return effectiveStatus === 'done'
  }), [allTasks, taskStatuses])

  const filteredTasks = useMemo(() => {
    if (scope === 'team') return pendingTasks
    return pendingTasks.filter((t) => t.user_id === currentUser?.id)
  }, [pendingTasks, scope, currentUser?.id])

  const byQuadrant = useMemo(() => {
    const map: Record<number, typeof filteredTasks> = { 1: [], 2: [], 3: [], 4: [] }
    filteredTasks.forEach((t) => {
      const q = getQuadrant(taskMeta[t.id])
      map[q].push(t)
    })
    return map
  }, [filteredTasks, taskMeta])

  const resolveTarget = (t: Activity): string | null => {
    if (t.target_type !== 'contact') return null
    const c = contactsMap[t.target_id]
    return c ? `${c.name}${c.companies?.name ? `（${c.companies.name}）` : ''}` : null
  }

  // ─── タスク操作 ──────────────────────────────────────────────────
  const handleComplete = async (id: string) => {
    setTaskStatus(id, 'done')
    if (isSupabaseConfigured() && !id.startsWith('act-local-')) {
      updateActivityStatus(id, 'done').catch(() => {
        toast.error('ステータス更新に失敗しました')
      })
    }
    setCompleteConfirmId(null)
    toast.success('タスクを完了しました')
  }

  const handleReopen = async (id: string) => {
    setTaskStatus(id, 'todo')
    if (isSupabaseConfigured() && !id.startsWith('act-local-')) {
      updateActivityStatus(id, 'todo').catch(() => {
        toast.error('ステータス更新に失敗しました')
      })
    }
    toast.success('タスクを未完了に戻しました')
  }

  const handleDelete = async (id: string) => {
    if (isSupabaseConfigured() && !id.startsWith('act-local-')) {
      try {
        await deleteActivity(id)
        setDbTasks((prev) => prev.filter((t) => t.id !== id))
      } catch {
        toast.error('削除に失敗しました')
        setDeleteConfirmId(null)
        return
      }
    }
    removeLocalActivity(id)
    setDeleteConfirmId(null)
    toast.success('タスクを削除しました')
  }

  const handleEditSave = async (task: Activity, data: { title: string; dueDate: string; memo: string }) => {
    const dbUpdates = {
      title:    data.title.trim() || null,
      memo:     data.memo.trim() || null,
      due_date: data.dueDate ? new Date(data.dueDate).toISOString() : null,
    }
    const storeUpdates: Partial<Activity> = {
      title:    data.title.trim() || undefined,
      memo:     data.memo.trim() || undefined,
      due_date: data.dueDate ? new Date(data.dueDate).toISOString() : undefined,
    }
    updateLocalActivity(task.id, storeUpdates)
    setDbTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, ...storeUpdates } : t))
    if (isSupabaseConfigured() && !task.id.startsWith('act-local-')) {
      updateActivityFields(task.id, dbUpdates).catch(() => toast.error('保存に失敗しました'))
    }
    toast.success('タスクを更新しました')
  }

  const handleReassign = async (task: Activity, newUserId: string) => {
    if (newUserId === task.user_id) return
    const newAssignee = divisionMembers.find((m) => m.id === newUserId)
    // ロールバックは担当者関連フィールドのみを戻す。task全体（prevTask）で上書きすると、
    // 失敗判明までの間に別操作（タイトル編集等）が成功していた場合にその変更まで巻き戻してしまうため
    const prevAssignee: Partial<Activity> = { user_id: task.user_id, users: task.users }
    const storeUpdates: Partial<Activity> = { user_id: newUserId, users: newAssignee }
    updateLocalActivity(task.id, storeUpdates)
    setDbTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, ...storeUpdates } : t))
    if (isSupabaseConfigured() && !task.id.startsWith('act-local-')) {
      try {
        await reassignTask(task.id, newUserId)
      } catch {
        toast.error('担当の変更に失敗しました')
        updateLocalActivity(task.id, prevAssignee)
        setDbTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, ...prevAssignee } : t))
        return
      }
    }
    toast.success(`担当を${newAssignee?.name ?? ''}に変更しました`)
  }

  // ─── 課題データ ──────────────────────────────────────────────────
  const challenges = isSupabaseConfigured() ? dbChallenges : []
  const filteredChallenges = useMemo(() => {
    const divChallenges = challenges.filter((c) => !c.divisionId || c.divisionId === activeDivisionId)
    if (scope === 'team') return divChallenges
    return divChallenges.filter((c) => c.userId === currentUser?.id)
  }, [challenges, scope, activeDivisionId, currentUser?.id])

  // ─── 課題フォーム ────────────────────────────────────────────────
  const [showChallengeForm, setShowChallengeForm] = useState(false)
  const [challengeForm, setChallengeForm] = useState({ title: '', description: '', scope: 'personal' as 'personal' | 'team', deadline: '' })
  const [challengeSaving, setChallengeSaving] = useState(false)

  const handleAddChallenge = async () => {
    if (!challengeForm.title.trim()) { toast.error('タイトルを入力してください'); return }
    setChallengeSaving(true)
    try {
      const now = new Date().toISOString()
      let id = `challenge-${Date.now()}`
      if (isSupabaseConfigured() && currentUser) {
        id = await createChallenge({
          userId: currentUser.id,
          divisionId: activeDivisionId ?? undefined,
          title: challengeForm.title.trim(),
          description: challengeForm.description.trim() || undefined,
          scope: challengeForm.scope,
          deadline: challengeForm.deadline || undefined,
        })
      }
      const challenge: Challenge = {
        id,
        title: challengeForm.title.trim(),
        description: challengeForm.description.trim() || undefined,
        scope: challengeForm.scope,
        deadline: challengeForm.deadline || undefined,
        createdAt: now,
        userId: currentUser?.id ?? '',
        status: 'open',
        divisionId: activeDivisionId ?? undefined,
      }
      setDbChallenges((prev) => [challenge, ...prev])
      toast.success(`課題「${challenge.title}」を追加しました`)
      setChallengeForm({ title: '', description: '', scope: 'personal', deadline: '' })
      setShowChallengeForm(false)
    } catch {
      toast.error('保存に失敗しました')
    } finally {
      setChallengeSaving(false)
    }
  }

  const handleChallengeStatusChange = async (id: string, status: Challenge['status']) => {
    setDbChallenges((prev) => prev.map((c) => c.id === id ? { ...c, status } : c))
    if (isSupabaseConfigured() && !id.startsWith('challenge-')) {
      updateChallengeStatus(id, status).catch(() => toast.error('更新に失敗しました'))
    }
  }

  const handleDeleteChallenge = async (id: string) => {
    if (isSupabaseConfigured() && !id.startsWith('challenge-')) {
      try {
        await deleteChallenge(id)
      } catch {
        toast.error('削除に失敗しました')
        return
      }
    }
    setDbChallenges((prev) => prev.filter((c) => c.id !== id))
    toast.success('課題を削除しました')
  }

  const CHALLENGE_STATUS = {
    open:        { label: '未着手', color: 'bg-gray-100 text-gray-600' },
    in_progress: { label: '対応中', color: 'bg-blue-100 text-blue-700' },
    done:        { label: '完了',   color: 'bg-green-100 text-green-700' },
  }

  const openCount = filteredChallenges.filter((c) => c.status !== 'done').length

  return (
    <div className="w-full space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-800">タスク管理</h1>
          <p className="text-sm text-gray-500">
            {loading ? '読み込み中...' : `未完了 ${pendingTasks.length}件 · 課題 ${openCount}件`}
          </p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => openActivityModal()}>
          タスクを追加
        </Button>
      </div>

      {/* タブ + スコープ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex bg-gray-100 p-1 rounded-xl">
          {([
            ['kanban',     <Kanban size={14} key="k" />,      'カンバン'],
            ['tasks',      <CheckSquare size={14} key="t" />, '象限'],
            ['challenges', <Layers size={14} key="c" />,      '課題'],
          ] as const).map(([t, icon, label]) => (
            <button key={t} onClick={() => setTab(t)}
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

      {/* ─── カンバンビュー ─── */}
      {tab === 'kanban' && (
        <TaskKanbanBoard
          tasks={filteredTasks}
          completedTasks={completedTasks}
          stages={kanbanStages}
          divisionMembers={divisionMembers}
          showCompleted={showCompleted}
          onAddTask={(stageId) => openActivityModal({ prefillKanbanStageId: stageId })}
          onComplete={(task) => handleComplete(task.id)}
          onDelete={(task) => handleDelete(task.id)}
          onSave={handleEditSave}
          onReassign={handleReassign}
          onReopen={(task) => handleReopen(task.id)}
          onToggleCompleted={() => setShowCompleted((v) => !v)}
        />
      )}

      {/* ─── タスク4象限ビュー ─── */}
      {tab === 'tasks' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {QUADRANTS.map(({ q, label, sub, bg, border, badge, dot, urgency, importance }) => {
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
                      const assigneeName = task.users?.name ?? null
                      const isMyTask = task.user_id === currentUser?.id
                      const daysLeft = task.due_date
                        ? Math.ceil((new Date(task.due_date).getTime() - Date.now()) / 86400000)
                        : null
                      const isOverdue = daysLeft !== null && daysLeft < 0
                      const isConfirmingDelete = deleteConfirmId === task.id

                      return (
                        <div key={task.id}
                          className={cn(
                            'bg-white rounded-xl p-3 border shadow-sm transition-all',
                            isOverdue ? 'border-red-300' : 'border-white/80',
                            !isConfirmingDelete && 'hover:shadow-md'
                          )}>
                          <div className="flex items-start gap-2">
                            {/* チェックボックス */}
                            <button
                              onClick={() => isMyTask && setCompleteConfirmId(task.id)}
                              disabled={!isMyTask}
                              className={cn('mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                                isMyTask ? 'border-gray-300 hover:border-green-400 cursor-pointer' : 'border-gray-200 cursor-not-allowed opacity-40')}
                              title={isMyTask ? '完了にする' : '自分のタスクではありません'}
                            />
                            <div className="flex-1 min-w-0"
                              onClick={() => !isConfirmingDelete && target && router.push(`/contacts/${task.target_id}`)}>
                              <p className="text-sm font-medium text-gray-700 truncate">{task.title ?? 'タスク'}</p>
                              {target && <p className="text-xs text-gray-400 truncate">{target}</p>}
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                {task.due_date && (
                                  <span className={cn('text-xs', isOverdue ? 'text-red-500 font-medium' : 'text-gray-400')}>
                                    {isOverdue ? `期限切れ ${Math.abs(daysLeft!)}日` : formatDate(task.due_date)}
                                  </span>
                                )}
                                {assigneeName && !isMyTask && (
                                  <span className="text-xs bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded-full">
                                    {assigneeName}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* 削除ボタン */}
                            {isMyTask && !isConfirmingDelete && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(task.id) }}
                                className="text-gray-200 hover:text-red-400 transition-colors flex-shrink-0 p-0.5"
                                title="削除">
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>

                          {/* 完了確認 */}
                          {completeConfirmId === task.id && (
                            <div className="mt-2 flex items-center gap-2 p-2 bg-green-50 rounded-lg">
                              <Check size={13} className="text-green-500 flex-shrink-0" />
                              <span className="text-xs text-green-700 flex-1">このタスクを完了にしますか？</span>
                              <button onClick={() => handleComplete(task.id)}
                                className="text-xs text-white bg-green-500 font-bold px-2 py-1 rounded-lg hover:bg-green-600">完了</button>
                              <button onClick={() => setCompleteConfirmId(null)}
                                className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">キャンセル</button>
                            </div>
                          )}

                          {/* 削除確認 */}
                          {isConfirmingDelete && (
                            <div className="mt-2 flex items-center gap-2 p-2 bg-red-50 rounded-lg">
                              <span className="text-xs text-red-600 flex-1">このタスクを削除しますか？</span>
                              <button onClick={() => handleDelete(task.id)}
                                className="text-xs text-red-600 font-bold hover:text-red-700 px-2 py-1 bg-red-100 rounded-lg">削除</button>
                              <button onClick={() => setDeleteConfirmId(null)}
                                className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">キャンセル</button>
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* 象限内タスク追加（象限に応じた urgency/importance をプリセット） */}
                    <button
                      onClick={() => openActivityModal({ taskUrgency: urgency, taskImportance: importance })}
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

      {/* ─── 象限ビュー：完了済みセクション ─── */}
      {tab === 'tasks' && (
        <div>
          <button
            onClick={() => setShowCompleted((v) => !v)}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 mb-2 transition-colors"
          >
            <Check size={14} className="text-green-400" />
            完了済み
            <span className="bg-gray-100 text-gray-500 text-xs px-1.5 py-0.5 rounded-full font-medium">
              {completedTasks.length}
            </span>
            <ChevronDown size={14} className={cn('transition-transform', !showCompleted && '-rotate-90')} />
          </button>
          {showCompleted && (
            <div className="space-y-1.5">
              {completedTasks.length === 0 ? (
                <p className="text-xs text-gray-300 text-center py-4">完了済みタスクなし</p>
              ) : completedTasks.map((task) => {
                const isMyTask = task.user_id === currentUser?.id
                return (
                  <div key={task.id} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-100 rounded-xl">
                    <Check size={13} className="text-green-500 flex-shrink-0" />
                    <p className="flex-1 text-sm text-gray-400 line-through truncate">{task.title ?? 'タスク'}</p>
                    {task.due_date && (
                      <span className="text-[10px] text-gray-300 flex-shrink-0">{formatDate(task.due_date)}</span>
                    )}
                    {isMyTask && (
                      <button
                        onClick={() => handleReopen(task.id)}
                        className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-orange-500 px-1.5 py-0.5 rounded-lg hover:bg-orange-50 transition-colors flex-shrink-0"
                      >
                        <X size={10} />戻す
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── 課題管理ビュー ─── */}
      {tab === 'challenges' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setShowChallengeForm((v) => !v)}>
              課題を追加
            </Button>
          </div>

          {showChallengeForm && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3 shadow-sm">
              <p className="text-sm font-bold text-gray-700">新しい課題を追加</p>
              <input type="text" value={challengeForm.title}
                onChange={(e) => setChallengeForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="課題のタイトル（例：エンジニアのスキルシート格納フォルダを作る）"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
              <textarea value={challengeForm.description}
                onChange={(e) => setChallengeForm((f) => ({ ...f, description: e.target.value }))}
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
                  <input type="date" value={challengeForm.deadline}
                    onChange={(e) => setChallengeForm((f) => ({ ...f, deadline: e.target.value }))}
                    className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowChallengeForm(false)}
                  className="flex items-center gap-1 text-xs text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-100">
                  <X size={12} />キャンセル
                </button>
                <button onClick={handleAddChallenge} disabled={challengeSaving}
                  className="flex items-center gap-1 text-xs text-white bg-orange-500 px-3 py-1.5 rounded-lg hover:bg-orange-600 font-medium disabled:opacity-50">
                  <Check size={12} />{challengeSaving ? '保存中...' : '追加'}
                </button>
              </div>
            </div>
          )}

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
                          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', statusCfg.color)}>
                            {statusCfg.label}
                          </span>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium',
                            challenge.scope === 'team' ? 'border-blue-200 text-blue-600 bg-blue-50' : 'border-gray-200 text-gray-500')}>
                            {challenge.scope === 'team'
                              ? <span className="flex items-center gap-1"><Users size={10} />チーム</span>
                              : <span className="flex items-center gap-1"><User size={10} />個人</span>}
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

                      {isOwn && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <select
                            value={challenge.status}
                            onChange={(e) => handleChallengeStatusChange(challenge.id, e.target.value as Challenge['status'])}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                          >
                            <option value="open">未着手</option>
                            <option value="in_progress">対応中</option>
                            <option value="done">完了</option>
                          </select>
                          <button
                            onClick={() => handleDeleteChallenge(challenge.id)}
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
