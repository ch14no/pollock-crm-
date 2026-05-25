'use client'

import { useState, useEffect, useRef } from 'react'
import { KanbanBoard } from '@/components/deals/KanbanBoard'
import { Button } from '@/components/ui/Button'
import { Plus, Lock } from 'lucide-react'
import { useAppStore, selectIsOwnDivision } from '@/store/appStore'
import { formatCurrency } from '@/lib/utils'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchDealsByDivision } from '@/lib/db/deals'
import type { Deal } from '@/types/database'

export default function DealsPage() {
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const activeDivision   = useAppStore((s) => s.activeDivision)
  const isOwnDivision    = useAppStore(selectIsOwnDivision)
  const openDealModal    = useAppStore((s) => s.openDealModal)
  const dealModalIsOpen  = useAppStore((s) => s.dealModal.isOpen)
  const localDeals       = useAppStore((s) => s.localDeals)

  const [dbDeals, setDbDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const prevModalOpen = useRef(false)

  const loadDeals = async () => {
    if (!activeDivisionId || !isSupabaseConfigured()) return
    setLoading(true)
    try {
      const data = await fetchDealsByDivision(activeDivisionId)
      setDbDeals(data)
    } finally {
      setLoading(false)
    }
  }

  // 事業部変更時に再取得
  useEffect(() => { loadDeals() }, [activeDivisionId]) // eslint-disable-line

  // モーダルが閉じたタイミングで再取得（追加・編集・失注後の反映）
  useEffect(() => {
    if (prevModalOpen.current && !dealModalIsOpen) {
      loadDeals()
      setReloadKey((k) => k + 1)
    }
    prevModalOpen.current = dealModalIsOpen
  }, [dealModalIsOpen]) // eslint-disable-line

  const divisionDeals: Deal[] = isSupabaseConfigured()
    ? dbDeals
    : localDeals.filter((d) => d.division_id === activeDivisionId)

  const activeDeals = divisionDeals.filter((d) => d.stage_id !== '受注' && d.stage_id !== '失注')
  const pipelineTotal = activeDeals.reduce((sum, d) => sum + d.amount, 0)

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-black text-gray-800">商談カンバン</h1>
          <p className="text-sm text-gray-500">
            {activeDivision?.name}
            {loading ? ' · 読み込み中...' : ` · 進行中 ${activeDeals.length}件 · 見込み額合計 `}
            {!loading && <span className="font-medium text-gray-700">{formatCurrency(pipelineTotal)}</span>}
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

      <KanbanBoard
        key={`${activeDivisionId}-${reloadKey}`}
        initialDeals={divisionDeals}
        readOnly={!isOwnDivision}
      />
    </div>
  )
}
