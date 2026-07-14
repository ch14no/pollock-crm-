'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { CalendarClock } from 'lucide-react'
import { fetchMilestoneTypesByDivision, fetchDealMilestones, upsertDealMilestone } from '@/lib/db/milestones'
import type { DealMilestone, DivisionMilestoneType } from '@/types/database'
import toast from 'react-hot-toast'

interface DealMilestonesSectionProps {
  dealId: string
  divisionId: string
}

// 案件の対応期日（マイルストーン、M&A事業部要望⑧）。
// 「クロージング」は既存のclose_date欄をそのまま使うため、ここでは新設の
// division_milestone_types（M&Aは7種をシード済み）だけを扱う。
export function DealMilestonesSection({ dealId, divisionId }: DealMilestonesSectionProps) {
  const [visible, setVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [types, setTypes] = useState<DivisionMilestoneType[]>([])
  const [milestones, setMilestones] = useState<DealMilestone[]>([])
  const [savingId, setSavingId] = useState<string | null>(null)

  const loadSeq = useRef(0)
  const loadData = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const [typesData, milestonesData] = await Promise.all([
        fetchMilestoneTypesByDivision(divisionId),
        fetchDealMilestones(dealId),
      ])
      if (loadSeq.current !== seq) return
      setTypes(typesData)
      setMilestones(milestonesData)
      // 種別が事業部に1つも設定されていない場合はセクション自体を表示しない
      // （M&A以外の事業部で、まだマイルストーン運用を使っていないケース）
      setVisible(typesData.length > 0)
    } catch {
      // 022マイグレーション未適用など。エラーは画面に出さずセクション自体を隠す
      if (loadSeq.current === seq) setVisible(false)
    } finally {
      if (loadSeq.current === seq) setLoaded(true)
    }
  }, [dealId, divisionId])

  useEffect(() => {
    setLoaded(false)
    void loadData()
  }, [loadData])

  const handleDateChange = useCallback(async (typeId: string, dueDate: string) => {
    setSavingId(typeId)
    // 楽観的更新
    const prev = milestones
    setMilestones((cur) => {
      const existing = cur.find((m) => m.milestone_type_id === typeId)
      if (!dueDate) return cur.filter((m) => m.milestone_type_id !== typeId)
      if (existing) return cur.map((m) => m.milestone_type_id === typeId ? { ...m, due_date: dueDate } : m)
      return [...cur, {
        id: `local-${typeId}`, deal_id: dealId, division_id: divisionId,
        milestone_type_id: typeId, due_date: dueDate,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }]
    })
    try {
      await upsertDealMilestone(dealId, divisionId, typeId, dueDate || null)
      await loadData()
    } catch {
      setMilestones(prev)
      toast.error('対応期日の保存に失敗しました')
    } finally {
      setSavingId(null)
    }
  }, [dealId, divisionId, milestones, loadData])

  if (!loaded || !visible) return null

  return (
    <div className="pt-2 border-t border-gray-100">
      <div className="flex items-center gap-1.5 mb-2">
        <CalendarClock className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
        <h3 className="text-sm font-medium text-gray-700">対応期日</h3>
      </div>
      <div className="space-y-1.5">
        {types.map((type) => {
          const milestone = milestones.find((m) => m.milestone_type_id === type.id)
          return (
            <div key={type.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm">
              <label htmlFor={`milestone-${type.id}`} className="text-gray-700 flex-1 min-w-0 truncate">{type.name}</label>
              <input
                id={`milestone-${type.id}`}
                type="date"
                value={milestone?.due_date ? milestone.due_date.slice(0, 10) : ''}
                disabled={savingId === type.id}
                onChange={(e) => handleDateChange(type.id, e.target.value)}
                className="px-2 py-1 text-sm border border-gray-200 rounded-lg bg-white
                  focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50"
              />
            </div>
          )
        })}
      </div>
      <p className="text-xs text-gray-400 mt-1.5">クロージングの期日は上部の「クロージング予定日」欄をご利用ください</p>
    </div>
  )
}
