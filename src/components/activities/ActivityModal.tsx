'use client'

import { useState, useEffect } from 'react'
import { Phone, Mail, Users, FileText, CheckSquare, UserCircle, Zap, Target } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ContactPicker } from '@/components/ui/ContactPicker'
import { AutoGrowTextarea } from '@/components/ui/AutoGrowTextarea'
import { useAppStore } from '@/store/appStore'
import { isSupabaseConfigured } from '@/lib/db/client'
import { createActivity, upsertTaskMeta, updateTaskKanbanStage, fetchDivisionMemoCategories, DEFAULT_MEMO_CATEGORY_NAMES } from '@/lib/db/activities'
import { fetchDivisionUsers } from '@/lib/db/users'
import { getInitials, cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import type { Activity, ActivityType, User } from '@/types/database'

const ACTIVITY_TYPES: { value: ActivityType; label: string; icon: React.ElementType; color: string }[] = [
  { value: 'call',    label: '電話',   icon: Phone,       color: 'bg-blue-100 text-blue-600 ring-blue-400' },
  { value: 'email',   label: 'メール', icon: Mail,        color: 'bg-purple-100 text-purple-600 ring-purple-400' },
  { value: 'meeting', label: '面談',   icon: Users,       color: 'bg-green-100 text-green-600 ring-green-400' },
  { value: 'note',    label: 'メモ',   icon: FileText,    color: 'bg-gray-100 text-gray-600 ring-gray-400' },
  { value: 'task',    label: 'タスク', icon: CheckSquare, color: 'bg-yellow-100 text-yellow-600 ring-yellow-400' },
]

interface ActivityFormState {
  type: ActivityType
  title: string
  memo: string
  memoCategory: string // ''=カテゴリなし
  contactId: string
  assigneeId: string
  actionDate: string
  dueDate: string
  status: 'todo' | 'done'
}

function todayStr() {
  return new Date().toISOString().slice(0, 16)
}

export function ActivityModal() {
  const { activityModal, closeActivityModal, activeDivisionId, currentUser, addActivity, setTaskMeta, setTaskStage } = useAppStore()
  const [loading, setLoading] = useState(false)
  const [taskUrgency, setTaskUrgency] = useState(false)
  const [taskImportance, setTaskImportance] = useState(false)
  const [taskScope, setTaskScope] = useState<'personal' | 'team'>('personal')
  const [divisionMembers, setDivisionMembers] = useState<User[]>([])
  // 用途別カテゴリの選択肢（事業部設定 or 既定値。M&A事業部要望⑰）
  const [categoryNames, setCategoryNames] = useState<string[]>(DEFAULT_MEMO_CATEGORY_NAMES)

  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'super_admin'

  const [form, setForm] = useState<ActivityFormState>({
    type: 'call', title: '', memo: '', memoCategory: '', contactId: '',
    assigneeId: currentUser?.id ?? '',
    actionDate: todayStr(), dueDate: '', status: 'todo',
  })

  useEffect(() => {
    if (!activityModal.isOpen) return
    setForm({
      type: activityModal.prefillKanbanStageId ? 'task' : 'call', title: '', memo: '', memoCategory: '',
      contactId: activityModal.prefillContactId ?? '',
      assigneeId: currentUser?.id ?? '',
      actionDate: todayStr(), dueDate: '', status: 'todo',
    })
    setTaskUrgency(activityModal.prefillTaskUrgency ?? false)
    setTaskImportance(activityModal.prefillTaskImportance ?? false)
    setTaskScope('personal')

    // 事業部メンバーを取得（マネージャーのタスク割り当て用）。
    // 失敗時は自分のみ割当可能な状態にフォールバック（fetchDivisionUsersがエラーをthrowするようになったため）
    if (isManager && activeDivisionId && isSupabaseConfigured()) {
      fetchDivisionUsers(activeDivisionId).then(setDivisionMembers).catch(() => setDivisionMembers([]))
    }
    // 用途別カテゴリを取得。未設定の事業部は既定値へフォールバック。
    // 取得失敗（＝020未適用でmemo_category列も無い環境）では空にしてカテゴリUIごと非表示にし、
    // 「選んだのに保存されないカテゴリ」を提示しない。前回開いた事業部の値が残らないよう
    // 毎回結果で置き換え、遅延レスポンスが現在の表示を上書きしないようキャンセルする
    let cancelled = false
    if (activeDivisionId && isSupabaseConfigured()) {
      fetchDivisionMemoCategories(activeDivisionId)
        .then((cats) => {
          if (cancelled) return
          setCategoryNames(cats.length > 0 ? cats.map((c) => c.name) : DEFAULT_MEMO_CATEGORY_NAMES)
        })
        .catch(() => { if (!cancelled) setCategoryNames([]) })
    }
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityModal.isOpen])

  const isTask = form.type === 'task'
  const isSelfAssigned = form.assigneeId === currentUser?.id
  const assignee = divisionMembers.find((m) => m.id === form.assigneeId)
    ?? (form.assigneeId === currentUser?.id ? currentUser : null)

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()

    const targetContactId = form.contactId || activityModal.prefillContactId
    const targetDealId    = activityModal.prefillDealId

    if (!targetContactId && !targetDealId) {
      toast.error('対象顧客または商談を選択してください')
      return
    }
    if (isTask && !form.title.trim()) {
      toast.error('タスクのタイトルを入力してください')
      return
    }

    setLoading(true)
    const now = new Date().toISOString()
    const localId = `act-local-${Date.now()}`

    try {
      let savedId = localId
      if (isSupabaseConfigured()) {
        savedId = await createActivity({
          targetType:   targetDealId ? 'deal' : 'contact',
          targetId:     targetDealId ?? targetContactId ?? '',
          userId:       form.assigneeId || currentUser?.id,
          activityType: form.type,
          title:        form.title.trim() || undefined,
          memo:         form.memo.trim() || undefined,
          memoCategory: form.memoCategory || undefined,
          dueDate:      isTask && form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
          status:       form.status,
          actionDate:   new Date(form.actionDate).toISOString(),
        })
        if (isTask) {
          await upsertTaskMeta(savedId, taskUrgency, taskImportance, taskScope).catch(() => {
            // タスク本体は保存済みなので処理は続行するが、優先度が落ちたことは知らせる
            toast.error('タスクの優先度（緊急度・重要度）の保存に失敗しました。タスク編集から設定し直してください')
          })
        }
      }

      const newActivity: Activity = {
        id: savedId,
        target_type:   targetDealId ? 'deal' : 'contact',
        target_id:     targetDealId ?? targetContactId ?? '',
        user_id:       form.assigneeId || currentUser?.id,
        activity_type: form.type,
        title:         form.title.trim() || undefined,
        memo:          form.memo.trim() || undefined,
        memo_category: form.memoCategory || undefined,
        due_date:      isTask && form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        status:        form.status,
        action_date:   new Date(form.actionDate).toISOString(),
        created_at:    now,
        users:         currentUser ?? undefined,
      }
      addActivity(newActivity)

      if (isTask) {
        setTaskMeta(savedId, { urgency: taskUrgency, importance: taskImportance, scope: taskScope })
        if (activityModal.prefillKanbanStageId) {
          const stageId = activityModal.prefillKanbanStageId
          if (isSupabaseConfigured() && !savedId.startsWith('act-local-')) {
            // 先にDBに保存できてからローカルへ反映する。先にローカルへ反映すると、
            // DB保存が失敗した場合に「作成者のブラウザだけ正しい列に見えるが
            // DBのkanban_stage_idはNULLのまま」という状態が固定化してしまう。
            // これは他メンバーに一生反映されないだけでなく、hydrateTaskMetaの
            // 「DB側にstageIdが無ければ上書きしない」仕様により、作成者自身が
            // 再読み込みしても直らない（2026-07-24 実際に報告された不具合の
            // 再発パターン。code-reviewで指摘）
            updateTaskKanbanStage(savedId, stageId)
              .then(() => setTaskStage(savedId, stageId))
              .catch(() => {
                toast.error('カンバン列の保存に失敗しました。カードをドラッグして列を選び直してください', { duration: 6000 })
              })
          } else {
            // ローカル専用タスク（Supabase未接続・デモモード）はDB自体が無いので即反映
            setTaskStage(savedId, stageId)
          }
        }
      }

      closeActivityModal()
      const typeLabel = ACTIVITY_TYPES.find((t) => t.value === form.type)?.label ?? ''
      if (isTask && !isSelfAssigned) {
        toast.success(`タスク「${form.title}」を${assignee?.name ?? ''}さんに割り当てました`, { duration: 4000 })
      } else {
        toast.success(isTask ? `タスク「${form.title}」を作成しました` : `${typeLabel}を記録しました`)
      }
    } catch {
      toast.error('保存に失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  // 表示するメンバーリスト（自分を必ず含む）
  const memberOptions: User[] = (() => {
    if (!currentUser) return divisionMembers
    const hasSelf = divisionMembers.some((m) => m.id === currentUser.id)
    return hasSelf ? divisionMembers : [currentUser, ...divisionMembers]
  })()

  return (
    <Modal isOpen={activityModal.isOpen} onClose={closeActivityModal} title="活動を記録" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 活動タイプ */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">活動タイプ</label>
          <div className="grid grid-cols-5 gap-2">
            {ACTIVITY_TYPES.map(({ value, label, icon: Icon, color }) => (
              <button key={value} type="button"
                onClick={() => setForm((f) => ({ ...f, type: value, dueDate: '' }))}
                className={cn(
                  'flex flex-col items-center gap-1.5 py-2.5 px-1 rounded-xl border-2 transition-all text-xs font-medium',
                  form.type === value
                    ? `${color} border-current ring-2 ring-offset-1 ring-current`
                    : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                )}>
                <Icon size={18} />
                {label}
              </button>
            ))}
          </div>
          {form.type !== 'task' && (
            <p className="mt-1.5 text-xs text-gray-500">
              「タスク」以外は活動履歴にのみ記録され、タスク管理画面（カンバン）には表示されません。
            </p>
          )}
        </div>

        {/* 件名 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {isTask ? '件名' : '件名（省略可）'}
            {isTask && <span className="text-red-500 ml-1">*</span>}
          </label>
          <input type="text" value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder={
              isTask ? 'タスクの内容を入力...' :
              form.type === 'call' ? '例: 初回アプローチ電話' :
              form.type === 'email' ? '例: 資料送付' :
              form.type === 'meeting' ? '例: ヒアリング面談' : '件名（省略可）'
            }
            required={isTask}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50"
          />
        </div>

        {/* 対象顧客 */}
        {!activityModal.prefillContactId && !activityModal.prefillDealId && (
          <ContactPicker
            label="対象顧客"
            required
            selectedContactId={form.contactId || undefined}
            filterDivisionId={activeDivisionId ?? undefined}
            onSelect={(contactId) => setForm((f) => ({ ...f, contactId }))}
            onClear={() => setForm((f) => ({ ...f, contactId: '' }))}
          />
        )}
        {(activityModal.prefillContactId || activityModal.prefillDealId) && (
          <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-100 rounded-lg text-sm">
            <span className="text-xs text-orange-400 font-medium flex-shrink-0">
              {activityModal.prefillDealId ? '商談' : '顧客'}
            </span>
            <span className="font-medium text-orange-700 truncate">
              {activityModal.prefillContactName ?? activityModal.prefillDealTitle ?? '対象設定済み'}
            </span>
          </div>
        )}

        {/* メモ */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">メモ・内容</label>
          <AutoGrowTextarea value={form.memo}
            onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
            rows={3}
            placeholder={isTask ? '詳細や注意事項...' : '話した内容、確認事項、ネクストアクションなど...'}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50"
          />
        </div>

        {/* 用途別カテゴリ（⑰・省略可）。選択肢が無い（020未適用）ときは非表示 */}
        {categoryNames.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">カテゴリ（省略可）</label>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button type="button"
              onClick={() => setForm((f) => ({ ...f, memoCategory: '' }))}
              aria-pressed={form.memoCategory === ''}
              className={cn('px-3 py-1 rounded-full text-xs font-medium border transition-all',
                form.memoCategory === ''
                  ? 'bg-gray-700 text-white border-gray-700'
                  : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50')}>
              なし
            </button>
            {categoryNames.map((name) => (
              <button key={name} type="button"
                onClick={() => setForm((f) => ({ ...f, memoCategory: f.memoCategory === name ? '' : name }))}
                aria-pressed={form.memoCategory === name}
                className={cn('px-3 py-1 rounded-full text-xs font-medium border transition-all',
                  form.memoCategory === name
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50')}>
                {name}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* 日時 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{isTask ? '登録日' : '実施日時'}</label>
            <input type="datetime-local" value={form.actionDate}
              onChange={(e) => setForm((f) => ({ ...f, actionDate: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50" />
          </div>
          {isTask && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">期限</label>
              <input type="datetime-local" value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50" />
            </div>
          )}
        </div>

        {/* タスク専用フィールド */}
        {isTask && (
          <div className="space-y-3 pt-1 border-t border-gray-100">
            {/* 担当者（マネージャーのみ・メンバーが複数いる場合） */}
            {isManager && memberOptions.length > 1 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                  <UserCircle size={14} />担当者を割り当てる
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {memberOptions.map((member) => {
                    const isSelected = form.assigneeId === member.id
                    const isSelf = member.id === currentUser?.id
                    return (
                      <button key={member.id} type="button"
                        onClick={() => setForm((f) => ({ ...f, assigneeId: member.id }))}
                        className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-left transition-all',
                          isSelected ? 'border-orange-400 bg-orange-50' : 'border-gray-200 bg-white hover:bg-gray-50')}>
                        <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                          isSelected ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600')}>
                          {getInitials(member.name)}
                        </div>
                        <div className="min-w-0">
                          <p className={cn('text-xs font-medium truncate', isSelected ? 'text-orange-700' : 'text-gray-700')}>{member.name}</p>
                          <p className={cn('text-xs', isSelected ? 'text-orange-500' : 'text-gray-400')}>
                            {isSelf ? '自分' : member.role === 'manager' ? 'マネージャー' : '営業'}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
                {!isSelfAssigned && (
                  <p className="mt-2 text-xs text-orange-600 bg-orange-50 px-3 py-1.5 rounded-lg">
                    {assignee?.name ?? ''}さんのタスクとして作成されます。
                  </p>
                )}
              </div>
            )}

            {/* 4象限 */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 flex items-center gap-1">
                <Target size={12} />優先度（4象限）
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setTaskUrgency((v) => !v)}
                  className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-medium transition-all',
                    taskUrgency ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50')}>
                  <Zap size={14} className={taskUrgency ? 'fill-red-400 text-red-400' : ''} />
                  {taskUrgency ? '緊急' : '緊急でない'}
                </button>
                <button type="button" onClick={() => setTaskImportance((v) => !v)}
                  className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-medium transition-all',
                    taskImportance ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50')}>
                  <Target size={14} className={taskImportance ? 'text-blue-500' : ''} />
                  {taskImportance ? '重要' : '重要でない'}
                </button>
              </div>
              <p className="text-xs text-gray-400 text-center">
                {taskUrgency && taskImportance && '🔴 Q1：今すぐやる'}
                {!taskUrgency && taskImportance && '🔵 Q2：計画的に取り組む'}
                {taskUrgency && !taskImportance && '🟡 Q3：委任・素早く処理'}
                {!taskUrgency && !taskImportance && '⬜ Q4：後回し・削除検討'}
              </p>
            </div>

            {/* スコープ */}
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-gray-500 flex-shrink-0">スコープ</p>
              <div className="flex gap-1.5">
                {(['personal', 'team'] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setTaskScope(s)}
                    className={cn('px-3 py-1 rounded-full text-xs font-medium border transition-all',
                      taskScope === s ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-200 text-gray-500 hover:bg-gray-50')}>
                    {s === 'personal' ? '個人' : 'チーム'}
                  </button>
                ))}
              </div>
            </div>

            {/* 完了済みトグル */}
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">完了済みとして記録</label>
              <button type="button"
                onClick={() => setForm((f) => ({ ...f, status: f.status === 'done' ? 'todo' : 'done' }))}
                className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                  form.status === 'done' ? 'bg-orange-500' : 'bg-gray-200')}>
                <span className={cn('inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                  form.status === 'done' ? 'translate-x-5' : 'translate-x-0.5')} />
              </button>
            </div>
          </div>
        )}

        <Button type="submit" loading={loading} className="w-full" size="lg">
          {loading ? '保存中...' : isTask && !isSelfAssigned ? `${assignee?.name ?? ''}さんに割り当てる` : '記録する'}
        </Button>
      </form>
    </Modal>
  )
}
