'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart2, Users, Filter, ArrowUpDown, ExternalLink, TrendingUp, Tag } from 'lucide-react'
import { DEFAULT_DIVISION_CUSTOM_FIELDS } from '@/lib/mock-data'
import { cn, getInitials, formatRelativeTime } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchContactsByDivision, fetchContactsCustomValues } from '@/lib/db/contacts'
import { fetchDivisionCustomFields } from '@/lib/db/divisions'
import type { Contact } from '@/types/database'
import type { DivisionCustomField } from '@/store/appStore'

// 分布チャートの色（循環利用）
const CHART_COLORS = [
  'bg-orange-400', 'bg-blue-400', 'bg-green-400',
  'bg-purple-400', 'bg-pink-400', 'bg-yellow-400', 'bg-teal-400',
]

function isSameMonth(dateStr: string) {
  const d = new Date(dateStr), now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

export default function AnalysisPage() {
  const router = useRouter()
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const activeDivision   = useAppStore((s) => s.activeDivision)
  const storeCustomFields = useAppStore((s) => s.divisionCustomFields)

  // ─── データ ────────────────────────────────────────────────────
  const [contacts, setContacts]           = useState<Contact[]>([])
  const [fields, setFields]               = useState<DivisionCustomField[]>([])
  const [customValuesMap, setCustomValuesMap] = useState<Record<string, Record<string, string>>>({})
  const [loading, setLoading]             = useState(false)

  useEffect(() => {
    if (!activeDivisionId) return
    setLoading(true)

    if (isSupabaseConfigured()) {
      Promise.all([
        fetchContactsByDivision(activeDivisionId),
        fetchDivisionCustomFields(activeDivisionId),
      ]).then(async ([contactsData, fieldsData]) => {
        setContacts(contactsData)
        // DB にフィールドがなければ store/デフォルトにフォールバック
        const resolvedFields = fieldsData.length > 0
          ? fieldsData
          : (storeCustomFields[activeDivisionId] ?? DEFAULT_DIVISION_CUSTOM_FIELDS[activeDivisionId] ?? [])
        setFields(resolvedFields)

        const ids = contactsData.map((c) => c.id)
        const vals = await fetchContactsCustomValues(ids)
        setCustomValuesMap(vals)
      }).finally(() => setLoading(false))
    } else {
      // デモモード
      const f = storeCustomFields[activeDivisionId] ?? DEFAULT_DIVISION_CUSTOM_FIELDS[activeDivisionId] ?? []
      setFields(f)
      setLoading(false)
    }
  }, [activeDivisionId]) // eslint-disable-line

  // ─── フィルター/ソート state ──────────────────────────────────
  const [filterFieldId, setFilterFieldId] = useState<string>('')
  const [filterValue, setFilterValue]     = useState<string>('')
  const [sortFieldId, setSortFieldId]     = useState<string>('')
  const [sortDir, setSortDir]             = useState<'asc' | 'desc'>('asc')
  const [nameQuery, setNameQuery]         = useState<string>('')

  const filterField = fields.find((f) => f.id === filterFieldId)
  const sortField   = fields.find((f) => f.id === sortFieldId)

  const filteredContacts = useMemo(() => {
    let list = [...contacts]

    // 名前・会社名の検索
    if (nameQuery.trim()) {
      const q = nameQuery.trim().toLowerCase()
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.companies?.name ?? '').toLowerCase().includes(q)
      )
    }

    // カスタムフィールドでフィルター（部分一致）
    if (filterField && filterValue.trim()) {
      list = list.filter((c) => {
        const val = customValuesMap[c.id]?.[filterField.id] ?? ''
        if (filterField.fieldType === 'select') return val === filterValue
        return val.toLowerCase().includes(filterValue.trim().toLowerCase())
      })
    }

    // カスタムフィールドでソート
    if (sortField) {
      list.sort((a, b) => {
        const va = customValuesMap[a.id]?.[sortField.id] ?? ''
        const vb = customValuesMap[b.id]?.[sortField.id] ?? ''
        const cmp = sortField.fieldType === 'number'
          ? (Number(va) || 0) - (Number(vb) || 0)
          : va.localeCompare(vb, 'ja')
        return sortDir === 'asc' ? cmp : -cmp
      })
    }

    return list
  }, [contacts, nameQuery, filterField, filterValue, sortField, sortDir, customValuesMap])

  // ─── 基本統計 ─────────────────────────────────────────────────
  const statsThisMonth = useMemo(
    () => contacts.filter((c) => isSameMonth(c.created_at)).length,
    [contacts]
  )
  const tagCounts = useMemo(() => {
    const m: Record<string, number> = {}
    contacts.forEach((c) => c.tags.forEach((tag) => { m[tag] = (m[tag] ?? 0) + 1 }))
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [contacts])

  // ─── 分布集計（select型フィールド） ──────────────────────────
  const distributions = useMemo(() => {
    return fields
      .filter((f) => f.fieldType === 'select')
      .map((field) => {
        const counts: Record<string, number> = {}
        contacts.forEach((c) => {
          const val = customValuesMap[c.id]?.[field.id] ?? ''
          const key = val || '未設定'
          counts[key] = (counts[key] ?? 0) + 1
        })
        const total   = contacts.length
        const entries = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .filter(([k]) => k !== '未設定')
        const unset = counts['未設定'] ?? 0
        return { field, entries, unset, total }
      })
  }, [fields, contacts, customValuesMap])

  if (loading) {
    return (
      <div className="w-full">
        <h1 className="text-2xl font-black text-gray-800 mb-1">分析</h1>
        <p className="text-sm text-gray-400 mb-6">読み込み中...</p>
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-800 mb-1">分析</h1>
        <p className="text-sm text-gray-500">
          {activeDivision?.name} · 顧客 {contacts.length}件
        </p>
      </div>

      {/* ─── 基本統計カード ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Users size={14} className="text-orange-500" />
            <span className="text-xs font-medium text-gray-500">総顧客数</span>
          </div>
          <p className="text-2xl font-black text-gray-800">{contacts.length}</p>
          <p className="text-xs text-gray-400 mt-0.5">件</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={14} className="text-green-500" />
            <span className="text-xs font-medium text-gray-500">今月の新規</span>
          </div>
          <p className="text-2xl font-black text-gray-800">{statsThisMonth}</p>
          <p className="text-xs text-gray-400 mt-0.5">件</p>
        </div>
        {tagCounts[0] && (
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Tag size={14} className="text-blue-500" />
              <span className="text-xs font-medium text-gray-500">トップタグ</span>
            </div>
            <p className="text-lg font-black text-gray-800 truncate">{tagCounts[0][0]}</p>
            <p className="text-xs text-gray-400 mt-0.5">{tagCounts[0][1]}件</p>
          </div>
        )}
        {tagCounts[1] && (
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Tag size={14} className="text-purple-500" />
              <span className="text-xs font-medium text-gray-500">2位タグ</span>
            </div>
            <p className="text-lg font-black text-gray-800 truncate">{tagCounts[1][0]}</p>
            <p className="text-xs text-gray-400 mt-0.5">{tagCounts[1][1]}件</p>
          </div>
        )}
      </div>

      {/* ─── タグ分布 ─── */}
      {tagCounts.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
            <Tag size={14} className="text-orange-500" />
            タグ分布
          </h3>
          <div className="space-y-2">
            {tagCounts.slice(0, 8).map(([tag, count], i) => {
              const pct = contacts.length > 0 ? Math.round((count / contacts.length) * 100) : 0
              return (
                <div key={tag}>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span className="font-medium">{tag}</span>
                    <span>{count}件 ({pct}%)</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', CHART_COLORS[i % CHART_COLORS.length])}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ─── カスタムフィールド分布チャート ─── */}
      {distributions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {distributions.map(({ field, entries, unset, total }) => (
            <div key={field.id} className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
                <BarChart2 size={14} className="text-orange-500" />
                {field.label} の分布
              </h3>
              <div className="space-y-2">
                {entries.map(([val, count], i) => {
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0
                  return (
                    <div key={val}>
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span className="font-medium">{val}</span>
                        <span>{count}件 ({pct}%)</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all', CHART_COLORS[i % CHART_COLORS.length])}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
                {unset > 0 && (
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>未設定</span>
                      <span>{unset}件</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-gray-200"
                        style={{ width: `${Math.round((unset / total) * 100)}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── フィルター・ソート ─── */}
      {contacts.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
          <div className="flex flex-wrap gap-3 items-end">
            {/* 名前・会社名検索 */}
            <div className="flex items-center gap-2 flex-1 min-w-40">
              <Users size={14} className="text-gray-400 flex-shrink-0" />
              <input
                type="text"
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                placeholder="名前・会社名で検索..."
                className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-500 w-full"
              />
            </div>

            {/* カスタムフィールドフィルター */}
            {fields.length > 0 && (
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
                    className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-500 w-36"
                  />
                )}
              </div>
            )}

            {/* ソート */}
            {fields.length > 0 && (
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
                    className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap"
                  >
                    {sortDir === 'asc' ? '昇順 ↑' : '降順 ↓'}
                  </button>
                )}
              </div>
            )}

            <div className="ml-auto flex items-center gap-2">
              {(filterFieldId || sortFieldId || nameQuery) && (
                <button
                  onClick={() => { setFilterFieldId(''); setFilterValue(''); setSortFieldId(''); setNameQuery('') }}
                  className="text-xs text-orange-500 hover:text-orange-700 font-medium transition-colors"
                >
                  リセット
                </button>
              )}
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {filteredContacts.length}件表示
                {filteredContacts.length !== contacts.length && ` / 全${contacts.length}件中`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ─── 顧客テーブル ─── */}
      {contacts.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-12 text-center">
          <Users size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">この事業部にはまだ顧客がいません</p>
          <p className="text-sm text-gray-400 mt-1">顧客を登録すると分析データが表示されます</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">顧客</th>
                  {fields.map((f) => (
                    <th key={f.id} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">
                      {f.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">最終更新</th>
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
                      const val = customValuesMap[contact.id]?.[f.id] ?? ''
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
                            <span className="text-gray-200 text-xs">—</span>
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
      )}

      {/* カスタムフィールド未設定の案内 */}
      {contacts.length > 0 && fields.length === 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-sm text-blue-700">
          <p className="font-medium mb-0.5">カスタムフィールドを設定すると詳細分析ができます</p>
          <p className="text-xs text-blue-500">設定 → 事業部別フィールドから追加できます</p>
        </div>
      )}
    </div>
  )
}
