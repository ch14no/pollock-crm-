'use client'

import { useState } from 'react'
import {
  DndContext, DragEndEvent, DragStartEvent,
  PointerSensor, useSensor, useSensors, DragOverlay, closestCorners,
  useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Plus, UserCircle, AlertCircle, GripVertical,
  Check, Trash2, Edit2, RotateCcw, ChevronDown, X, RefreshCw,
} from 'lucide-react'
import { cn, formatDate, formatErrorDetail } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { isSupabaseConfigured } from '@/lib/db/client'
import { updateTaskKanbanStage, upsertTaskOrders, normalizeTaskKanbanSortOrder } from '@/lib/db/activities'
import toast from 'react-hot-toast'
import type { TaskKanbanStage } from '@/store/appStore'
import type { Activity, User } from '@/types/database'

const STAGE_COLORS: Record<string, { bg: string; border: string; badge: string; dot: string }> = {
  blue:   { bg: 'bg-blue-50',   border: 'border-blue-200',   badge: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500'   },
  green:  { bg: 'bg-green-50',  border: 'border-green-200',  badge: 'bg-green-100 text-green-700',   dot: 'bg-green-500'  },
  yellow: { bg: 'bg-yellow-50', border: 'border-yellow-200', badge: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500' },
  red:    { bg: 'bg-red-50',    border: 'border-red-200',    badge: 'bg-red-100 text-red-700',       dot: 'bg-red-500'    },
  orange: { bg: 'bg-orange-50', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  gray:   { bg: 'bg-gray-50',   border: 'border-gray-200',   badge: 'bg-gray-100 text-gray-600',     dot: 'bg-gray-400'   },
}

function DroppableColumn({ stageId, isEmpty, children }: {
  stageId: string
  isEmpty: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stageId })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'min-h-20 rounded-xl transition-colors',
        isOver && 'bg-orange-50 ring-2 ring-orange-200',
        isEmpty && !isOver && 'border-2 border-dashed border-gray-200'
      )}
    >
      {isEmpty && !isOver ? (
        <div className="flex items-center justify-center h-16 text-xs text-gray-300">ここにドロップ</div>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  )
}

type CardMode = 'view' | 'confirmComplete' | 'confirmDelete' | 'edit' | 'reassign'

function TaskCard({
  task, isDragging, divisionMembers, onComplete, onDelete, onSave, onReassign,
}: {
  task: Activity
  isDragging?: boolean
  divisionMembers: User[]
  onComplete?: (task: Activity) => void
  onDelete?: (task: Activity) => void
  onSave?: (task: Activity, data: { title: string; dueDate: string; memo: string }) => void
  onReassign?: (task: Activity, newUserId: string | null) => void
}) {
  const currentUser  = useAppStore((s) => s.currentUser)
  const taskStatuses = useAppStore((s) => s.taskStatuses)
  const [mode, setMode] = useState<CardMode>('view')
  const [editForm, setEditForm] = useState({ title: '', dueDate: '', memo: '' })

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  const effectiveStatus = taskStatuses[task.id] ?? task.status
  const isDone    = effectiveStatus === 'done'
  const daysLeft  = task.due_date
    ? Math.ceil((new Date(task.due_date).getTime() - Date.now()) / 86400000)
    : null
  const isOverdue = daysLeft !== null && daysLeft < 0
  const isMyTask  = task.user_id === currentUser?.id
  // 削除は原則担当者本人のみ（誤操作防止）。super_adminは他人のタスクも削除できる。
  // 未担当（user_id===null）タスクは「守るべき担当者」がそもそも存在しないため
  // 誤操作防止の対象外とし、同一事業部メンバーなら誰でも削除できる。
  // このボードに表示されている時点で対象は自分の事業部のもの（fetchActivitiesByContactIds
  // が事業部内のcontactに紐づく活動のみを返す設計）なので追加の事業部チェックは不要。
  // RLSのactivities_delete（034）も未担当タスクをshares_division_with_activity_targetで
  // 同一事業部メンバーに開放済みで、この変更は既存のDB権限にUIの表示条件を合わせるもの。
  const canDelete = isMyTask || currentUser?.role === 'super_admin' || task.user_id === null
  const assignName = task.users?.name ?? null

  const openEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditForm({
      title:   task.title ?? '',
      dueDate: task.due_date ? task.due_date.slice(0, 10) : '',
      memo:    task.memo ?? '',
    })
    setMode('edit')
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={cn(
        'bg-white rounded-xl p-3 border shadow-sm transition-all duration-150 select-none',
        isDone    ? 'opacity-50 border-gray-100' :
        isOverdue ? 'border-red-300' : 'border-gray-100',
        mode === 'view' && 'hover:shadow-md'
      )}
    >
      {/* ─── 通常表示 ─── */}
      {mode === 'view' && (
        <div className="flex items-start gap-1.5">
          {/* ドラッグハンドル */}
          <button
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            className="mt-0.5 p-0.5 text-gray-200 hover:text-gray-400 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
          >
            <GripVertical size={13} />
          </button>

          {/* 完了チェック */}
          {isMyTask && (
            <button
              onClick={(e) => { e.stopPropagation(); setMode('confirmComplete') }}
              className="mt-0.5 w-4 h-4 rounded border-2 border-gray-300 hover:border-green-400 flex-shrink-0 transition-colors"
              title="完了にする"
            />
          )}

          {/* 内容 */}
          <div className="flex-1 min-w-0">
            {isOverdue && !isDone && (
              <div className="flex items-center gap-1 mb-1">
                <AlertCircle size={10} className="text-red-400" />
                <span className="text-[10px] text-red-500 font-medium">期限切れ {Math.abs(daysLeft!)}日</span>
              </div>
            )}
            <p className={cn('text-sm font-medium text-gray-800 leading-snug', isDone && 'line-through text-gray-400')}>
              {task.title ?? 'タスク'}
            </p>
            {task.memo && (
              <p className="text-xs text-gray-400 mt-1 truncate">{task.memo}</p>
            )}
            <div className="flex items-center justify-between mt-1.5 gap-2">
              {task.due_date && !isDone && (
                <span className={cn('text-[10px]', isOverdue ? 'text-red-500 font-medium' : 'text-gray-400')}>
                  {formatDate(task.due_date)}
                </span>
              )}
              {divisionMembers.length > 0 ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setMode('reassign') }}
                  className={cn(
                    'ml-auto flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full transition-colors',
                    isMyTask ? 'bg-orange-50 text-orange-600 hover:bg-orange-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  )}
                  title="担当を変更"
                >
                  <UserCircle size={10} />{assignName ?? '未担当'}
                </button>
              ) : assignName && (
                <span className={cn(
                  'ml-auto flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full',
                  isMyTask ? 'bg-orange-50 text-orange-600' : 'bg-gray-100 text-gray-500'
                )}>
                  <UserCircle size={10} />{assignName}
                </span>
              )}
            </div>
          </div>

          {/* アクションボタン: 編集は同一事業部メンバーなら誰でも可（030）。削除は本人/未担当/super_adminのみ（canDelete参照） */}
          <div className="flex gap-0.5 flex-shrink-0">
            <button
              onClick={openEdit}
              className="p-0.5 text-gray-200 hover:text-orange-400 transition-colors"
              title="編集"
            >
              <Edit2 size={11} />
            </button>
            {canDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); setMode('confirmDelete') }}
                className="p-0.5 text-gray-200 hover:text-red-400 transition-colors"
                title="削除"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── 完了確認 ─── */}
      {mode === 'confirmComplete' && (
        <div className="flex items-center gap-2 p-1 bg-green-50 rounded-lg">
          <Check size={13} className="text-green-500 flex-shrink-0" />
          <span className="text-xs text-green-700 flex-1">このタスクを完了にしますか？</span>
          <button
            onClick={(e) => { e.stopPropagation(); onComplete?.(task); setMode('view') }}
            className="text-xs text-white bg-green-500 font-bold px-2 py-1 rounded-lg hover:bg-green-600"
          >完了</button>
          <button
            onClick={(e) => { e.stopPropagation(); setMode('view') }}
            className="text-xs text-gray-400 hover:text-gray-600 px-1"
          ><X size={12} /></button>
        </div>
      )}

      {/* ─── 削除確認 ─── */}
      {mode === 'confirmDelete' && (
        <div className="flex items-center gap-2 p-1 bg-red-50 rounded-lg">
          <Trash2 size={13} className="text-red-400 flex-shrink-0" />
          <span className="text-xs text-red-600 flex-1">このタスクを削除しますか？</span>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete?.(task); setMode('view') }}
            className="text-xs text-red-600 font-bold hover:text-red-700 px-2 py-1 bg-red-100 rounded-lg"
          >削除</button>
          <button
            onClick={(e) => { e.stopPropagation(); setMode('view') }}
            className="text-xs text-gray-400 hover:text-gray-600 px-1"
          ><X size={12} /></button>
        </div>
      )}

      {/* ─── インライン編集 ─── */}
      {mode === 'edit' && (
        <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            value={editForm.title}
            onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="タスク名"
            autoFocus
            className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <input
            type="date"
            value={editForm.dueDate}
            onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <textarea
            value={editForm.memo}
            onChange={(e) => setEditForm((f) => ({ ...f, memo: e.target.value }))}
            placeholder="メモ（任意）"
            rows={2}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setMode('view')}
              className="flex items-center gap-1 text-xs text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-100"
            >
              <X size={11} />キャンセル
            </button>
            <button
              onClick={() => { onSave?.(task, editForm); setMode('view') }}
              className="flex items-center gap-1 text-xs text-white bg-orange-500 px-2.5 py-1.5 rounded-lg hover:bg-orange-600 font-medium"
            >
              <Check size={11} />保存
            </button>
          </div>
        </div>
      )}

      {/* ─── 担当変更 ─── */}
      {mode === 'reassign' && (
        <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
          <p className="text-xs text-gray-400 px-0.5">担当を選択</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => { onReassign?.(task, null); setMode('view') }}
              className={cn(
                'text-xs px-2 py-1 rounded-lg border border-dashed transition-colors',
                !task.user_id
                  ? 'bg-gray-200 text-gray-700 border-gray-300'
                  : 'border-gray-200 text-gray-400 hover:bg-gray-50'
              )}
            >
              未担当
            </button>
            {divisionMembers.map((m) => (
              <button
                key={m.id}
                onClick={() => { onReassign?.(task, m.id); setMode('view') }}
                className={cn(
                  'text-xs px-2 py-1 rounded-lg border transition-colors',
                  m.id === task.user_id
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                )}
              >
                {m.name}
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setMode('view')}
              className="flex items-center gap-1 text-xs text-gray-400 px-2 py-1 rounded-lg hover:bg-gray-100"
            >
              <X size={11} />閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CompletedTaskRow({ task, onReopen }: { task: Activity; onReopen?: (task: Activity) => void }) {
  const currentUser = useAppStore((s) => s.currentUser)
  const isMyTask = task.user_id === currentUser?.id
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-100 rounded-xl">
      <Check size={13} className="text-green-500 flex-shrink-0" />
      <p className="flex-1 text-sm text-gray-400 line-through truncate">{task.title ?? 'タスク'}</p>
      {task.due_date && (
        <span className="text-[10px] text-gray-300 flex-shrink-0">{formatDate(task.due_date)}</span>
      )}
      {isMyTask && onReopen && (
        <button
          onClick={() => onReopen(task)}
          className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-orange-500 px-1.5 py-0.5 rounded-lg hover:bg-orange-50 transition-colors flex-shrink-0"
          title="未完了に戻す"
        >
          <RotateCcw size={10} />戻す
        </button>
      )}
    </div>
  )
}

interface TaskKanbanBoardProps {
  tasks: Activity[]
  completedTasks?: Activity[]
  stages: TaskKanbanStage[]
  divisionMembers?: User[]
  showCompleted?: boolean
  // 事業部ID。並び順の正規化RPC（normalizeTaskKanbanSortOrder）の呼び出しに必要
  divisionId?: string | null
  // 列内の並び替え（保存）を許可するか。「個人」スコープでは tasks に自分の
  // タスクしか含まれず、列の一部だけを見て並び順を採番すると他メンバーの
  // タスクのsort_orderと衝突するため、「チーム」スコープ（列の全件が見えている
  // とき）のみ true にする。false のときはステージ移動のみ行い並び順には触れない
  canReorder?: boolean
  // サーバーから最新の列・並び順を再取得する（pull専用。ローカルキャッシュは書き込まない）
  onRefresh?: () => void
  onAddTask?: (stageId: string) => void
  onComplete?: (task: Activity) => void
  onDelete?: (task: Activity) => void
  onSave?: (task: Activity, data: { title: string; dueDate: string; memo: string }) => void
  onReassign?: (task: Activity, newUserId: string | null) => void
  onReopen?: (task: Activity) => void
  onToggleCompleted?: () => void
}

export function TaskKanbanBoard({
  tasks, completedTasks = [], stages, divisionMembers = [], canReorder = false, divisionId,
  showCompleted, onRefresh, onAddTask, onComplete, onDelete, onSave, onReassign, onReopen, onToggleCompleted,
}: TaskKanbanBoardProps) {
  const setTaskStage = useAppStore((s) => s.setTaskStage)
  const taskStageMap = useAppStore((s) => s.taskStageMap)
  const taskOrderMap = useAppStore((s) => s.taskOrderMap)
  const setTaskOrders = useAppStore((s) => s.setTaskOrders)
  const clearTaskOrder = useAppStore((s) => s.clearTaskOrder)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [normalizing, setNormalizing] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const byStage = (stageId: string) =>
    tasks
      .filter((t) => {
        const mapped = taskStageMap[t.id]
        // 割当先の列が削除・変更されて存在しない場合は未割当として先頭列に出す
        // （どの列にも該当せずタスクがボードから消えるのを防ぐ）
        if (mapped && stages.some((s) => s.id === mapped)) return mapped === stageId
        return stageId === stages[0]?.id
      })
      // 列内の並び順（taskOrderMap）でソート。未設定のタスクは既存の並び（action_date順）を
      // 保ったまま、並び順が設定済みのタスクより後ろに置く（Array.sortの安定ソートを利用）
      .slice()
      .sort((a, b) => {
        const oa = taskOrderMap[a.id]
        const ob = taskOrderMap[b.id]
        if (oa !== undefined && ob !== undefined) return oa - ob
        if (oa !== undefined) return -1
        if (ob !== undefined) return 1
        return 0
      })

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null

  // byStage と同じ「未割当は先頭列」フォールバックだけをO(1)で判定する
  // （sourceStage/targetStageの特定に byStage の filter+sort をまるごと呼ぶ必要はないため）
  const resolveStageId = (taskId: string) => {
    const mapped = taskStageMap[taskId]
    return (mapped && stages.some((s) => s.id === mapped)) ? mapped : stages[0]?.id
  }

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const taskId = String(active.id)
    const overId = String(over.id)
    if (taskId === overId) return

    const sourceStageId = resolveStageId(taskId)
    // overIdが列自体（空白部分へのドロップ）ならそのまま、タスクの上ならそのタスクの所属列
    const targetStageId = stages.some((s) => s.id === overId) ? overId : resolveStageId(overId)
    const targetStage = stages.find((s) => s.id === targetStageId)
    if (!sourceStageId || !targetStage) return

    if (!canReorder) {
      // 「個人」スコープ等、列の一部しか見えていない状態では列内の並び順を
      // 正しく採番できない（他メンバーのタスクとsort_orderが衝突しうる）ため、
      // ステージ移動のみ行い並び順は変更しない
      if (sourceStageId !== targetStage.id) {
        const prevStageId = sourceStageId
        setTaskStage(taskId, targetStage.id)
        if (isSupabaseConfigured() && !taskId.startsWith('act-local-')) {
          updateTaskKanbanStage(taskId, targetStage.id).catch((e) => {
            toast.error(`ステージの同期に失敗しました: ${formatErrorDetail(e)}`, { duration: 8000 })
            // DB保存が失敗したのに見た目だけ移動したままだと、以後リロードするまで
            // 実際のDBの状態とローカルの表示がズレたままになるため元の列に戻す
            setTaskStage(taskId, prevStageId)
          })
        }
      }
      return
    }

    const draggedTask = tasks.find((t) => t.id === taskId)
    if (!draggedTask) return

    let newTargetOrder: Activity[]
    if (sourceStageId === targetStage.id) {
      // 同じ列内での並び替え: 自分を含んだ元の並びに対してarrayMoveで移動する。
      // 一度自分を取り除いてから相手の（取り除いた後の）位置に挿入する方式だと、
      // 下方向への移動時だけ挿入位置が1つ手前にずれる（隣のカードにドロップしても
      // 位置が変わらず、その次まで持っていってやっと1つ下がる）バグになっていた
      const currentList = byStage(targetStage.id)
      const oldIndex = currentList.findIndex((t) => t.id === taskId)
      const overIdx = currentList.findIndex((t) => t.id === overId)
      const newIndex = overIdx >= 0 ? overIdx : currentList.length - 1
      newTargetOrder = arrayMove(currentList, oldIndex, newIndex)
    } else {
      // 別の列への移動: overIdの位置（列内タスクならその位置、列の空白部分なら末尾）へ挿入
      const targetList = byStage(targetStage.id)
      const overIndex = targetList.findIndex((t) => t.id === overId)
      const insertAt = overIndex >= 0 ? overIndex : targetList.length
      newTargetOrder = [
        ...targetList.slice(0, insertAt),
        draggedTask,
        ...targetList.slice(insertAt),
      ]
    }

    // fractional indexing: 移動したカード1枚分のsort_orderだけを、前後2枚の中間値として
    // 計算する。列全体を連番で振り直さないことで、他ユーザーが同じ列を同時に操作しても
    // 互いのDB書き込みが競合・巻き添えにならない（複数人の同時編集でカードが消えたように
    // 見える不具合の直接対策）。隣接カードにまだsort_orderが無い場合は、newTargetOrder内の
    // 自分の位置を仮の値（index × GAP）として使い、旧データとも自然に馴染ませる
    const GAP = 1024
    const movedIndex = newTargetOrder.findIndex((t) => t.id === taskId)
    const prevNeighbor = newTargetOrder[movedIndex - 1]
    const nextNeighbor = newTargetOrder[movedIndex + 1]
    const prevOrder = prevNeighbor
      ? (taskOrderMap[prevNeighbor.id] ?? (movedIndex - 1) * GAP)
      : undefined
    const nextOrder = nextNeighbor
      ? (taskOrderMap[nextNeighbor.id] ?? (movedIndex + 1) * GAP)
      : undefined
    const newOrder =
      prevOrder !== undefined && nextOrder !== undefined ? (prevOrder + nextOrder) / 2 :
      prevOrder !== undefined ? prevOrder + GAP :
      nextOrder !== undefined ? nextOrder - GAP :
      GAP

    // ロールバック用に、移動したタスク自身の変更前の状態だけ保存しておく
    // （他のカードのsort_orderには一切触れていないため戻す必要もない）
    const prevStageId = sourceStageId
    const prevOwnOrder = taskOrderMap[taskId]

    // ローカル即時反映
    if (sourceStageId !== targetStage.id) setTaskStage(taskId, targetStage.id)
    setTaskOrders({ [taskId]: newOrder })

    // 失敗時のロールバック。移動前に並び順が未設定（prevOwnOrderがundefined）だった
    // タスクは、setTaskOrdersでnewOrderに丸めてしまうと「今回失敗した値」がそのまま
    // 残って実質ロールバックされない（/code-reviewで発覚）ため、clearTaskOrderで
    // キー自体を削除し「未設定」の状態に戻す
    const rollbackOrder = () => {
      if (prevOwnOrder === undefined) clearTaskOrder(taskId)
      else setTaskOrders({ [taskId]: prevOwnOrder })
    }

    // DBに保存して全ユーザーに同期（ローカル専用の未保存タスクは対象外）
    if (isSupabaseConfigured() && !taskId.startsWith('act-local-')) {
      upsertTaskOrders([{ activityId: taskId, stageId: targetStage.id, sortOrder: newOrder }])
        .then(({ failedIds, firstError }) => {
          if (failedIds.length === 0) return
          toast.error(
            `並び順の同期に失敗しました（削除済みの可能性があります。画面を更新してください）` +
              (firstError ? ` [詳細: ${formatErrorDetail(firstError)}]` : ''),
            { duration: 8000 }
          )
          if (sourceStageId !== targetStage.id) setTaskStage(taskId, prevStageId)
          rollbackOrder()
        })
        .catch((e) => {
          toast.error(`並び順の同期に失敗しました: ${formatErrorDetail(e)}`, { duration: 8000 })
          if (sourceStageId !== targetStage.id) setTaskStage(taskId, prevStageId)
          rollbackOrder()
        })
    }
  }

  // サーバーから最新の列・並び順を取得し直す（pull専用）。ローカルキャッシュをDBへ
  // 書き込む処理は一切行わない。以前あった「今見えているローカルの状態をまとめて
  // DBへ書き戻す」復旧ボタン（handleSyncAllToDb）は、他ユーザーが直前に加えた変更を
  // 古いローカルキャッシュで上書きしてしまう事故の直接原因だったため撤去した
  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      // onRefresh（tasks/page.tsxのloadTasks）はasync関数のため、必ずawaitする。
      // awaitを忘れると読み込み完了より先にrefreshingが解除され、「更新中」表示が
      // 実態を反映しなくなり連打で重複リクエストも起こる（/code-reviewで発覚）
      await onRefresh?.()
    } finally {
      setRefreshing(false)
    }
  }

  // 列内でfractional indexingの隙間が枯渇してきた場合の復旧用。DBの現在値だけを
  // 見て列全体を再採番するRPC（normalizeTaskKanbanSortOrder）を呼ぶだけで、
  // ローカルキャッシュは一切参照しない（＝旧handleSyncAllToDbの危険性を持ち込まない）
  const handleNormalize = async () => {
    if (!isSupabaseConfigured() || normalizing || !divisionId) return
    setNormalizing(true)
    try {
      for (const stage of stages) {
        await normalizeTaskKanbanSortOrder(stage.id, divisionId)
      }
      toast.success('並び順を整理しました')
      onRefresh?.()
    } catch (e) {
      toast.error(`並び順の整理に失敗しました: ${formatErrorDetail(e)}`, { duration: 8000 })
    } finally {
      setNormalizing(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 個人スコープでは一部のタスクしか見えておらず、他メンバーの列情報を巻き込んで
          壊しかねないためチームスコープのみ表示。「更新」はDBから読み直すだけの安全な
          操作、「並び順を整理」は列の隙間が枯渇したときの復旧用（DBの現在値のみ参照） */}
      {canReorder && (
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-orange-500 disabled:opacity-50 transition-colors"
            title="サーバーから最新の列・並び順を読み込み直します"
          >
            <RefreshCw size={12} className={cn(refreshing && 'animate-spin')} />
            {refreshing ? '更新中...' : '更新'}
          </button>
          <button
            type="button"
            onClick={handleNormalize}
            disabled={normalizing || !divisionId}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-orange-500 disabled:opacity-50 transition-colors"
            title="サーバー側の現在の並び順から列を整理し直します（他の人の同時編集を壊しません）"
          >
            <RefreshCw size={12} className={cn(normalizing && 'animate-spin')} />
            {normalizing ? '整理中...' : '並び順を整理'}
          </button>
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {/* タブ機能（039）でタブの列を全て削除した直後など、stagesが空になりうる。
              空のまま何も表示しないと「壊れた」ように見えるため一言添える */}
          {stages.length === 0 && (
            <p className="text-xs text-gray-400 py-6 px-2">このタブには列がありません。設定画面から列を追加してください。</p>
          )}
          {stages.map((stage) => {
            const stageTasks = byStage(stage.id)
            const colors = STAGE_COLORS[stage.color] ?? STAGE_COLORS.gray
            return (
              <div key={stage.id} className={cn('flex-shrink-0 w-64 rounded-2xl border p-3', colors.bg, colors.border)}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={cn('w-2.5 h-2.5 rounded-full', colors.dot)} />
                    <span className="text-sm font-bold text-gray-700">{stage.name}</span>
                  </div>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-bold', colors.badge)}>
                    {stageTasks.length}
                  </span>
                </div>

                <SortableContext items={stageTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                  <DroppableColumn stageId={stage.id} isEmpty={stageTasks.length === 0}>
                    {stageTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        isDragging={task.id === activeId}
                        divisionMembers={divisionMembers}
                        onComplete={onComplete}
                        onDelete={onDelete}
                        onSave={onSave}
                        onReassign={onReassign}
                      />
                    ))}
                  </DroppableColumn>
                </SortableContext>

                {onAddTask && (
                  <button
                    onClick={() => onAddTask(stage.id)}
                    className="mt-2 w-full flex items-center justify-center gap-1 py-1.5 text-xs text-gray-400 hover:text-orange-500 hover:bg-white/60 rounded-xl transition-colors"
                  >
                    <Plus size={13} />追加
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <DragOverlay>
          {activeTask && (
            <div className="opacity-90 rotate-2">
              <TaskCard task={activeTask} divisionMembers={[]} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* ─── 完了済みセクション ─── */}
      <div>
        <button
          onClick={onToggleCompleted}
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
            ) : completedTasks.map((task) => (
              <CompletedTaskRow key={task.id} task={task} onReopen={onReopen} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
