'use client'

import { useMemo } from 'react'
import { KanbanBoard } from '@/components/deals/KanbanBoard'
import { MOCK_DEALS } from '@/lib/mock-data'
import { Button } from '@/components/ui/Button'
import { Plus, Lock } from 'lucide-react'
import { useAppStore, selectIsOwnDivision } from '@/store/appStore'
import { formatCurrency } from '@/lib/utils'

export default function DealsPage() {
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const activeDivision   = useAppStore((s) => s.activeDivision)
  const isOwnDivision    = useAppStore(selectIsOwnDivision)
  const openDealModal    = useAppStore((s) => s.openDealModal)
  const localDeals       = useAppStore((s) => s.localDeals)

  const divisionDeals = useMemo(
    () => [...MOCK_DEALS, ...localDeals].filter((d) => d.division_id === activeDivisionId),
    [activeDivisionId, localDeals]
  )

  const activeDeals = divisionDeals.filter((d) => d.stage_id !== '受注' && d.stage_id !== '失注')
  const pipelineTotal = activeDeals.reduce((sum, d) => sum + d.amount, 0)

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-black text-gray-800">商談カンバン</h1>
          <p className="text-sm text-gray-500">
            {activeDivision?.name} · 進行中 {activeDeals.length}件
            · 見込み額合計 <span className="font-medium text-gray-700">{formatCurrency(pipelineTotal)}</span>
            {!isOwnDivision && ' · 閲覧のみ'}
          </p>
        </div>
        {isOwnDivision ? (
          <Button icon={<Plus size={16} />} onClick={() => openDealModal()}>新規商談</Button>
        ) : (
          <Button icon={<Lock size={16} />} variant="secondary" disabled>
            新規商談（閲覧のみ）
          </Button>
        )}
      </div>

      {!isOwnDivision && (
        <div className="flex items-center gap-2 px-4 py-3 mb-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-800">
          <Lock size={15} className="flex-shrink-0 text-yellow-600" />
          <span>
            <strong>{activeDivision?.name}</strong> の商談を閲覧中です。カードの移動・編集は担当事業部のみ可能です。
          </span>
        </div>
      )}

      <KanbanBoard key={divisionDeals.length} initialDeals={divisionDeals} readOnly={!isOwnDivision} />
    </div>
  )
}
