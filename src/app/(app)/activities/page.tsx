'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Phone, Mail, Users, CheckSquare, Rocket,
  FileText, Plus, Search, Building2, ChevronDown, Trash2,
  Lock, Edit2, Check, X,
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatRelativeTime, formatDate, cn } from '@/lib/utils'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchActivitiesByUser, fetchActivitiesByContactIds, deleteActivity, updateActivityFields } from '@/lib/db/activities'
import { fetchContactsByDivision } from '@/lib/db/contacts'
import { fetchDivisionUsers } from '@/lib/db/users'
import type { ActivityType, ActivityStatus, Activity } from '@/types/database'
import type { Contact, User } from '@/types/database'
import toast from 'react-hot-toast'

const typeConfig: Record<ActivityType, { label: string; icon: React.ElementType; color: string }> = {
  call:    { label: '電話',       icon: Phone,       color: 'bg-blue-100 text-blue-600' },
  email:   { label: 'メール',     icon: Mail,        color: 'bg-purple-100 text-purple-600' },
  meeting: { label: '面談',       icon: Users,       color: 'bg-green-100 text-green-600' },
  task:    { label: 'タスク',     icon: CheckSquare, color: 'bg-yellow-100 text-yellow-600' },
  tossup:  { label: 'トスアップ', icon: Rocket,      color: 'bg-orange-100 text-orange-600' },
  note:    { label: 'メモ',       icon: FileText,    color: 'bg-gray-100 text-gray-600' },
}

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}
function isSameMonth(dateStr: string) {
  const d = new Date(dateStr); const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}
function getDateGroup(dateStr: string): string {
  const d = new Date(dateStr); const now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return '今日'
  if (diff === 1) return '昨日'
  if (diff < 7)  return '今週'
  if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) return '今月'
  return 'それ以前'
}
const DATE_GROUP_ORDER = ['今日', '昨日', '今週', '今月', 'それ以前']

