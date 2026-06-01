'use client'

import { useState } from 'react'
import {
  DndContext, DragEndEvent, DragStartEvent,
  PointerSensor, useSensor, useSensors, DragOverlay, closestCorners,
  useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Plus, UserCircle, AlertCircle, GripVertical,
  Check, Trash2, Edit2, RotateCcw, ChevronDown, X,
} from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { isSupabaseConfigured } from '@/lib/db/client'
import { updateTaskKanbanStage } from '@/lib/db/activities'
import toast from 'react-hot-toast'
import type { TaskKanbanStage } from '@/store/appStore'
import type { Activity } from '@/types/database'

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

type CardMode = 'view' | 'confirmComplete' | 'confirmDelete' | 'edit'

function TaskCard({
  task, isDragging, onComplete, onDelete, onSave,
}: {
  task: Activity
  isDragging?: boolean
  onComplete?: (task: Activity) => void
  onDelete?: (task: Activity) => void
  onSave?: (task: Activity, data: { title: string; dueDate: string; memo: string }) => void
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
              {assignName && (
                <span className={cn(
                  'ml-auto flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full',
                  isMyTask ? 'bg-orange-50 text-orange-600' : 'bg-gray-100 text-gray-500'
                )}>
                  <UserCircle size={10} />{assignName}
                </span>
              )}
            </div>
          </div>

          {/* アクションボタン */}
          {isMyTask && (
            <div className="flex gap-0.5 flex-shrink-0">
              <button
                onClick={openEdit}
                className="p-0.5 text-gray-200 hover:text-orange-400 transition-colors"
                title="編集"
              >
                <Edit2 size={11} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setMode('confirmDelete') }}
                className="p-0.5 text-gray-200 hover:text-red-400 transition-colors"
                title="削除"
              >
                <Trash2 size={11} />
              </button>
            </div>
          )}
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
  showCompleted?: boolean
  onAddTask?: (stageId: string) => void
  onComplete?: (task: Activity) => void
  onDelete?: (task: Activity) => void
  onSave?: (task: Activity, data: { title: string; dueDate: string; memo: string }) => void
  onReopen?: (task: Activity) => void
  onToggleCompleted?: () => void
}

export function TaskKanbanBoard({
  tasks, completedTasks = [], stages,
  showCompleted, onAddTask, onComplete, onDelete, onSave, onReopen, onToggleCompleted,
}: TaskKanbanBoardProps) {
  const setTaskStage = useAppStore((s) => s.setTaskStage)
  const taskStageMap = useAppStore((s) => s.taskStageMap)

  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const byStage = (stageId: string) =>
    tasks.filter((t) => {
      const mapped = taskStageMap[t.id]
      if (mapped) return mapped === stageId
      return stageId === stages[0]?.id
    })

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const taskId  = String(active.id)
    const overId  = String(over.id)
    const targetStage = stages.find((s) => s.id === overId)
      ?? stages.find((s) => byStage(s.id).some((t) => t.id === overId))
    if (!targetStage) return
    setTaskStage(taskId, targetStage.id)
    // DB に保存して全ユーザーに同期
    if (isSupabaseConfigured() && !taskId.startsWith('act-local-')) {
      updateTaskKanbanStage(taskId, targetStage.id).catch(() => {
        toast.error('ステージの同期に失敗しました。SQLマイグレーションが必要な場合があります。', { duration: 4000 })
      })
    }
  }

  return (
    <div className="space-y-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
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
                        onComplete={onComplete}
                        onDelete={onDelete}
                        onSave={onSave}
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
              <TaskCard task={activeTask} />
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
