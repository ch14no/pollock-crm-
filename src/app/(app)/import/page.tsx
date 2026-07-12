'use client'

import { useState, useEffect, useMemo } from 'react'
import { Download, FileText, ChevronDown, ChevronUp, Check } from 'lucide-react'
import { CSVImporter } from '@/components/import/CSVImporter'
import { useAppStore } from '@/store/appStore'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchContactsByDivision, fetchContactsCustomValues } from '@/lib/db/contacts'
import { fetchDivisionCustomFields } from '@/lib/db/divisions'
import type { Contact } from '@/types/database'
import type { DivisionCustomField } from '@/store/appStore'
import { DEFAULT_DIVISION_CUSTOM_FIELDS } from '@/lib/mock-data'
import { LOCATIONS } from '@/lib/config'
import toast from 'react-hot-toast'
import { cn, escapeCsvCell } from '@/lib/utils'

// ─── エクスポート列定義 ─────────────────────────────────────────
interface ExportColumn {
  key: string
  label: string
  mandatory?: boolean
  getValue: (c: Contact, customVals: Record<string, string>) => string
}

const BASE_COLUMNS: ExportColumn[] = [
  { key: 'name',       label: '氏名',       mandatory: true, getValue: (c) => c.name },
  { key: 'company',    label: '会社名',                      getValue: (c) => c.companies?.name ?? '' },
  { key: 'position',   label: '役職',                        getValue: (c) => c.position ?? '' },
  { key: 'email',      label: 'メール',                      getValue: (c) => c.email ?? '' },
  { key: 'phone',      label: '電話番号',                    getValue: (c) => c.phone ?? '' },
  { key: 'tags',       label: 'タグ',                        getValue: (c) => c.tags.filter((t) => !LOCATIONS.some((l) => l.id === t)).join('|') },
  { key: 'location',   label: '拠点',                        getValue: (c) => c.tags.filter((t) => LOCATIONS.some((l) => l.id === t)).join('|') },
  { key: 'assignee',   label: '担当者',                      getValue: (c) => c.users?.name ?? '' },
  { key: 'updated_at', label: '最終更新日',                  getValue: (c) => c.updated_at.slice(0, 10) },
  { key: 'created_at', label: '作成日',                      getValue: (c) => c.created_at.slice(0, 10) },
]

function buildCustomColumn(field: DivisionCustomField): ExportColumn {
  return {
    key: `custom_${field.id}`,
    label: field.label,
    getValue: (_c, customVals) => customVals[field.id] ?? '',
  }
}

