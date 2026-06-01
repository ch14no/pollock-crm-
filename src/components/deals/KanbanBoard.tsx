'use client'

import { useState, useEffect, useRef } from 'react'
import {
  DndContext, DragEndEvent, DragStartEvent,
  PointerSensor, useSensor, useSensors, DragOverlay, closestCorners,
  useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, AlertCircle, Lock, ChevronDown } from 'lucide-react'
import { formatCurrency, getStaleDays, getInitials, cn } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { DEFAULT_DIVISION_STAGES } from '@/lib/mock-data'
import { isSupabaseConfigured } from '@/lib/db/client'
import { updateDealStage } from '@/lib/db/deals'
import type { Deal } from '@/types/database'
import toast from 'react-hot-toast'
import Confetti from './Confetti'

const FALLBACK_stages = [
  { id: 'リード',       name: 'リード',       won: false, lost: false },
  { id: '初回面談',     name: '初回面談',     won: false, lost: false },
  { id: '提案中',       name: '提案中',       won: false, lost: false },
  { id: 'クロージング', name: 'クロージング', won: false, lost: false },
  { id: '受注',         name: '受注 🎉',      won: true,  lost: false },
  { id: '失注',         name: '失注',         won: false, lost: true  },
]

// 空のカラムでもドロップ可能にするラッパー
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
        'min-h-24 rounded-xl transition-colors',
        isOver && 'bg-orange-50 ring-2 ring-orange-200',
        isEmpty && !isOver && 'border-2 border-dashed border-gray-200'
      )}
    >
      {isEmpty && !isOver ? (
        <div className="flex items-center justify-center h-20 text-xs text-gray-300">
          ここにドロップ
        </div>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  )
}

