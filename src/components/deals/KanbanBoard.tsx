'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  DndContext, DragEndEvent, DragStartEvent,
  MouseSensor, TouchSensor, useSensor, useSensors, DragOverlay, closestCorners,
  useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Plus, AlertCircle, AlertTriangle, Lock, ChevronDown } from 'lucide-react'
import { formatCurrency, getStaleDays, getInitials, cn, truncateMiddle } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { DEFAULT_DIVISION_STAGES } from '@/lib/mock-data'
import { hasTabs, stagesForTab, tabIdForStage } from '@/lib/pipeline-tabs'
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

// 現行のステージ定義に一致しない商談の受け皿カラム。
// ステージ再編・タブ削除などでstage_idが迷子になった商談を黙って隠さず、
// ここに表示して正しい列へドラッグで戻せるようにする（M&A事業部で実際に
// 「過去の案件がカンバンから消えた」事象が起きた対策）。
// 該当商談が0件のときは表示されない。
const UNASSIGNED_STAGE_ID = '__unassigned__'
const UNASSIGNED_STAGE = { id: UNASSIGNED_STAGE_ID, name: '未分類', won: false, lost: false }

// この件数を超えるカラムのみ仮想化する。少数カラムでは仮想化のオーバーヘッド
// （measure/absolute配置）がメリットを上回るため、閾値以下は従来の.map()を維持する。
const VIRTUALIZE_THRESHOLD = 50

// DealCard 1件分の推定高さ（px）。内訳の目安：
// padding+border(26) + タイトル2行(44) + 会社/担当者行(24) + 金額/期日行(20) + 担当者アバター行(32) + カード間gap(8) ≈ 154px
const ESTIMATED_CARD_SIZE = 154

const DEFAULT_OVERSCAN = 5
const DRAG_ACTIVE_OVERSCAN = 30

// 優先度の表示順（高→中→低）。未設定は「中」扱い
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

function sortByPriority(list: Deal[]): Deal[] {
  return [...list].sort(
    (a, b) => (PRIORITY_RANK[a.priority ?? 'medium'] ?? 1) - (PRIORITY_RANK[b.priority ?? 'medium'] ?? 1)
  )
}

