'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { CalendarClock, Check } from 'lucide-react'
import { fetchMilestoneTypesByDivision, fetchDealMilestones, upsertDealMilestone } from '@/lib/db/milestones'
import { MilestoneDatePicker } from '@/components/ui/MilestoneDatePicker'
import { cn } from '@/lib/utils'
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

  // 日付・対応済みチェックのどちらの変更でも呼ぶ共通ハンドラ。
  // 未指定の側は現在の値をそのまま引き継ぐ（片方だけの変更で他方を消さない）
  const handleUpdate = useCallback(async (typeId: string, updates: { dueDate?: string; completed?: boolean }) => {
    setSavingId(typeId)
    const prev = milestones
    const existing = milestones.find((m) => m.milestone_type_id === typeId)
    const nextDueDate = updates.dueDate !== undefined ? updates.dueDate : (existing?.due_date ?? '')
    const nextCompleted = updates.completed !== undefined ? updates.completed : !!existing?.completed_at

    setMilestones((cur) => {
      if (!nextDueDate && !nextCompleted) return cur.filter((m) => m.milestone_type_id !== typeId)
      const patch = {
        due_date: nextDueDate || undefined,
        completed_at: nextCompleted ? new Date().toISOString() : undefined,
      }
      if (existing) return cur.map((m) => m.milestone_type_id === typeId ? { ...m, ...patch } : m)
      return [...cur, {
        id: `local-${typeId}`, deal_id: dealId, division_id: divisionId,
        milestone_type_id: typeId, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        ...patch,
      }]
    })
    try {
      // completedは実際にチェックが操作されたときだけ渡す（updates.completedのまま透過。
      // nextCompletedのような「現在値から合成した値」を渡すと、日付だけの編集のたびに
      // upsertDealMilestone側でcompleted_atが「今」に再スタンプされ、本来の対応済み
      // 日時が上書きされ続けてしまう／code-reviewで指摘）。
      // 削除してよいかは、両方が空になると分かっているここ（呼び出し元）でのみ判断できる
      await upsertDealMilestone(dealId, divisionId, typeId, {
        dueDate: nextDueDate || null,
        completed: updates.completed,
        shouldDelete: !nextDueDate && !nextCompleted,
      })
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
        <h3 className="text-sm font-medium text-gray-700">対応期日・対応済</h3>
      </div>
      <div className="space-y-1.5">
        {types.map((type) => {
          const milestone = milestones.find((m) => m.milestone_type_id === type.id)
          const isCompleted = !!milestone?.completed_at
          const isSaving = savingId === type.id
          return (
            <div key={type.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm">
              <span className={cn('flex-1 min-w-0 truncate', isCompleted ? 'text-gray-400 line-through' : 'text-gray-700')}>
                {type.name}
              </span>
              <button
                type="button"
                onClick={() => handleUpdate(type.id, { completed: !isCompleted })}
                disabled={isSaving}
                aria-label={isCompleted ? `${type.name}の対応済みを解除` : `${type.name}を対応済みにする`}
                aria-pressed={isCompleted}
                className={cn(
                  'w-5 h-5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-colors disabled:opacity-50',
                  isCompleted ? 'bg-orange-500 border-orange-500' : 'border-gray-300 hover:border-orange-400 bg-white'
                )}
              >
                {isCompleted && <Check size={12} className="text-white" />}
              </button>
              <MilestoneDatePicker
                value={milestone?.due_date ? milestone.due_date.slice(0, 10) : ''}
                disabled={isSaving}
                milestoneLabel={type.name}
                onChange={(dueDate) => handleUpdate(type.id, { dueDate })}
              />
            </div>
          )
        })}
      </div>
      <p className="text-xs text-gray-400 mt-1.5">クロージングの期日は上部の「クロージング予定日」欄をご利用ください</p>
    </div>
  )
}