function generateCSV(
  contacts: Contact[],
  selectedColumns: ExportColumn[],
  customValuesMap: Record<string, Record<string, string>>
): string {
  const headers = selectedColumns.map((c) => c.label)
  const rows = contacts.map((contact) =>
    selectedColumns.map((col) => col.getValue(contact, customValuesMap[contact.id] ?? {}))
  )
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\n')
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ─── エクスポートセクション ─────────────────────────────────────
function ExportSection() {
  const activeDivision   = useAppStore((s) => s.activeDivision)
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const storeCustomFields = useAppStore((s) => s.divisionCustomFields)

  const [contacts, setContacts]           = useState<Contact[]>([])
  const [customValuesMap, setCustomValuesMap] = useState<Record<string, Record<string, string>>>({})
  const [customFields, setCustomFields]   = useState<DivisionCustomField[]>([])
  const [loading, setLoading]             = useState(false)
  const [exporting, setExporting]         = useState(false)
  const [showColumnPicker, setShowColumnPicker] = useState(false)

  // 選択列（key のセット）
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    new Set(['name', 'company', 'position', 'email', 'phone', 'tags', 'location', 'assignee', 'updated_at'])
  )

  // フィルター
  const [tagFilter, setTagFilter]       = useState<string>('')
  const [locationFilter, setLocationFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')

  useEffect(() => {
    if (!activeDivisionId) return
    if (!isSupabaseConfigured()) return
    setLoading(true)
    Promise.all([
      fetchContactsByDivision(activeDivisionId),
      fetchDivisionCustomFields(activeDivisionId),
    ]).then(async ([contactsData, fieldsData]) => {
      setContacts(contactsData)
      const resolvedFields = fieldsData.length > 0
        ? fieldsData
        : (storeCustomFields[activeDivisionId] ?? DEFAULT_DIVISION_CUSTOM_FIELDS[activeDivisionId] ?? [])
      setCustomFields(resolvedFields)
      // カスタムフィールドを初期選択に追加
      setSelectedKeys((prev) => {
        const next = new Set(prev)
        resolvedFields.forEach((f) => next.add(`custom_${f.id}`))
        return next
      })
      const vals = await fetchContactsCustomValues(contactsData.map((c) => c.id))
      setCustomValuesMap(vals)
    }).finally(() => setLoading(false))
  }, [activeDivisionId]) // eslint-disable-line

  // 全列定義（基本 + カスタム）
  const allColumns = useMemo((): ExportColumn[] => [
    ...BASE_COLUMNS,
    ...customFields.map(buildCustomColumn),
  ], [customFields])

  // タグ一覧（フィルター用）
  const allTags = useMemo(() => {
    const set = new Set<string>()
    contacts.forEach((c) => c.tags.forEach((t) => {
      if (!LOCATIONS.some((l) => l.id === t)) set.add(t)
    }))
    return [...set].sort()
  }, [contacts])

  // 拠点一覧
  const allLocations = useMemo(() => {
    const set = new Set<string>()
    contacts.forEach((c) => c.tags.forEach((t) => {
      if (LOCATIONS.some((l) => l.id === t)) set.add(t)
    }))
    return [...set].sort()
  }, [contacts])

  // フィルター適用後の顧客
  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      if (tagFilter && !c.tags.includes(tagFilter)) return false
      if (locationFilter && !c.tags.includes(locationFilter)) return false
      if (statusFilter === 'has_email' && !c.email) return false
      if (statusFilter === 'has_phone' && !c.phone) return false
      if (statusFilter === 'vip' && !c.tags.includes('VIP')) return false
      return true
    })
  }, [contacts, tagFilter, locationFilter, statusFilter])

  const selectedColumns = allColumns.filter((col) => selectedKeys.has(col.key))

  const toggleKey = (key: string, mandatory?: boolean) => {
    if (mandatory) return
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedKeys.size === allColumns.length) {
      setSelectedKeys(new Set(allColumns.filter((c) => c.mandatory).map((c) => c.key)))
    } else {
      setSelectedKeys(new Set(allColumns.map((c) => c.key)))
    }
  }

  const handleExport = async () => {
    if (filteredContacts.length === 0) { toast.error('エクスポートする顧客がいません'); return }
    if (selectedColumns.length === 0) { toast.error('出力列を1つ以上選択してください'); return }
    setExporting(true)
    try {
      const csv = generateCSV(filteredContacts, selectedColumns, customValuesMap)
      const filters = [
        tagFilter ? `tag-${tagFilter}` : '',
        locationFilter ? `loc-${locationFilter}` : '',
        statusFilter ? statusFilter : '',
      ].filter(Boolean).join('_')
      const suffix = filters ? `_${filters}` : ''
      const filename = `contacts_${activeDivision?.name ?? 'export'}${suffix}_${new Date().toISOString().slice(0, 10)}.csv`
      downloadCSV(csv, filename)
      toast.success(`${filteredContacts.length}件・${selectedColumns.length}列をエクスポートしました`)
    } catch {
      toast.error('エクスポートに失敗しました')
    } finally {
      setExporting(false)
    }
  }

  const allSelected = selectedKeys.size === allColumns.length

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100">
        <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
          <Download size={20} className="text-green-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-gray-800">CSVエクスポート</h2>
          <p className="text-xs text-gray-500">
            {loading ? '読み込み中...' : `${activeDivision?.name ?? '―'} · 顧客 ${contacts.length}件`}
          </p>
        </div>
      </div>

      <div className="px-6 py-5 space-y-5">
        {/* ─── 列選択 ─── */}
        <div>
          <button
            onClick={() => setShowColumnPicker((v) => !v)}
            className="w-full flex items-center justify-between text-sm font-medium text-gray-700 mb-2 hover:text-orange-600 transition-colors"
          >
            <span>出力列を選択 <span className="text-gray-400 font-normal">（{selectedColumns.length}/{allColumns.length}列）</span></span>
            {showColumnPicker ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          {showColumnPicker && (
            <div className="border border-gray-200 rounded-xl p-4 space-y-3">
              {/* 全選択トグル */}
              <button
                onClick={toggleAll}
                className="text-xs text-orange-500 hover:text-orange-700 font-medium transition-colors"
              >
                {allSelected ? 'すべて解除' : 'すべて選択'}
              </button>

              {/* 基本フィールド */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">基本項目</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {BASE_COLUMNS.map((col) => (
                    <label
                      key={col.key}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition-all select-none',
                        selectedKeys.has(col.key)
                          ? 'border-orange-300 bg-orange-50 text-orange-700'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                        col.mandatory && 'opacity-70 cursor-default'
                      )}
                      onClick={() => toggleKey(col.key, col.mandatory)}
                    >
                      <span className={cn(
                        'w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                        selectedKeys.has(col.key) ? 'bg-orange-500 border-orange-500' : 'border-gray-300'
                      )}>
                        {selectedKeys.has(col.key) && <Check size={10} className="text-white" />}
                      </span>
                      <span className="truncate">{col.label}</span>
                      {col.mandatory && <span className="text-xs text-orange-400 ml-auto flex-shrink-0">必須</span>}
                    </label>
                  ))}
                </div>
              </div>

              {/* カスタムフィールド */}
              {customFields.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">カスタムフィールド</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {customFields.map((field) => {
                      const key = `custom_${field.id}`
                      return (
                        <label
                          key={key}
                          className={cn(
                            'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition-all select-none',
                            selectedKeys.has(key)
                              ? 'border-orange-300 bg-orange-50 text-orange-700'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                          )}
                          onClick={() => toggleKey(key)}
                        >
                          <span className={cn(
                            'w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                            selectedKeys.has(key) ? 'bg-orange-500 border-orange-500' : 'border-gray-300'
                          )}>
                            {selectedKeys.has(key) && <Check size={10} className="text-white" />}
                          </span>
                          <span className="truncate">{field.label}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── 絞り込みフィルター ─── */}
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">絞り込み <span className="text-gray-400 font-normal text-xs">（任意）</span></p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {/* タグ */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">タグ</label>
              <select
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50"
              >
                <option value="">すべて</option>
                {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* 拠点 */}
            {allLocations.length > 0 && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">拠点</label>
                <select
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50"
                >
                  <option value="">すべて</option>
                  {allLocations.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            )}

            {/* 条件 */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">条件</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50"
              >
                <option value="">すべて</option>
                <option value="vip">VIPのみ</option>
                <option value="has_email">メールあり</option>
                <option value="has_phone">電話番号あり</option>
              </select>
            </div>
          </div>

          {/* フィルター適用中の件数表示 */}
          {(tagFilter || locationFilter || statusFilter) && (
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-orange-600 font-medium">
                {filteredContacts.length}件が対象（全{contacts.length}件中）
              </p>
              <button
                onClick={() => { setTagFilter(''); setLocationFilter(''); setStatusFilter('') }}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                リセット
              </button>
            </div>
          )}
        </div>

        {/* ─── ダウンロードボタン ─── */}
        <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            <span className="font-medium text-gray-700">{filteredContacts.length}件</span> ·{' '}
            <span className="font-medium text-gray-700">{selectedColumns.length}列</span> をエクスポート
          </p>
          <button
            onClick={handleExport}
            disabled={exporting || loading || filteredContacts.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
          >
            <FileText size={16} />
            {exporting ? 'エクスポート中...' : 'CSVをダウンロード'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── ページ本体 ─────────────────────────────────────────────────
export default function ImportExportPage() {
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)

  return (
    <div className="max-w-3xl mx-auto space-y-10">
      <div>
        <h1 className="text-2xl font-black text-gray-800">インポート・エクスポート</h1>
        <p className="text-sm text-gray-500 mt-0.5">顧客データのCSVエクスポートとインポートができます</p>
      </div>

      {/* エクスポート */}
      <ExportSection />

      {/* インポート */}
      <div>
        <div className="mb-4">
          <h2 className="text-lg font-bold text-gray-800">CSVインポート</h2>
          <p className="text-sm text-gray-500 mt-0.5">既存のExcel・CSVリストを取り込みます</p>
        </div>
        <CSVImporter divisionId={activeDivisionId ?? undefined} />
      </div>
    </div>
  )
}