// DATE型文字列（YYYY-MM-DD）をローカルタイムの日付として解釈し、今日からの残日数を返す。
// new Date('YYYY-MM-DD') はUTC解釈になり、JSTの朝の時間帯に1日ずれるため使わない
function daysUntilLocal(dateStr: string): number {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  const target = new Date(y, m - 1, d)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

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
  deal, isDragging, readOnly, onEdit, stageDone,
}: { deal: Deal; isDragging?: boolean; readOnly?: boolean; onEdit?: (deal: Deal) => void; stageDone?: boolean }) {
  const staleDays = getStaleDays(deal.updated_at)
  const isStale = staleDays >= 5

  // クロージング予定日の接近・超過（受注/失注済みのカラムでは表示しない）
  const daysUntilClose = deal.close_date ? daysUntilLocal(deal.close_date) : null
  const showDeadlineAlert = !stageDone && daysUntilClose !== null && daysUntilClose <= 7

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: deal.id,
    disabled: readOnly,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    // タッチ操作: 長押しドラッグ（TouchSensor）と縦スクロールを両立させる。
    // 'none'にするとカード上でスクロールできなくなるためmanipulationに留める
    touchAction: 'manipulation' as const,
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
        isStale || (showDeadlineAlert && daysUntilClose !== null && daysUntilClose < 0)
          ? 'border-red-400' : 'border-gray-100'
      )}
    >
      {isStale && (
        <div className="flex items-center gap-1 mb-2">
          <AlertCircle size={12} className="text-red-500" />
          <span className="text-xs text-red-500 font-medium">{staleDays}日遅延</span>
        </div>
      )}
      <div className="flex items-start gap-1.5 mb-1">
        {deal.priority === 'high' && (
          <span className="flex-shrink-0 mt-0.5 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 rounded px-1 leading-4">高</span>
        )}
        {deal.priority === 'low' && (
          <span className="flex-shrink-0 mt-0.5 text-[10px] font-bold text-gray-500 bg-gray-50 border border-gray-200 rounded px-1 leading-4">低</span>
        )}
        <p className="text-sm font-medium text-gray-800 line-clamp-2 flex-1">{deal.title}</p>
      </div>
      {deal.contacts && (
        <p className="text-xs text-gray-500 mb-1 truncate">
          {deal.contacts.companies?.name ?? ''} / {deal.contacts.name}
        </p>
      )}
      {deal.description && (
        <p className="text-xs text-gray-400 mb-2 line-clamp-2 whitespace-pre-wrap">{deal.description}</p>
      )}
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-gray-700">{formatCurrency(deal.amount)}</span>
        {deal.close_date && (
          showDeadlineAlert && daysUntilClose !== null ? (
            <span className={cn(
              'text-xs font-bold',
              daysUntilClose < 0 ? 'text-red-600' : 'text-amber-600'
            )}>
              {daysUntilClose < 0
                ? `期限超過 ${-daysUntilClose}日`
                : daysUntilClose === 0 ? '本日期限' : `期限まで${daysUntilClose}日`}
            </span>
          ) : (
            <span className="text-xs text-gray-400">
              {new Date(deal.close_date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
            </span>
          )
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

interface Stage {
  id: string
  name: string
  won: boolean
  lost: boolean
}

interface StageColumnProps {
  stage: Stage
  deals: Deal[]
  activeId: string | null
  readOnly: boolean
  isDragActive: boolean
  onEdit: (deal: Deal) => void
  onAdd: (stageId: string) => void
  columnRef: (el: HTMLDivElement | null) => void
}

function StageColumn({
  stage, deals, activeId, readOnly, isDragActive, onEdit, onAdd, columnRef,
}: StageColumnProps) {
  const total = deals.reduce((sum, d) => sum + d.amount, 0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldVirtualize = deals.length > VIRTUALIZE_THRESHOLD

  // 現状は固定サイズ推定（ESTIMATED_CARD_SIZE）のみでキャッシュは実害なし。
  // 将来 measureElement による動的計測を導入する場合、キャッシュはインデックスベースのため
  // カラムをまたぐドラッグで別カードの実測高さが誤って流用されるおそれがある点に注意。
  const virtualizer = useVirtualizer({
    count: deals.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_CARD_SIZE,
    overscan: isDragActive ? DRAG_ACTIVE_OVERSCAN : DEFAULT_OVERSCAN,
    enabled: shouldVirtualize,
  })

  const isUnassigned = stage.id === UNASSIGNED_STAGE_ID

  return (
    <div ref={columnRef} data-stage-id={stage.id} className="flex-shrink-0 w-64">
      <div className={cn(
        'rounded-xl p-3 mb-3 sticky top-0 z-10 backdrop-blur-sm',
        isUnassigned ? 'bg-yellow-50/95 border border-yellow-300' :
        stage.won ? 'bg-green-50/95 border border-green-200' :
        stage.lost ? 'bg-gray-50/95 border border-gray-200' :
        'bg-gray-100/95'
      )}>
        <div className="flex items-center justify-between mb-1">
          <h3 className={cn('text-sm font-bold',
            isUnassigned ? 'text-yellow-800' : stage.lost ? 'text-gray-400' : 'text-gray-700')}>
            {isUnassigned && <AlertTriangle size={13} className="inline mr-1 -mt-0.5" />}
            {stage.name}
          </h3>
          <span className="text-xs text-gray-500 bg-white rounded-full px-2 py-0.5">{deals.length}</span>
        </div>
        {isUnassigned && (
          <p className="text-[11px] text-yellow-700 leading-snug">
            現在の列に対応しない商談です。カードを正しい列へドラッグしてください
          </p>
        )}
        {total > 0 && (
          <p className={cn('text-xs', stage.lost ? 'text-gray-400 line-through' : 'text-gray-500')}>
            {formatCurrency(total)}
          </p>
        )}
      </div>

      <SortableContext
        id={stage.id}
        // dnd-kit のソート計算にはカラム内の全件IDが必要なため、仮想化で
        // DOMにマウントされていない件も含めた完全な配列を渡す（表示側のみ間引く）。
        items={deals.map((d) => d.id)}
        strategy={verticalListSortingStrategy}
      >
        <div ref={scrollRef} className="max-h-[calc(100vh-320px)] overflow-y-auto">
          <DroppableColumn stageId={stage.id} isEmpty={deals.length === 0}>
            {shouldVirtualize ? (
              <div style={{ position: 'relative', height: virtualizer.getTotalSize(), width: '100%' }}>
                {virtualizer.getVirtualItems().map((item) => {
                  const deal = deals[item.index]
                  return (
                    <div
                      key={deal.id}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${item.start}px)`,
                      }}
                    >
                      <DealCard
                        deal={deal}
                        isDragging={deal.id === activeId}
                        readOnly={readOnly}
                        onEdit={readOnly ? undefined : onEdit}
                        stageDone={stage.won || stage.lost}
                      />
                    </div>
                  )
                })}
              </div>
            ) : (
              deals.map((deal) => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  isDragging={deal.id === activeId}
                  readOnly={readOnly}
                  onEdit={readOnly ? undefined : onEdit}
                  stageDone={stage.won || stage.lost}
                />
              ))
            )}
          </DroppableColumn>
        </div>
      </SortableContext>

      {!readOnly && !stage.lost && !isUnassigned && (
        <button
          onClick={() => onAdd(stage.id)}
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
}

// ステージ位置インジケーター：横スクロール中にどのステージを見ているか見失う問題への対応。
// ボードの水平ビューポート内で交差しているカラムを IntersectionObserver で追跡し、
// 対応するチップをハイライトする。クリックで該当カラムへスムーススクロールする。
function StagePositionIndicator({
  stages, scrollRef, columnRefs,
}: {
  stages: Stage[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  columnRefs: React.RefObject<Map<string, HTMLDivElement>>
}) {
  const [visibleStageIds, setVisibleStageIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const root = scrollRef.current
    if (!root) return

    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleStageIds((prev) => {
          const next = new Set(prev)
          entries.forEach((entry) => {
            const stageId = entry.target.getAttribute('data-stage-id')
            if (!stageId) return
            if (entry.isIntersecting) next.add(stageId)
            else next.delete(stageId)
          })
          return next
        })
      },
      { root, threshold: 0.4 }
    )

    columnRefs.current.forEach((el) => observer.observe(el))

    return () => observer.disconnect()
    // columnRefs は useRef のため依存に入れても再セットアップ判定には寄与しない（意図的に除外）。
    // stages（= visibleStages）は showLost 切替でカラムが増減した時だけ参照が変わるようメモ化済み。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef, stages])

  const handleChipClick = (stageId: string) => {
    const el = columnRefs.current.get(stageId)
    el?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto mb-2 pb-1">
      {stages.map((stage) => {
        const isActive = visibleStageIds.has(stage.id)
        return (
          <button
            key={stage.id}
            onClick={() => handleChipClick(stage.id)}
            className={cn(
              'flex-shrink-0 px-2 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap',
              isActive ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            )}
            title={stage.name}
          >
            {truncateMiddle(stage.name)}
          </button>
        )
      })}
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
  const divisionTabs = useAppStore((s) => s.divisionTabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const setActiveTabId = useAppStore((s) => s.setActiveTabId)
  const [showLost, setShowLost] = useState(false)

  // 事業部内パイプラインタブ（任意機能）。タブが1件も無い事業部は従来通り全ステージを表示する。
  const tabs = activeDivisionId ? (divisionTabs[activeDivisionId] ?? []) : []
  // 選択中タブIDが現在のタブ一覧に存在しない（タブ削除・別データの残骸）場合は先頭タブへフォールバックし、
  // 「どのタブにも属さない空ボード」が表示されるのを防ぐ
  const storedTabId = activeDivisionId ? (activeTabId[activeDivisionId] ?? null) : null
  const currentTabId = storedTabId && tabs.some((t) => t.id === storedTabId)
    ? storedTabId
    : (tabs[0]?.id ?? null)

  // 事業部別ステージ（ストア上書き → デフォルト → フォールバック）
  // 参照の安定性が StagePositionIndicator の IntersectionObserver 再セットアップ判定に
  // 使われるため、activeDivisionId/divisionStages/タブ関連の値が変わらない限り同一参照を保つ。
  const stages = useMemo(() => {
    const divId = activeDivisionId ?? ''
    const raw = divisionStages[divId] ?? DEFAULT_DIVISION_STAGES[divId]
    if (!raw) return FALLBACK_stages
    const scoped = tabs.length > 0 ? stagesForTab(raw, currentTabId) : raw
    const mapped = scoped.map((s) => ({ id: s.id, name: s.isWon ? `${s.name} 🎉` : s.name, won: s.isWon, lost: s.isLost }))
    // 失注ステージが定義されていない場合のみ追加
    if (!mapped.some((s) => s.lost)) {
      mapped.push({ id: '失注', name: '失注', won: false, lost: true })
    }
    // 受注ステージの絵文字付与漏れ対応済み・lost ステージを末尾に整列
    return [...mapped.filter((s) => !s.lost), ...mapped.filter((s) => s.lost)]
  }, [activeDivisionId, divisionStages, tabs.length, currentTabId])

  const buildMap = (deals: Deal[]) => {
    const map: Record<string, Deal[]> = {}
    stages.forEach((s) => { map[s.id] = [] })
    map[UNASSIGNED_STAGE_ID] = []
    deals.forEach((d) => {
      // 他事業部の商談は表示しない。事業部切替直後に前事業部のデータが渡ってきた場合に
      // 「未分類」へ紛れ込むのを防ぐ
      if (activeDivisionId && d.division_id !== activeDivisionId) return
      if (tabs.length > 0) {
        const rawStages = divisionStages[activeDivisionId ?? ''] ?? []
        const dealTabId = tabIdForStage(rawStages, d.stage_id)
        if (dealTabId === currentTabId) {
          if (map[d.stage_id]) { map[d.stage_id].push(d); return }
          map[UNASSIGNED_STAGE_ID].push(d) // 通常は到達しないが安全側
          return
        }
        // 別の（実在する）タブのステージに載っている商談は、そのタブ側で表示する
        if (dealTabId !== null && tabs.some((t) => t.id === dealTabId)) return
        // ステージ定義に一致しない／どのタブにも属さないステージの商談 → 未分類。
        // どのタブを開いていても見えるようにする（隠れて気づけないのが一番の問題のため）
        map[UNASSIGNED_STAGE_ID].push(d)
        return
      }
      if (map[d.stage_id]) map[d.stage_id].push(d)
      else map[UNASSIGNED_STAGE_ID].push(d)
    })
    // 各カラム内を優先度順（高→中→低）に整列。同順位は元の並び（最終更新の新しい順）を維持
    Object.keys(map).forEach((k) => { map[k] = sortByPriority(map[k]) })
    return map
  }

  const [dealsByStage, setDealsByStage] = useState<Record<string, Deal[]>>(() => buildMap(initialDeals))

  // ドラッグ中でなければ initialDeals またはタブ切替時に同期
  useEffect(() => {
    if (activeId !== null) return
    setDealsByStage(buildMap(initialDeals))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDeals, currentTabId])

  const [activeId, setActiveId] = useState<string | null>(null)
  const [showConfetti, setShowConfetti] = useState(false)

  const boardScrollRef = useRef<HTMLDivElement>(null)
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const setColumnRef = useCallback((stageId: string) => (el: HTMLDivElement | null) => {
    if (el) columnRefs.current.set(stageId, el)
    else columnRefs.current.delete(stageId)
  }, [])

  // マウスは従来どおり5px移動でドラッグ開始。タッチはスクロールと区別するため
  // 長押し（250ms）でドラッグ開始（スマホでカードを動かせない問題への対応）
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
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
    // 「未分類」へのドロップは不可（実在しないステージIDを保存しないため）
    if (toStage === UNASSIGNED_STAGE_ID) return

    const deal = findDeal(active.id as string)
    if (!deal) return

    const updatedAt = new Date().toISOString()
    setDealsByStage((prev) => {
      const next = { ...prev }
      next[fromStage] = next[fromStage].filter((d) => d.id !== deal.id)
      // 移動先カラムも優先度順を維持（末尾appendのままだと「高」が「低」の下に表示される）
      next[toStage] = sortByPriority([...next[toStage], { ...deal, stage_id: toStage, updated_at: updatedAt }])
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
  const unassignedCount = dealsByStage[UNASSIGNED_STAGE_ID]?.length ?? 0
  // showLost 切替時以外は同一参照を保ち、IntersectionObserver の無駄な再セットアップを防ぐ
  const visibleStages = useMemo(() => {
    const base = showLost ? stages : stages.filter((s) => !s.lost)
    // 迷子の商談があるときだけ「未分類」カラムを先頭に表示する
    return unassignedCount > 0 ? [UNASSIGNED_STAGE, ...base] : base
  }, [stages, showLost, unassignedCount])
  const isDragActive = activeId !== null

  return (
    <>
      {showConfetti && <Confetti />}

      {hasTabs(divisionTabs, activeDivisionId) && (
        <div className="flex items-center gap-1.5 mb-3">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              aria-pressed={tab.id === currentTabId}
              onClick={() => activeDivisionId && setActiveTabId(activeDivisionId, tab.id)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                tab.id === currentTabId
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              )}
            >
              {tab.name}
            </button>
          ))}
        </div>
      )}

      <StagePositionIndicator stages={visibleStages} scrollRef={boardScrollRef} columnRefs={columnRefs} />

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
        <div ref={boardScrollRef} className="flex gap-4 overflow-x-auto pb-4 min-h-[calc(100vh-260px)]">
          {visibleStages.map((stage) => {
            const deals = dealsByStage[stage.id] ?? []
            return (
              <StageColumn
                key={stage.id}
                stage={stage}
                deals={deals}
                activeId={activeId}
                readOnly={readOnly}
                isDragActive={isDragActive}
                onEdit={(d) => openDealModal({ deal: d })}
                onAdd={(stageId) => openDealModal({ prefillStageId: stageId })}
                columnRef={setColumnRef(stage.id)}
              />
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
