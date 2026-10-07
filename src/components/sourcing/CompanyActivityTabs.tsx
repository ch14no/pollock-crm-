'use client'

import { useState } from 'react'
import { Plus, Lock, ChevronDown, Edit2, CheckCircle2, Circle } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { cn, formatRelativeTime, formatErrorDetail } from '@/lib/utils'
import { ACT_ICON, ACT_COLOR, ACT_LABEL } from '@/lib/activityDisplay'
import { updateActivityFields, updateActivityStatus } from '@/lib/db/activities'
import type { Activity, Deal } from '@/types/database'

export type CompanyTab = 'timeline' | 'tasks' | 'deals'

interface CompanyActivityTabsProps {
  activities: Activity[]            // 会社対象＋担当者対象の全活動（タスク含む）
  deals: Deal[]
  contactNameById: Map<string, string>
  dealTerm: string
  canEdit: boolean
  currentUserId?: string
  onRecordActivity: () => void
  onCreateDeal: () => void
  onOpenDeal: (deal: Deal) => void
  onActivityChanged: () => void     // 編集・完了トグル後の再取得
}

// 企業詳細 ④活動タイムライン／タスク／案件。旧「顧客」詳細の中央ペインに相当（読み取り中心・最小限の編集）
export function CompanyActivityTabs({
  activities, deals, contactNameById, dealTerm, canEdit, currentUserId, onRecordActivity, onCreateDeal, onOpenDeal, onActivityChanged,
}: CompanyActivityTabsProps) {
  const [tab, setTab] = useState<CompanyTab>('timeline')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ title: '', memo: '' })
  const [busyId, setBusyId] = useState<string | null>(null)

  const tasks = activities.filter((a) => a.activity_type === 'task')
  const openTasks = tasks.filter((t) => t.status !== 'done')
  const targetLabel = (a: Activity) =>
    a.target_type === 'company' ? '会社全体' : a.target_type === 'contact' ? (contactNameById.get(a.target_id) ?? '担当者') : dealTerm

  const toggleExpand = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const saveEdit = async (id: string) => {
    setBusyId(id)
    try {
      await updateActivityFields(id, { title: editForm.title.trim() || null, memo: editForm.memo.trim() || null })
      setEditingId(null)
      onActivityChanged()
    } catch (e) {
      toast.error(`保存に失敗しました: ${formatErrorDetail(e)}`)
    } finally {
      setBusyId(null)
    }
  }

  const toggleTask = async (t: Activity) => {
    const next = t.status === 'done' ? 'todo' : 'done'
    setBusyId(t.id)
    try {
      await updateActivityStatus(t.id, next)
      onActivityChanged()
    } catch (e) {
      toast.error(`タスクの更新に失敗しました: ${formatErrorDetail(e)}`)
    } finally {
      setBusyId(null)
    }
  }

  const tabs: { id: CompanyTab; label: string; count: number }[] = [
    { id: 'timeline', label: '活動タイムライン', count: activities.length },
    { id: 'tasks', label: 'タスク', count: openTasks.length },
    { id: 'deals', label: dealTerm, count: deals.length },
  ]

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm">
      <div className="flex border-b border-gray-100 overflow-x-auto" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn('px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
              tab === t.id ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700')}
          >
            {t.label}<span className="ml-1.5 text-xs text-gray-400">{t.count}</span>
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab !== 'deals' && (
          <Button size="sm" variant="secondary" icon={canEdit ? <Plus size={14} /> : <Lock size={14} />} className="mb-4 w-full" disabled={!canEdit} onClick={onRecordActivity}>
            {tab === 'tasks' ? 'タスクを追加' : '活動を記録'}
          </Button>
        )}

        {tab === 'timeline' && (
          activities.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">活動履歴がありません</p>
          ) : (
            <div className="space-y-3">
              {activities.map((act) => {
                const Icon = ACT_ICON[act.activity_type]
                const color = ACT_COLOR[act.activity_type]
                const isExpanded = expanded.has(act.id)
                const isEditing = editingId === act.id
                return (
                  <div key={act.id} className="flex gap-3">
                    <div className={cn('w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5', color)}><Icon size={13} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded', color)}>{ACT_LABEL[act.activity_type]}</span>
                            <Badge variant={act.target_type === 'company' ? 'info' : 'default'}>{targetLabel(act)}</Badge>
                            <span className="text-xs text-gray-400">{formatRelativeTime(act.action_date)}</span>
                            {act.users && <span className="text-xs text-gray-400">{act.users.name}</span>}
                          </div>
                          {!isEditing && (act.title || act.counterpart_type) && (
                            <p className="text-sm font-medium text-gray-700 mt-0.5">{act.title ?? act.counterpart_type}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {canEdit && !isEditing && (
                            <button onClick={() => { setEditingId(act.id); setEditForm({ title: act.title ?? '', memo: act.memo ?? '' }) }} className="text-gray-300 hover:text-orange-500 p-0.5 rounded"
                              aria-label={`${ACT_LABEL[act.activity_type]}（${formatRelativeTime(act.action_date)}・${targetLabel(act)}）を編集`}><Edit2 size={12} /></button>
                          )}
                          {!isEditing && act.memo && (
                            <button onClick={() => toggleExpand(act.id)} className="text-gray-300 hover:text-gray-500"
                              aria-label={`${ACT_LABEL[act.activity_type]}（${formatRelativeTime(act.action_date)}）のメモを${isExpanded ? '閉じる' : '開く'}`}>
                              <ChevronDown size={13} className={cn('transition-transform', isExpanded && 'rotate-180')} />
                            </button>
                          )}
                        </div>
                      </div>
                      {isEditing ? (
                        <div className="mt-2 p-2.5 bg-orange-50 rounded-xl space-y-2 border border-orange-100">
                          <input type="text" value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} placeholder="件名"
                            className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
                          <textarea value={editForm.memo} onChange={(e) => setEditForm((f) => ({ ...f, memo: e.target.value }))} rows={3} placeholder="メモ"
                            className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="secondary" onClick={() => setEditingId(null)} disabled={busyId === act.id}>キャンセル</Button>
                            <Button size="sm" onClick={() => void saveEdit(act.id)} loading={busyId === act.id}>保存</Button>
                          </div>
                        </div>
                      ) : (
                        isExpanded && act.memo && <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap bg-gray-50 rounded-lg p-2.5">{act.memo}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}

        {tab === 'tasks' && (
          tasks.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">タスクがありません</p>
          ) : (
            <div className="space-y-2">
              {[...openTasks, ...tasks.filter((t) => t.status === 'done')].map((t) => {
                const done = t.status === 'done'
                const mine = t.user_id === currentUserId
                return (
                  <div key={t.id} className={cn('flex items-start gap-2.5 p-2.5 rounded-xl border', done ? 'border-gray-100 bg-gray-50 opacity-70' : 'border-gray-100 bg-white')}>
                    <button
                      onClick={() => mine && void toggleTask(t)}
                      disabled={!mine || busyId === t.id}
                      className={cn('mt-0.5 flex-shrink-0', mine ? 'text-orange-500 hover:text-orange-600' : 'text-gray-300 cursor-not-allowed')}
                      aria-label={done ? 'タスクを未完了に戻す' : 'タスクを完了にする'}
                      title={mine ? undefined : '担当者本人のみ完了にできます'}
                    >
                      {done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-sm font-medium', done ? 'line-through text-gray-400' : 'text-gray-700')}>{t.title}</p>
                      <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5 flex-wrap">
                        <span>{targetLabel(t)}</span>
                        {t.users && <span>担当: {t.users.name}</span>}
                        {t.due_date && <span>期限 {t.due_date.slice(0, 10)}</span>}
                      </div>
                      {t.memo && <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{t.memo}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}

        {tab === 'deals' && (
          <>
            <Button size="sm" variant="secondary" icon={canEdit ? <Plus size={14} /> : <Lock size={14} />} className="mb-4 w-full" disabled={!canEdit} onClick={onCreateDeal}>
              {dealTerm}を作成
            </Button>
            {deals.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-8">{dealTerm}がありません</p>
            ) : (
              <div className="space-y-2">
                {deals.map((d) => (
                  <button key={d.id} onClick={() => onOpenDeal(d)} className="w-full text-left p-3 rounded-xl border border-gray-100 bg-white hover:bg-orange-50/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-800 truncate">{d.title}</span>
                      <span className="text-xs text-gray-500 whitespace-nowrap">{d.amount ? `¥${d.amount.toLocaleString('ja-JP')}` : ''}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                      {d.contacts?.name && <span>{d.contacts.name}</span>}
                      {d.users?.name && <span>担当: {d.users.name}</span>}
                      <span>{formatRelativeTime(d.updated_at)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
