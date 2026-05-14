'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart2, Users, Filter, ArrowUpDown, ExternalLink } from 'lucide-react'
import { MOCK_CONTACTS, DEFAULT_DIVISION_CUSTOM_FIELDS } from '@/lib/mock-data'
import { cn, getInitials, formatRelativeTime } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'

export default function AnalysisPage() {
  const router = useRouter()
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const activeDivision   = useAppStore((s) => s.activeDivision)
  const divisionCustomFields = useAppStore((s) => s.divisionCustomFields)
  const contactCustomValues  = useAppStore((s) => s.contactCustomValues)

  // 有効なフィールド定義
  const fields = useMemo(() => {
    const divId = activeDivisionId ?? ''
    return divisionCustomFields[divId] ?? DEFAULT_DIVISION_CUSTOM_FIELDS[divId] ?? []
  }, [divisionCustomFields, activeDivisionId])

  // この事業部の顧客
  const divContacts = useMemo(
    () => MOCK_CONTACTS.filter((c) => c.division_id === activeDivisionId),
    [activeDivisionId]
  )

  const [filterFieldId, setFilterFieldId]   = useState<string>('')
  const [filterValue, setFilterValue]       = useState<string>('')
  const [sortFieldId, setSortFieldId]       = useState<string>('')
  const [sortDir, setSortDir]               = useState<'asc' | 'desc'>('asc')

  const filterField = fields.find((f) => f.id === filterFieldId)
  const sortField   = fields.find((f) => f.id === sortFieldId)

  const filteredContacts = useMemo(() => {
    let list = [...divContacts]

    if (filterField && filterValue) {
      list = list.filter((c) => {
        const val = contactCustomValues[c.id]?.[filterField.id] ?? ''
        return val === filterValue
      })
    }

    if (sortField) {
      list.sort((a, b) => {
        const va = contactCustomValues[a.id]?.[sortField.id] ?? ''
        const vb = contactCustomValues[b.id]?.[sortField.id] ?? ''
        const cmp = sortField.fieldType === 'number'
          ? (Number(va) || 0) - (Number(vb) || 0)
          : va.localeCompare(vb, 'ja')
        return sortDir === 'asc' ? cmp : -cmp
      })
    }

    return list
  }, [divContacts, filterField, filterValue, sortField, sortDir, contactCustomValues])

  // セレクト型フィールドの分布集計
  const distributions = useMemo(() => {
    return fields
      .filter((f) => f.fieldType === 'select')
      .map((field) => {
        const counts: Record<string, number> = {}
        divContacts.forEach((c) => {
          const val = contactCustomValues[c.id]?.[field.id] ?? '未設定'
          counts[val] = (counts[val] ?? 0) + 1
        })
        const total = divContacts.length
        const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
        return { field, counts, entries, total }
      })
  }, [fields, divContacts, contactCustomValues])

  if (fields.length === 0) {
    return (
      <div className="w-full">
        <h1 className="text-2xl font-black text-gray-800 mb-1">分析</h1>
        <p className="text-sm text-gray-500 mb-6">{activeDivision?.name}</p>
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-12 text-center">
          <BarChart2 size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">この事業部にカスタムフィールドが設定されていません</p>
          <p className="text-sm text-gray-400 mt-1">設定 → 事業部別フィールドから追加できます</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-800 mb-1">分析</h1>
        <p className="text-sm text-gray-500">{activeDivision?.name} · 顧客 {divContacts.length}件</p>
      </div>

      {/* 分布チャート */}
      {distributions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {distributions.map(({ field, entries, total }) => (
            <div key={field.id} className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
                <BarChart2 size={14} className="text-orange-500" />
                {field.label} の分布
              </h3>
              <div className="space-y-2">
                {entries.map(([val, count]) => {
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0
                  return (
                    <div key={val}>
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span className={cn('font-medium', val === '未設定' && 'text-gray-300')}>{val}</span>
                        <span>{count}件 ({pct}%)</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all', val === '未設定' ? 'bg-gray-200' : 'bg-orange-400')}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* フィルター・ソート */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
        <div className="flex flex-wrap gap-3 items-end">
          {/* フィルター */}
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-gray-400 flex-shrink-0" />
            <select
              value={filterFieldId}
              onChange={(e) => { setFilterFieldId(e.target.value); setFilterValue('') }}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="">絞り込み項目</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            {filterField && filterField.fieldType === 'select' && (
              <select
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="">すべて</option>
                {filterField.options?.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            )}
            {filterField && filterField.fieldType !== 'select' && (
              <input
                type={filterField.fieldType === 'number' ? 'number' : 'text'}
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                placeholder={`${filterField.label}で絞り込み`}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-500 w-40"
              />
            )}
          </div>

          {/* ソート */}
          <div className="flex items-center gap-2">
            <ArrowUpDown size={14} className="text-gray-400 flex-shrink-0" />
            <select
              value={sortFieldId}
              onChange={(e) => setSortFieldId(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="">並び替え項目</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            {sortFieldId && (
              <button
                onClick={() => setSortDir((d) => d === 'asc' ? 'desc' : 'asc')}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {sortDir === 'asc' ? '昇順 ↑' : '降順 ↓'}
              </button>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {(filterFieldId || sortFieldId) && (
              <button
                onClick={() => { setFilterFieldId(''); setFilterValue(''); setSortFieldId('') }}
                className="text-xs text-orange-500 hover:text-orange-700 font-medium transition-colors"
              >
                リセット
              </button>
            )}
            <span className="text-xs text-gray-400">
              {filteredContacts.length}件表示
              {filterFieldId && filterValue && ` / 全${divContacts.length}件中`}
            </span>
          </div>
        </div>
      </div>

      {/* 顧客一覧 */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">顧客</th>
                {fields.map((f) => (
                  <th key={f.id} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">
                    {f.label}
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">最終更新</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredContacts.length === 0 ? (
                <tr>
                  <td colSpan={fields.length + 3} className="px-4 py-10 text-center text-gray-400 text-sm">
                    <Users size={24} className="mx-auto mb-2 text-gray-300" />
                    条件に一致する顧客がいません
                  </td>
                </tr>
              ) : filteredContacts.map((contact) => (
                <tr
                  key={contact.id}
                  onClick={() => router.push(`/contacts/${contact.id}`)}
                  className="hover:bg-orange-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 text-xs font-bold flex-shrink-0">
                        {getInitials(contact.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-700 truncate">{contact.name}</p>
                        {contact.companies && (
                          <p className="text-xs text-gray-400 truncate">{contact.companies.name}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  {fields.map((f) => {
                    const val = contactCustomValues[contact.id]?.[f.id] ?? ''
                    return (
                      <td key={f.id} className="px-4 py-3">
                        {val ? (
                          <span className={cn(
                            'text-sm',
                            f.fieldType === 'select'
                              ? 'inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-700'
                              : 'text-gray-600'
                          )}>
                            {val}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                    {formatRelativeTime(contact.updated_at)}
                  </td>
                  <td className="px-4 py-3">
                    <ExternalLink size={12} className="text-gray-300" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