function DealCard({
  deal, isDragging, readOnly, onEdit,
}: { deal: Deal; isDragging?: boolean; readOnly?: boolean; onEdit?: (deal: Deal) => void }) {
  const staleDays = getStaleDays(deal.updated_at)
  const isStale = staleDays >= 5

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: deal.id,
    disabled: readOnly,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const assignee = deal.users ?? null

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(readOnly ? {} : listeners)}
      onClick={() => onEdit?.(deal)}
      className={cn(
        'bg-white rounded-xl p-3 border shadow-sm transition-all duration-200',
        readOnly ? 'cursor-default' : 'cursor-grab active:cursor-grabbing hover:shadow-md hover:-translate-y-0.5',
        isStale ? 'border-red-400' : 'border-gray-100'
      )}
    >
      {isStale && (
        <div className="flex items-center gap-1 mb-2">
          <AlertCircle size={12} className="text-red-500" />
          <span className="text-xs text-red-500 font-medium">{staleDays}日遅延</span>
        </div>
      )}
      <p className="text-sm font-medium text-gray-800 mb-1 line-clamp-2">{deal.title}</p>
      {deal.contacts && (
        <p className="text-xs text-gray-500 mb-2 truncate">
          {deal.contacts.companies?.name ?? ''} / {deal.contacts.name}
        </p>
      )}
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-gray-700">{formatCurrency(deal.amount)}</span>
        {deal.close_date && (
          <span className="text-xs text-gray-400">
            {new Date(deal.close_date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
      {assignee && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-50">
          <div className="w-4 h-4 rounded-full bg-orange-200 flex items-center justify-center text-orange-700 text-[9px] font-bold flex-shrink-0">
            {getInitials(assignee.name)}
          </div>
          <span className="text-xs text-gray-400 truncate">{assignee.name}</span>
        </div>
      )}
    </div>
  )
}

interface KanbanBoardProps {
  initialDeals: Deal[]
  readOnly?: boolean
}

export function KanbanBoard({ initialDeals, readOnly = false }: KanbanBoardProps) {
  const { openDealModal, updateLocalDeal } = useAppStore()
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const divisionStages = useAppStore((s) => s.divisionStages)
  const [showLost, setShowLost] = useState(false)

  // 事業部別ステージ（ストア上書き → デフォルト → フォールバック）
  const stages = (() => {
    const divId = activeDivisionId ?? ''
    const raw = divisionStages[divId] ?? DEFAULT_DIVISION_STAGES[divId]
    if (!raw) return FALLBACK_stages
    const mapped = raw.map((s) => ({ id: s.id, name: s.isWon ? `${s.name} 🎉` : s.name, won: s.isWon, lost: s.isLost }))
    // 失注ステージが定義されていない場合のみ追加
    if (!mapped.some((s) => s.lost)) {
      mapped.push({ id: '失注', name: '失注', won: false, lost: true })
    }
    // 受注ステージの絵文字付与漏れ対応済み・lost ステージを末尾に整列
    return [...mapped.filter((s) => !s.lost), ...mapped.filter((s) => s.lost)]
  })()

  const buildMap = (deals: Deal[]) => {
    const map: Record<string, Deal[]> = {}
    stages.forEach((s) => { map[s.id] = [] })
    deals.forEach((d) => {
      if (map[d.stage_id]) map[d.stage_id].push(d)
      else if (map[stages[0]?.id ?? 'リード']) map[stages[0]?.id ?? 'リード'].push(d)
    })
    return map
  }

  const [dealsByStage, setDealsByStage] = useState<Record<string, Deal[]>>(() => buildMap(initialDeals))

  // 初期ロード時（Supabase取得完了後）にdealsが空→非空になったら同期
  const hasInitialized = useRef(initialDeals.length > 0)
  useEffect(() => {
    if (hasInitialized.current || initialDeals.length === 0) return
    hasInitialized.current = true
    setDealsByStage(buildMap(initialDeals))
  }, [initialDeals]) // eslint-disable-line

  const [activeId, setActiveId] = useState<string | null>(null)
  const [showConfetti, setShowConfetti] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const findDeal = (id: string): Deal | undefined => {
    for (const deals of Object.values(dealsByStage)) {
      const found = deals.find((d) => d.id === id)
      if (found) return found
    }
  }

  const findStageForDeal = (id: string): string | undefined => {
    for (const [stageId, deals] of Object.entries(dealsByStage)) {
      if (deals.find((d) => d.id === id)) return stageId
    }
  }

  const handleDragStart = ({ active }: DragStartEvent) => {
    if (readOnly) return
    setActiveId(active.id as string)
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    if (readOnly || !over) return

    const fromStage = findStageForDeal(active.id as string)
    // useDroppable の id（stage.id）にドロップした場合も対応
    const toStage = stages.find((s) => s.id === over.id)?.id ?? findStageForDeal(over.id as string)
    if (!fromStage || !toStage || fromStage === toStage) return

    const deal = findDeal(active.id as string)
    if (!deal) return

    const updatedAt = new Date().toISOString()
    setDealsByStage((prev) => {
      const next = { ...prev }
      next[fromStage] = next[fromStage].filter((d) => d.id !== deal.id)
      next[toStage] = [...next[toStage], { ...deal, stage_id: toStage, updated_at: updatedAt }]
      return next
    })
    // DB 商談はSupabaseへ反映、ローカル商談はストアへ反映
    if (isSupabaseConfigured() && !deal.id.startsWith('deal-local-')) {
      updateDealStage(deal.id, toStage).catch(() => {
        toast.error('ステージの更新に失敗しました')
      })
    }
    if (deal.id.startsWith('deal-local-')) {
      updateLocalDeal(deal.id, { stage_id: toStage, updated_at: updatedAt })
    }

    const targetStage = stages.find((s) => s.id === toStage)
    if (targetStage?.won) {
      setShowConfetti(true)
      setTimeout(() => setShowConfetti(false), 3500)
      toast.success(`🎉 ${deal.title} が受注になりました！`, { duration: 4000 })
    } else if (targetStage?.lost) {
      toast('📋 失注として記録しました', { duration: 3000 })
    }
  }

  const activeDeal = activeId ? findDeal(activeId) : null
  const lostStageId = stages.find((s) => s.lost)?.id ?? '失注'
  const lostCount = dealsByStage[lostStageId]?.length ?? 0
  const visibleStages = showLost ? stages : stages.filter((s) => !s.lost)

  return (
    <>
      {showConfetti && <Confetti />}

      {lostCount > 0 && (
        <button
          onClick={() => setShowLost((v) => !v)}
          className="mb-3 flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ChevronDown size={14} className={cn('transition-transform', showLost && 'rotate-180')} />
          {showLost ? '失注カラムを非表示' : `失注を表示（${lostCount}件）`}
        </button>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 min-h-[calc(100vh-260px)]">
          {visibleStages.map((stage) => {
            const deals = dealsByStage[stage.id] ?? []
            const total = deals.reduce((sum, d) => sum + d.amount, 0)
            return (
              <div key={stage.id} className="flex-shrink-0 w-64">
                <div className={cn(
                  'rounded-xl p-3 mb-3',
                  stage.won ? 'bg-green-50 border border-green-200' :
                  stage.lost ? 'bg-gray-50 border border-gray-200' :
                  'bg-gray-100'
                )}>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className={cn('text-sm font-bold', stage.lost ? 'text-gray-400' : 'text-gray-700')}>
                      {stage.name}
                    </h3>
                    <span className="text-xs text-gray-500 bg-white rounded-full px-2 py-0.5">{deals.length}</span>
                  </div>
                  {total > 0 && (
                    <p className={cn('text-xs', stage.lost ? 'text-gray-400 line-through' : 'text-gray-500')}>
                      {formatCurrency(total)}
                    </p>
                  )}
                </div>

                <SortableContext
                  id={stage.id}
                  items={deals.map((d) => d.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
                    <DroppableColumn stageId={stage.id} isEmpty={deals.length === 0}>
                      {deals.map((deal) => (
                        <DealCard
                          key={deal.id}
                          deal={deal}
                          isDragging={deal.id === activeId}
                          readOnly={readOnly}
                          onEdit={readOnly ? undefined : (d) => openDealModal({ deal: d })}
                        />
                      ))}
                    </DroppableColumn>
                  </div>
                </SortableContext>

                {!readOnly && !stage.lost && (
                  <button
                    onClick={() => openDealModal({ prefillStageId: stage.id })}
                    className="mt-2 w-full flex items-center justify-center gap-1 py-2 text-xs text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded-lg transition-colors"
                  >
                    <Plus size={14} />
                    追加
                  </button>
                )}
                {readOnly && (
                  <div className="mt-2 w-full flex items-center justify-center gap-1 py-2 text-xs text-gray-300">
                    <Lock size={12} />
                    閲覧のみ
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <DragOverlay>
          {activeDeal && <DealCard deal={activeDeal} readOnly={readOnly} />}
        </DragOverlay>
      </DndContext>
    </>
  )
}