export default function ActivitiesPage() {
  const router = useRouter()
  const {
    openActivityModal, activeDivisionId, currentUser,
    localActivities, taskStatuses, setTaskStatus, removeLocalActivity, updateLocalActivity,
    activityModal,
  } = useAppStore()

  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'super_admin'

  const [query, setQuery]               = useState('')
  const [typeFilter, setTypeFilter]     = useState<ActivityType | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<ActivityStatus | 'all'>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>(isManager ? 'all' : 'mine')

  // Supabase データ
  const [dbActivities, setDbActivities] = useState<Activity[]>([])
  const [contactsMap, setContactsMap]   = useState<Record<string, Contact>>({})
  const [divMembers, setDivMembers]     = useState<User[]>([])
  const [loading, setLoading]           = useState(false)
  const prevModalOpen = useRef(false)

  const loadData = async () => {
    if (!activeDivisionId || !isSupabaseConfigured() || !currentUser) return
    setLoading(true)
    try {
      const [contacts, members] = await Promise.all([
        fetchContactsByDivision(activeDivisionId),
        fetchDivisionUsers(activeDivisionId),
      ])
      const cMap: Record<string, Contact> = {}
      contacts.forEach((c) => { cMap[c.id] = c })
      setContactsMap(cMap)
      setDivMembers(members)

      const contactIds = contacts.map((c) => c.id)
      if (assigneeFilter === 'mine') {
        const acts = await fetchActivitiesByUser(currentUser.id)
        setDbActivities(acts)
      } else {
        const acts = await fetchActivitiesByContactIds(contactIds)
        setDbActivities(acts)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [activeDivisionId, assigneeFilter, currentUser?.id]) // eslint-disable-line

  // モーダルが閉じたら再取得（活動追加後）
  useEffect(() => {
    if (prevModalOpen.current && !activityModal.isOpen) {
      loadData()
    }
    prevModalOpen.current = activityModal.isOpen
  }, [activityModal.isOpen]) // eslint-disable-line

  const [expandedIds, setExpandedIds]         = useState<Set<string>>(new Set())
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [editingTaskId, setEditingTaskId]     = useState<string | null>(null)
  const [editForm, setEditForm]               = useState({ title: '', dueDate: '', memo: '' })
  const [justCompletedTaskId, setJustCompletedTaskId] = useState<string | null>(null)

  // ローカル（楽観的更新）+ DB データをマージ
  const allActivities = useMemo(() => {
    if (!isSupabaseConfigured()) return localActivities
    // ローカルの act-local- IDは DB にない → 表示
    const dbIds = new Set(dbActivities.map((a) => a.id))
    const onlyLocal = localActivities.filter((a) => !dbIds.has(a.id))
    return [...onlyLocal, ...dbActivities]
  }, [dbActivities, localActivities])

  // 対象名を解決
  function resolveTarget(a: Activity): { name: string; contactId?: string } {
    if (a.target_type === 'contact') {
      const c = contactsMap[a.target_id]
      return c
        ? { name: `${c.name}${c.companies?.name ? `（${c.companies.name}）` : ''}`, contactId: c.id }
        : { name: '不明' }
    }
    // deal の場合は contact_id を辿る（deal情報は持っていないのでタイトルのみ）
    return { name: '商談' }
  }

  const filtered = useMemo(() => {
    return allActivities.filter((a) => {
      const matchType   = typeFilter === 'all' || a.activity_type === typeFilter
      const effectiveStatus = taskStatuses[a.id] ?? a.status
      const matchStatus = statusFilter === 'all' || effectiveStatus === statusFilter
      if (!matchType || !matchStatus) return false
      if (!query) return true
      const target = resolveTarget(a)
      return a.title?.includes(query) || a.memo?.includes(query) || target.name.includes(query)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allActivities, typeFilter, statusFilter, query, taskStatuses, contactsMap])

  const grouped = useMemo(() => {
    const map = new Map<string, Activity[]>()
    for (const a of [...filtered].sort(
      (x, y) => new Date(y.action_date).getTime() - new Date(x.action_date).getTime()
    )) {
      const g = getDateGroup(a.action_date)
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(a)
    }
    return DATE_GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g)! }))
  }, [filtered])

  const toggleTask = (id: string, current: ActivityStatus) => {
    const newStatus = current === 'done' ? 'todo' : 'done'
    setTaskStatus(id, newStatus)
    if (newStatus === 'done') {
      setJustCompletedTaskId(id)
      setTimeout(() => setJustCompletedTaskId(null), 8000)
    } else {
      setJustCompletedTaskId(null)
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  const handleDelete = async (id: string) => {
    if (isSupabaseConfigured() && !id.startsWith('act-local-')) {
      try {
        await deleteActivity(id)
        setDbActivities((prev) => prev.filter((a) => a.id !== id))
      } catch {
        toast.error('削除に失敗しました')
        setDeleteConfirmId(null)
        return
      }
    }
    removeLocalActivity(id)
    setDeleteConfirmId(null)
    toast.success('活動を削除しました')
  }

  const handleEditSave = async (id: string) => {
    const updates = {
      title:    editForm.title.trim() || null,
      memo:     editForm.memo.trim() || null,
      due_date: editForm.dueDate ? new Date(editForm.dueDate).toISOString() : null,
    }
    if (isSupabaseConfigured() && !id.startsWith('act-local-')) {
      try {
        await updateActivityFields(id, updates)
        setDbActivities((prev) => prev.map((a) => a.id === id
          ? { ...a, title: updates.title ?? undefined, memo: updates.memo ?? undefined, due_date: updates.due_date ?? undefined }
          : a
        ))
      } catch {
        toast.error('保存に失敗しました')
        return
      }
    }
    updateLocalActivity(id, {
      title:    updates.title ?? undefined,
      due_date: updates.due_date ?? undefined,
      memo:     updates.memo ?? undefined,
    })
    setEditingTaskId(null)
    toast.success('タスクを更新しました')
  }

  const thisMonth   = allActivities.filter((a) => isSameMonth(a.action_date))
  const statsMonth  = Object.fromEntries(
    (['call', 'email', 'meeting', 'task', 'note'] as ActivityType[]).map((t) => [
      t, thisMonth.filter((a) => a.activity_type === t).length,
    ])
  )
  const todoCount = allActivities.filter(
    (a) => a.activity_type === 'task' && (taskStatuses[a.id] ?? a.status) !== 'done'
  ).length

  // メンバーリスト（担当者フィルター用）
  const memberOptions: User[] = (() => {
    if (!currentUser) return divMembers
    const hasSelf = divMembers.some((m) => m.id === currentUser.id)
    return hasSelf ? divMembers : [currentUser, ...divMembers]
  })()

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-black text-gray-800">活動履歴</h1>
          <p className="text-sm text-gray-500">
            {loading ? '読み込み中...' : `${filtered.length}件の活動`}
            {todoCount > 0 && <span className="ml-2 text-yellow-600 font-medium">· 未完了タスク {todoCount}件</span>}
          </p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => openActivityModal()}>
          活動を記録
        </Button>
      </div>

      {/* 今月の統計サマリー */}
      <div className="grid grid-cols-5 gap-2 mb-5">
        {([
          { type: 'call',    label: '電話',   color: 'text-blue-600 bg-blue-50 border-blue-100' },
          { type: 'email',   label: 'メール', color: 'text-purple-600 bg-purple-50 border-purple-100' },
          { type: 'meeting', label: '面談',   color: 'text-green-600 bg-green-50 border-green-100' },
          { type: 'task',    label: 'タスク', color: 'text-yellow-600 bg-yellow-50 border-yellow-100' },
          { type: 'note',    label: 'メモ',   color: 'text-gray-600 bg-gray-50 border-gray-200' },
        ] as { type: ActivityType; label: string; color: string }[]).map(({ type, label, color }) => (
          <button key={type}
            onClick={() => setTypeFilter(typeFilter === type ? 'all' : type)}
            className={cn(
              'rounded-xl border p-3 text-center transition-all',
              color,
              typeFilter === type ? 'ring-2 ring-offset-1 ring-current' : 'hover:shadow-sm'
            )}>
            <p className="text-xl font-black">{statsMonth[type] ?? 0}</p>
            <p className="text-xs font-medium mt-0.5">今月の{label}</p>
          </button>
        ))}
      </div>

      {/* 担当者フィルター */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-xs font-medium text-gray-500">担当者:</span>
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => setAssigneeFilter('mine')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
              assigneeFilter === 'mine' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
            )}>
            自分のみ
          </button>
          <button
            onClick={() => setAssigneeFilter('all')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
              assigneeFilter !== 'mine' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
            )}>
            {isManager ? 'メンバー' : '全員'}
          </button>
        </div>
        {isManager && assigneeFilter !== 'mine' && memberOptions.length > 1 && (
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500 text-gray-700">
            <option value="all">全員</option>
            {memberOptions.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* フィルター */}
      <div className="flex flex-wrap gap-2 mb-5">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="件名・メモ・顧客名で検索..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-xl
              focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <div className="flex items-center gap-1.5">
          {(['all', 'todo', 'done'] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn('px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                statusFilter === s ? 'bg-gray-700 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50')}>
              {{ all: '全ステータス', todo: '未完了', done: '完了' }[s]}
            </button>
          ))}
        </div>
      </div>

      {/* コンテンツ */}
      {grouped.length === 0 ? (
        <EmptyState
          icon="📋"
          title="活動履歴がありません"
          description="電話・メール・面談などの活動を記録して引き継ぎコストをゼロにしましょう"
          action={
            <Button icon={<Plus size={16} />} onClick={() => openActivityModal()}>
              最初の活動を記録する
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(({ group, items }) => (
            <section key={group}>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <span className="w-8 h-px bg-gray-200 inline-block" />
                {group}
                <span className="text-gray-300">{items.length}件</span>
              </h3>
              <div className="space-y-2">
                {items.map((activity) => {
                  const { icon: Icon, color, label } = typeConfig[activity.activity_type]
                  const effectiveStatus  = taskStatuses[activity.id] ?? activity.status
                  const isTask           = activity.activity_type === 'task'
                  const isDone           = effectiveStatus === 'done'
                  const isExpanded       = expandedIds.has(activity.id)
                  const target           = resolveTarget(activity)
                  const isOverdue        = isTask && activity.due_date && !isDone && daysUntil(activity.due_date) < 0
                  const isLocal          = activity.id.startsWith('act-local-')
                  const isConfirmingDelete = deleteConfirmId === activity.id
                  const isEditingThis    = editingTaskId === activity.id
                  const isMyTask         = activity.user_id === currentUser?.id
                  const isMyCreation     = isLocal
                  const canComplete      = !isTask || isMyTask
                  const canEdit          = isTask && isMyCreation && !isMyTask
                  const isLocked         = isTask && !isMyTask && !isMyCreation
                  const assigneeName     = isTask && activity.user_id !== currentUser?.id
                    ? (activity.users?.name ?? null)
                    : null
                  const canDelete        = isLocal || isMyTask

                  return (
                    <div key={activity.id}
                      className={cn(
                        'bg-white border rounded-2xl transition-all duration-150',
                        isOverdue ? 'border-red-200' : isLocked ? 'border-gray-100 opacity-70' : 'border-gray-100',
                        isDone && 'opacity-60'
                      )}>
                      <div className="flex items-start gap-3 p-4">
                        {/* 左アイコン */}
                        {isTask ? (
                          canComplete ? (
                            <button
                              onClick={() => toggleTask(activity.id, effectiveStatus)}
                              className={cn('w-5 h-5 mt-0.5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-colors',
                                isDone ? 'bg-orange-500 border-orange-500' :
                                isOverdue ? 'border-red-400 hover:border-red-500' :
                                'border-gray-300 hover:border-orange-400')}>
                              {isDone && <span className="text-white text-xs leading-none">✓</span>}
                            </button>
                          ) : (
                            <div className={cn('w-5 h-5 mt-0.5 flex-shrink-0 rounded border-2 flex items-center justify-center',
                              isLocked ? 'border-gray-200 bg-gray-50' : 'border-orange-200 bg-orange-50')}
                              title={isLocked ? '操作不可' : `${assigneeName}に割り当て済み`}>
                              {isLocked
                                ? <Lock size={10} className="text-gray-300" />
                                : <span className="text-orange-300 text-xs">→</span>
                              }
                            </div>
                          )
                        ) : (
                          <div className={cn('w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5', color)}>
                            <Icon size={15} />
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded', color)}>{label}</span>
                                {activity.title && (
                                  <span className={cn('text-sm font-medium text-gray-800', isDone && 'line-through text-gray-400')}>
                                    {activity.title}
                                  </span>
                                )}
                                {isOverdue && (
                                  <span className="text-xs font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">
                                    期限切れ {Math.abs(daysUntil(activity.due_date!))}日
                                  </span>
                                )}
                                {isTask && activity.due_date && !isDone && !isOverdue && (
                                  <span className="text-xs text-gray-400">期限: {formatDate(activity.due_date)}</span>
                                )}
                                {assigneeName && (
                                  <span className="text-xs text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">
                                    → {assigneeName}
                                  </span>
                                )}
                                {isLocked && (
                                  <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                                    <Lock size={9} /> 閲覧のみ
                                  </span>
                                )}
                              </div>
                              {target.name && (
                                <button
                                  onClick={() => target.contactId && router.push(`/contacts/${target.contactId}`)}
                                  className={cn('flex items-center gap-1 mt-1 text-xs text-gray-500 hover:text-orange-600 transition-colors',
                                    !target.contactId && 'cursor-default')}>
                                  <Building2 size={11} />
                                  <span className="truncate max-w-64">{target.name}</span>
                                </button>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span className="text-xs text-gray-400">{formatRelativeTime(activity.action_date)}</span>
                              {activity.memo && !isEditingThis && (
                                <button onClick={() => toggleExpand(activity.id)}
                                  className="text-gray-400 hover:text-gray-600 transition-colors">
                                  <ChevronDown size={14} className={cn('transition-transform', isExpanded && 'rotate-180')} />
                                </button>
                              )}
                              {canEdit && !isEditingThis && !isConfirmingDelete && (
                                <button
                                  onClick={() => {
                                    setEditingTaskId(activity.id)
                                    setEditForm({
                                      title: activity.title ?? '',
                                      dueDate: activity.due_date ? activity.due_date.slice(0, 16) : '',
                                      memo: activity.memo ?? '',
                                    })
                                  }}
                                  className="text-gray-400 hover:text-orange-500 transition-colors p-0.5 rounded"
                                  title="修正">
                                  <Edit2 size={13} />
                                </button>
                              )}
                              {canDelete && !isConfirmingDelete && !isEditingThis && (
                                <button
                                  onClick={() => setDeleteConfirmId(activity.id)}
                                  className="text-gray-300 hover:text-red-400 transition-colors p-0.5 rounded"
                                  title="削除">
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          </div>

                          {activity.memo && !isEditingThis && (isExpanded || !activity.title) && (
                            <p className="mt-2 text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{activity.memo}</p>
                          )}
                          {activity.memo && activity.title && !isExpanded && !isEditingThis && (
                            <p className="mt-1 text-xs text-gray-400 truncate">{activity.memo}</p>
                          )}

                          {/* インライン修正フォーム */}
                          {isEditingThis && (
                            <div className="mt-2 p-3 bg-orange-50 rounded-xl space-y-2 border border-orange-100">
                              <p className="text-xs font-medium text-orange-700 mb-1">タスクを修正中</p>
                              <input type="text" value={editForm.title}
                                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                                placeholder="件名"
                                className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
                              <input type="datetime-local" value={editForm.dueDate}
                                onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))}
                                className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
                              <textarea value={editForm.memo}
                                onChange={(e) => setEditForm((f) => ({ ...f, memo: e.target.value }))}
                                placeholder="メモ" rows={2}
                                className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white resize-none" />
                              <div className="flex gap-2 justify-end">
                                <button onClick={() => setEditingTaskId(null)}
                                  className="flex items-center gap-1 text-xs text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                                  <X size={12} /> キャンセル
                                </button>
                                <button
                                  onClick={() => handleEditSave(activity.id)}
                                  className="flex items-center gap-1 text-xs text-white bg-orange-500 hover:bg-orange-600 px-2.5 py-1.5 rounded-lg font-medium transition-colors">
                                  <Check size={12} /> 保存
                                </button>
                              </div>
                            </div>
                          )}

                          {/* タスク完了後CTA */}
                          {justCompletedTaskId === activity.id && (
                            <div className="mt-2 flex items-center gap-2 p-2.5 bg-green-50 rounded-xl border border-green-100">
                              <span className="text-green-600 text-base flex-shrink-0">✓</span>
                              <span className="text-xs text-green-700 flex-1 font-medium">完了！次のアクションを記録しますか？</span>
                              <button
                                onClick={() => {
                                  setJustCompletedTaskId(null)
                                  if (activity.target_type === 'contact' && contactsMap[activity.target_id]) {
                                    const c = contactsMap[activity.target_id]
                                    openActivityModal({ contactId: c.id, contactName: `${c.name}${c.companies?.name ? `（${c.companies.name}）` : ''}` })
                                  } else {
                                    openActivityModal()
                                  }
                                }}
                                className="text-xs text-green-700 font-bold bg-green-100 hover:bg-green-200 px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors">
                                記録する →
                              </button>
                              <button onClick={() => setJustCompletedTaskId(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                                <X size={13} />
                              </button>
                            </div>
                          )}

                          {/* 削除確認 */}
                          {isConfirmingDelete && (
                            <div className="mt-2 flex items-center gap-2 p-2 bg-red-50 rounded-lg">
                              <span className="text-xs text-red-600 flex-1">この活動を削除しますか？</span>
                              <button onClick={() => handleDelete(activity.id)}
                                className="text-xs text-red-600 font-bold hover:text-red-700 px-2 py-1 bg-red-100 rounded-lg">削除</button>
                              <button onClick={() => setDeleteConfirmId(null)}
                                className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">キャンセル</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
