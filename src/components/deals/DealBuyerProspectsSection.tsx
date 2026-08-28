'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Handshake, Trash2, Download } from 'lucide-react'
import {
  fetchDealBuyerProspects, createBuyerProspect, updateBuyerProspect, deleteBuyerProspect,
} from '@/lib/db/buyerProspects'
import { CompanyPicker } from '@/components/ui/CompanyPicker'
import { useAppStore } from '@/store/appStore'
import { escapeCsvCell, extractPrefecture } from '@/lib/utils'
import type { DealBuyerProspect, NameClearStatus } from '@/types/database'
import toast from 'react-hot-toast'

interface DealBuyerProspectsSectionProps {
  dealId: string
  divisionId: string
  dealTitle: string
}

const NAME_CLEAR_OPTIONS: NameClearStatus[] = ['可', '否']

function exportProspectsCSV(prospects: DealBuyerProspect[], dealTitle: string) {
  const headers = ['No', '企業名・法人名', '上場区分', '都道府県', '代表者名', '業種', '事業内容', 'URL', '所感', 'ネームクリア可否']
  const rows = prospects.map((p, i) => {
    const c = p.company
    const reps = [c?.representative, c?.representative2].filter(Boolean).join('／')
    return [
      String(i + 1),
      c?.name ?? '（削除された会社）',
      c?.listing_status ?? '',
      c?.prefecture || extractPrefecture(c?.address) || '',
      reps,
      c?.industry_class?.name ?? c?.industry ?? '',
      c?.business_description ?? '',
      c?.website ?? '',
      p.note ?? '',
      p.name_clear ?? '未確認',
    ]
  })
  const csv = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  a.download = `買手打診リスト_${dealTitle}_${today}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// 買手打診リスト（047、M&A事業部要望フェーズ2）。企業名・代表者・業種等はcompany_id経由の
// ライブ参照で表示し、この行が固有に持つのは所感とネームクリア可否のみ
export function DealBuyerProspectsSection({ dealId, divisionId, dealTitle }: DealBuyerProspectsSectionProps) {
  const currentUser = useAppStore((s) => s.currentUser)

  const [visible, setVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [prospects, setProspects] = useState<DealBuyerProspect[]>([])
  const [adding, setAdding] = useState(false)

  const loadSeq = useRef(0)
  const loadData = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const data = await fetchDealBuyerProspects(dealId)
      if (loadSeq.current !== seq) return
      setProspects(data)
      setVisible(true)
    } catch {
      // 047マイグレーション未適用など。エラーは画面に出さずセクション自体を隠す
      if (loadSeq.current === seq) setVisible(false)
    } finally {
      if (loadSeq.current === seq) setLoaded(true)
    }
  }, [dealId])

  useEffect(() => {
    setLoaded(false)
    void loadData()
  }, [loadData])

  const handleAdd = useCallback(async (companyId: string) => {
    try {
      await createBuyerProspect({ dealId, divisionId, companyId, createdBy: currentUser?.id })
      await loadData()
      setAdding(false)
      toast.success('買手候補を追加しました')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '買手候補の追加に失敗しました')
    }
  }, [dealId, divisionId, currentUser, loadData])

  const handleUpdateNameClear = useCallback(async (id: string, nameClear: NameClearStatus | '') => {
    try {
      await updateBuyerProspect(id, { nameClear: nameClear || null })
      await loadData()
    } catch (e) {
      // DBは正しい状態なのに画面だけ古い値が残る「幽霊」を防ぐため失敗時も再読込する
      await loadData()
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    }
  }, [loadData])

  const handleUpdateNote = useCallback(async (id: string, note: string) => {
    try {
      await updateBuyerProspect(id, { note: note || null })
      await loadData()
    } catch (e) {
      await loadData()
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
    }
  }, [loadData])

  const handleDelete = useCallback(async (prospect: DealBuyerProspect) => {
    if (!window.confirm(`「${prospect.company?.name ?? 'この買手候補'}」を打診リストから削除しますか？`)) return
    try {
      await deleteBuyerProspect(prospect.id)
      await loadData()
      toast.success('削除しました')
    } catch (e) {
      await loadData()
      toast.error(e instanceof Error ? e.message : '削除に失敗しました')
    }
  }, [loadData])

  if (!loaded || !visible) return null

  const excludeIds = prospects.map((p) => p.company_id).filter((id): id is string => !!id)

  return (
    <div className="pt-2 border-t border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Handshake className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
          <h3 className="text-sm font-medium text-gray-700">買手の打診結果</h3>
        </div>
        <button
          type="button"
          onClick={() => exportProspectsCSV(prospects, dealTitle)}
          disabled={prospects.length === 0}
          className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-orange-600
            disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          CSV出力
        </button>
      </div>

      {prospects.length > 0 && (
        <div className="overflow-x-auto mb-2 border border-gray-200 rounded-lg">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500">
                <th className="px-2 py-1.5 text-left font-medium">No</th>
                <th className="px-2 py-1.5 text-left font-medium">企業名</th>
                <th className="px-2 py-1.5 text-left font-medium">上場区分</th>
                <th className="px-2 py-1.5 text-left font-medium">都道府県</th>
                <th className="px-2 py-1.5 text-left font-medium">代表者</th>
                <th className="px-2 py-1.5 text-left font-medium">業種</th>
                <th className="px-2 py-1.5 text-left font-medium">ネームクリア</th>
                <th className="px-2 py-1.5 text-left font-medium">所感</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {prospects.map((p, i) => {
                const c = p.company
                const reps = [c?.representative, c?.representative2].filter(Boolean).join('／')
                return (
                  <tr key={p.id}>
                    <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                    <td className="px-2 py-1.5 text-gray-800 font-medium whitespace-nowrap">
                      {c?.name ?? <span className="text-gray-300">（削除された会社）</span>}
                    </td>
                    <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{c?.listing_status ?? '—'}</td>
                    <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
                      {c?.prefecture || extractPrefecture(c?.address) || '—'}
                    </td>
                    <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{reps || '—'}</td>
                    <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
                      {c?.industry_class?.name ?? c?.industry ?? '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={p.name_clear ?? ''}
                        onChange={(e) => handleUpdateNameClear(p.id, e.target.value as NameClearStatus | '')}
                        className="text-xs border border-gray-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-orange-500"
                      >
                        <option value="">未確認</option>
                        {NAME_CLEAR_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      {/* keyにp.noteを含めることで、保存失敗時のloadData()による巻き戻しを
                          確実に画面へ反映する（uncontrolled inputはdefaultValueの変化だけでは
                          再描画されず、拒否された未保存の入力が残り続けてしまうため） */}
                      <input
                        key={`${p.id}-${p.note ?? ''}`}
                        type="text"
                        defaultValue={p.note ?? ''}
                        onBlur={(e) => {
                          if (e.target.value !== (p.note ?? '')) handleUpdateNote(p.id, e.target.value)
                        }}
                        placeholder="所感"
                        className="w-32 text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-orange-500"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => handleDelete(p)}
                        aria-label={`${c?.name ?? 'この買手候補'}を削除`}
                        className="text-gray-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
          <CompanyPicker
            onSelect={(id) => handleAdd(id)}
            excludeIds={excludeIds}
            placeholder="買手候補の会社を検索..."
          />
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
          >
            キャンセル
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700
            px-2 py-1.5 rounded-lg hover:bg-orange-50 transition-colors"
        >
          <Handshake className="w-3.5 h-3.5" aria-hidden="true" />
          買手候補を追加
        </button>
      )}
    </div>
  )
}
