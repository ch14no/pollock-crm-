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
import { Plus, UserCircle, AlertCircle } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import type { TaskKanbanStage } from '@/store/appStore'
import type { Activity } from '@/types/database'

// ステージカラーマップ
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

function TaskCard({
  task, isDragging, onEdit,
}: { task: Activity; isDragging?: boolean; onEdit?: (task: Activity) => void }) {
  const currentUser  = useAppStore((s) => s.currentUser)
  const taskStatuses = useAppStore((s) => s.taskStatuses)

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  const effectiveStatus = taskStatuses[task.id] ?? task.status
  const isDone     = effectiveStatus === 'done'
  const daysLeft   = task.due_date
    ? Math.ceil((new Date(task.due_date).getTime() - Date.now()) / 86400000)
    : null
  const isOverdue  = daysLeft !== null && daysLeft < 0
  const isMyTask   = task.user_id === currentUser?.id
  const assignName = task.users?.name ?? null

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onEdit?.(task)}
      className={cn(
        'bg-white rounded-xl p-3 border shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-all duration-150 select-none',
        isDone ? 'opacity-50 border-gray-100' : isOverdue ? 'border-red-300' : 'border-gray-100'
      )}
    >
      {isOverdue && !isDone && (
        <div className="flex items-center gap-1 mb-1.5">
          <AlertCircle size={11} className="text-red-400" />
          <span className="text-[10px] text-red-500 font-medium">期限切れ {Math.abs(daysLeft!)}日</span>
        </div>
      )}
      <p className={cn('text-sm font-medium text-gray-800 leading-snug', isDone && 'line-through text-gray-400')}>
        {task.title ?? 'タスク'}
      </p>
      {task.memo && (
        <p className="text-xs text-gray-400 mt-1 truncate">{task.memo}</p>
      )}
      <div className="flex items-center justify-between mt-2 gap-2">
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
  )
}

interface TaskKanbanBoardProps {
  tasks: Activity[]
  stages: TaskKanbanStage[]
  onAddTask?: (stageId: string) => void
  onEditTask?: (task: Activity) => void
}

export function TaskKanbanBoard({ tasks, stages, onAddTask, onEditTask }: TaskKanbanBoardProps) {
  const setTaskStage  = useAppStore((s) => s.setTaskStage)
  const taskStageMap  = useAppStore((s) => s.taskStageMap)
  const taskStatuses  = useAppStore((s) => s.taskStatuses)

  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  // タスクを各ステージに振り分け（done以外）
  const byStage = (stageId: string) =>
    tasks.filter((t) => {
      const effectiveStatus = taskStatuses[t.id] ?? t.status
      if (effectiveStatus === 'done' && stageId !== stages[stages.length - 1]?.id) return false
      const mapped = taskStageMap[t.id]
      if (mapped) return mapped === stageId
      // デフォルト：最初のステージ
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
    // over.id がステージIDの場合はそのステージへ、タスクIDの場合は同じステージへ
    const targetStage = stages.find((s) => s.id === overId)
      ?? stages.find((s) => byStage(s.id).some((t) => t.id === overId))
    if (targetStage) setTaskStage(taskId, targetStage.id)
  }

  return (
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
              {/* ヘッダー */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={cn('w-2.5 h-2.5 rounded-full', colors.dot)} />
                  <span className="text-sm font-bold text-gray-700">{stage.name}</span>
                </div>
                <span className={cn('text-xs px-2 py-0.5 rounded-full font-bold', colors.badge)}>
                  {stageTasks.length}
                </span>
              </div>

              {/* カード一覧 */}
              <SortableContext
                items={stageTasks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <DroppableColumn stageId={stage.id} isEmpty={stageTasks.length === 0}>
                  {stageTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      isDragging={task.id === activeId}
                      onEdit={onEditTask}
                    />
                  ))}
                </DroppableColumn>
              </SortableContext>

              {/* 追加ボタン */}
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
  )
}
