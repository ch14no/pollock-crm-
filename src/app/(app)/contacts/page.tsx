'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Search, Plus, Building2, Phone, Mail,
  LayoutList, LayoutGrid, ChevronDown, MapPin, SlidersHorizontal, Lock, CreditCard, X,
  Trash2, Download, CheckSquare, Square, Filter, Info, Briefcase,
} from 'lucide-react'
import { MOCK_CONTACTS, MOCK_TEAM_MEMBERS } from '@/lib/mock-data'
import { LOCATIONS, getLocationConfig, getLocationsByRegion, sortTags } from '@/lib/config'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatRelativeTime, getInitials, cn, escapeCsvCell } from '@/lib/utils'
import { useAppStore, selectIsOwnDivision } from '@/store/appStore'
import type { ContactStatus } from '@/store/appStore'
import { STATUS_CONFIG } from '@/lib/contactStatus'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchContactsByDivision, deleteContacts, fetchContactStatusesBatch, fetchContactsCustomValues, updateContact } from '@/lib/db/contacts'
import { fetchDealsByDivision } from '@/lib/db/deals'
import type { Contact } from '@/types/database'
import toast from 'react-hot-toast'

type ViewMode = 'list' | 'card' | 'company'
type SortKey = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc' | 'company_asc' | 'company_desc'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'updated_desc', label: '最終更新（新しい順）' },
  { value: 'updated_asc',  label: '最終更新（古い順）' },
  { value: 'name_asc',     label: '氏名（昇順）' },
  { value: 'name_desc',    label: '氏名（降順）' },
  { value: 'company_asc',  label: '会社名（昇順）' },
  { value: 'company_desc', label: '会社名（降順）' },
]

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

function matchSearch(value: string | undefined, query: string): boolean {
  if (!value) return false
  return normalize(value).includes(normalize(query))
}

function LocationBadge({ tag }: { tag: string }) {
  const cfg = getLocationConfig(tag)
  if (!cfg) return null
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cfg.color)}>
      <MapPin size={10} />
      {cfg.label}
    </span>
  )
}

function TagBadge({ tag }: { tag: string }) {
  const isLocation = LOCATIONS.some((l) => l.id === tag)
  if (isLocation) return <LocationBadge tag={tag} />
  return <Badge variant={tag === 'VIP' ? 'orange' : 'default'}>{tag}</Badge>
}

function exportContactsCSV(contacts: Contact[], filename: string) {
  const headers = ['氏名', '会社名', '役職', 'メール', '電話番号', 'タグ', '最終更新']
  const rows = contacts.map((c) => [
    c.name,
    c.companies?.name ?? '',
    c.position ?? '',
    c.email ?? '',
    c.phone ?? '',
    c.tags.join('|'),
    c.updated_at,
  ])
  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function ContactsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeDivisionId  = useAppStore((s) => s.activeDivisionId)
  const activeDivision    = useAppStore((s) => s.activeDivision)
  const isOwnDivision     = useAppStore(selectIsOwnDivision)
  const contactStatuses   = useAppStore((s) => s.contactStatuses)
  const localContactEdits = useAppStore((s) => s.localContactEdits)
  const divisionCustomFields = useAppStore((s) => s.divisionCustomFields)
  const localDeals        = useAppStore((s) => s.localDeals)

  const [dbContacts, setDbContacts] = useState<Contact[]>([])
  const [dbLoading, setDbLoading] = useState(false)
  const [dealCounts, setDealCounts] = useState<Record<string, number>>({})
  const [query, setQuery]               = useState(() => searchParams.get('q') ?? '')
  useEffect(() => { setQuery(searchParams.get('q') ?? '') }, [searchParams])
  const [sortKey, setSortKey]           = useState<SortKey>('updated_desc')
  const [viewMode, setViewMode]         = useState<ViewMode>('company')
  const [locationFilter, setLocationFilter] = useState<string | null>(null)
  const [tagFilter, setTagFilter]           = useState<string | null>(null)
  const [showSortMenu, setShowSortMenu]       = useState(false)
  const [showFilters, setShowFilters]         = useState(false)
  const [showAutoTag, setShowAutoTag]         = useState(false)
  const [autoTagRunning, setAutoTagRunning]   = useState(false)
  const [autoTagKeywords, setAutoTagKeywords] = useState<Record<string, string>>(() =>
    Object.fromEntries(LOCATIONS.map((loc) => [loc.id, loc.id === '東京' ? '東京都,神奈川県,埼玉県,千葉県' : loc.id === '大阪' ? '大阪府,京都府,兵庫県' : `${loc.id}県`]))
  )
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [deleting, setDeleting]         = useState(false)
  const sortMenuRef = useRef<HTMLDivElement>(null)

  // ステータス・カスタムフィールドフィルター
  const [listStatuses, setListStatuses] = useState<Record<string, string[]>>({})
  const [listCustomValues, setListCustomValues] = useState<Record<string, Record<string, string>>>({})
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [customFieldFilters, setCustomFieldFilters] = useState<Record<string, string>>({})

  const loadContacts = useCallback(async () => {
    if (!activeDivisionId || !isSupabaseConfigured()) return
    setDbLoading(true)
    try {
      const data = await fetchContactsByDivision(activeDivisionId)
      setDbContacts(data)
      const ids = data.map((c) => c.id)
      if (ids.length > 0) {
        const [statuses, customVals] = await Promise.all([
          fetchContactStatusesBatch(ids),
          fetchContactsCustomValues(ids),
        ])
        setListStatuses(statuses)
        setListCustomValues(customVals)
      }
    } finally {
      setDbLoading(false)
    }
  }, [activeDivisionId])

  // 事業部を素早く切り替えたとき、古いレスポンスが後から届いて
  // 別事業部の件数バッジを表示しないよう、リクエストの通し番号で破棄する
  const dealCountsSeq = useRef(0)
  const loadDealCounts = useCallback(async () => {
    if (!activeDivisionId || !isSupabaseConfigured()) return
    const seq = ++dealCountsSeq.current
    try {
      const deals = await fetchDealsByDivision(activeDivisionId)
      if (dealCountsSeq.current !== seq) return
      const counts: Record<string, number> = {}
      for (const deal of deals) {
        if (!deal.contact_id) continue
        counts[deal.contact_id] = (counts[deal.contact_id] ?? 0) + 1
      }
      setDealCounts(counts)
    } catch {
      if (dealCountsSeq.current === seq) setDealCounts({})
    }
  }, [activeDivisionId])

  useEffect(() => {
    loadContacts()
    loadDealCounts()
    setSelectedIds(new Set())
  }, [loadContacts, loadDealCounts])

  // デモモード：Zustandのローカル商談を事業部で集計
  useEffect(() => {
    if (isSupabaseConfigured() || !activeDivisionId) return
    const counts: Record<string, number> = {}
    for (const deal of localDeals) {
      if (deal.division_id !== activeDivisionId || !deal.contact_id) continue
      counts[deal.contact_id] = (counts[deal.contact_id] ?? 0) + 1
    }
    setDealCounts(counts)
  }, [activeDivisionId, localDeals])

  useEffect(() => {
    if (!showSortMenu) return
    const handler = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSortMenu])

  const divisionContacts = useMemo((): Contact[] => {
    const base = isSupabaseConfigured()
      ? dbContacts
      : (MOCK_CONTACTS as Contact[]).filter((c) => c.division_id === activeDivisionId)
    return base.map((c) => {
      const edit = localContactEdits[c.id]
      return edit ? { ...c, ...edit } : c
    })
  }, [dbContacts, activeDivisionId, localContactEdits])

  // select型カスタムフィールドのみフィルター対象
  const selectCustomFields = useMemo(() => {
    const fields = divisionCustomFields[activeDivisionId ?? ''] ?? []
    return fields.filter((f) => f.fieldType === 'select' && (f.options?.length ?? 0) > 0)
  }, [divisionCustomFields, activeDivisionId])

  const filtered = useMemo(() => {
    let result = divisionContacts.filter((c) => {
      const matchQuery =
        !query ||
        matchSearch(c.name, query) ||
        matchSearch(c.companies?.name, query) ||
        matchSearch(c.email, query) ||
        matchSearch(c.position, query) ||
        matchSearch(c.phone, query)

      const matchLocation =
        locationFilter === null ? true :
        locationFilter === 'none'
          ? !LOCATIONS.some((l) => c.tags.includes(l.id))
          : c.tags.includes(locationFilter)

      const matchStatus =
        statusFilter.length === 0 ? true :
        statusFilter.every((s) => (listStatuses[c.id] ?? contactStatuses[c.id] ?? []).includes(s))

      const matchCustom = Object.entries(customFieldFilters).every(([fieldId, val]) => {
        if (!val) return true
        // バッジ表示（customBadges）と同じフォールバック順で照合する。
        // 旧データ（custom_attributes側にのみ値がある顧客）がバッジは出るのに絞り込みで消える不整合を防ぐ
        const field = selectCustomFields.find((f) => f.id === fieldId)
        const legacy = field ? c.custom_attributes?.[field.name] : undefined
        const value = listCustomValues[c.id]?.[fieldId] ?? (typeof legacy === 'string' ? legacy : '')
        return value === val
      })

      const matchTag = tagFilter === null ? true : c.tags.includes(tagFilter)

      return matchQuery && matchLocation && matchStatus && matchCustom && matchTag
    })

    result = [...result].sort((a, b) => {
      switch (sortKey) {
        case 'updated_desc': return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        case 'updated_asc':  return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
        case 'name_asc':     return a.name.localeCompare(b.name, 'ja')
        case 'name_desc':    return b.name.localeCompare(a.name, 'ja')
        case 'company_asc': {
          const ca = a.companies?.name ?? '', cb = b.companies?.name ?? ''
          if (!ca && cb) return 1; if (ca && !cb) return -1
          return ca.localeCompare(cb, 'ja')
        }
        case 'company_desc': {
          const ca = a.companies?.name ?? '', cb = b.companies?.name ?? ''
          if (!ca && cb) return 1; if (ca && !cb) return -1
          return cb.localeCompare(ca, 'ja')
        }
        default: return 0
      }
    })
    return result
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divisionContacts, query, sortKey, locationFilter, tagFilter, statusFilter, customFieldFilters, listStatuses, contactStatuses, listCustomValues, selectCustomFields])

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        filtered.forEach((c) => next.delete(c.id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        filtered.forEach((c) => next.add(c.id))
        return next
      })
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return
    const ok = window.confirm(`選択した${selectedIds.size}件の顧客を削除しますか？\nこの操作は取り消せません。`)
    if (!ok) return
    setDeleting(true)
    try {
      await deleteContacts([...selectedIds])
      setDbContacts((prev) => prev.filter((c) => !selectedIds.has(c.id)))
      toast.success(`${selectedIds.size}件削除しました`)
      setSelectedIds(new Set())
    } catch {
      toast.error('削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  const handleExportSelected = () => {
    const targets = filtered.filter((c) => selectedIds.has(c.id))
    const filename = `contacts_${activeDivision?.name ?? 'export'}_${new Date().toISOString().slice(0, 10)}.csv`
    exportContactsCSV(targets, filename)
    toast.success(`${targets.length}件をCSVエクスポートしました`)
  }

  const handleExportAll = () => {
    const filename = `contacts_${activeDivision?.name ?? 'all'}_${new Date().toISOString().slice(0, 10)}.csv`
    exportContactsCSV(filtered, filename)
    toast.success(`${filtered.length}件をCSVエクスポートしました`)
  }

  const toggleStatus = (s: string) =>
    setStatusFilter((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])

  const clearFilters = () => { setLocationFilter(null); setTagFilter(null); setStatusFilter([]); setCustomFieldFilters({}) }

  const contactsWithAddress = useMemo(() =>
    divisionContacts.filter((c) => c.address || (c.custom_attributes?.address as string | undefined)),
  [divisionContacts])

  const handleAutoTag = async () => {
    if (!isSupabaseConfigured()) { toast.error('Supabase未接続'); return }
    setAutoTagRunning(true)
    let updated = 0
    let failed = 0
    try {
      for (const contact of contactsWithAddress) {
        const addr = (contact.address || (contact.custom_attributes?.address as string) || '').toLowerCase()
        const newTags = [...(contact.tags ?? [])]
        let changed = false
        for (const loc of LOCATIONS) {
          const keywords = (autoTagKeywords[loc.id] ?? '')
            .split(',').map((k) => k.trim()).filter(Boolean)
          if (keywords.length === 0) continue
          const matches = keywords.some((k) => addr.includes(k.toLowerCase()))
          if (matches && !newTags.includes(loc.id)) {
            newTags.push(loc.id)
            changed = true
          }
        }
        if (changed) {
          // 1件の失敗（権限のない顧客等）で残りの一括処理を中断しない
          try {
            await updateContact(contact.id, { tags: newTags })
            updated++
          } catch {
            failed++
          }
        }
      }
      if (failed > 0) {
        toast.error(`${failed}件の更新に失敗しました（編集権限のない顧客が含まれている可能性があります）`)
      }
      toast.success(`${updated}件のタグを更新しました`)
      setShowAutoTag(false)
      await loadContacts()
    } catch {
      toast.error('更新に失敗しました')
    } finally {
      setAutoTagRunning(false)
    }
  }

  const activeFilterCount =
    (locationFilter !== null ? 1 : 0) +
    (tagFilter !== null ? 1 : 0) +
    statusFilter.length +
    Object.values(customFieldFilters).filter(Boolean).length

  const currentSortLabel = SORT_OPTIONS.find((o) => o.value === sortKey)?.label ?? ''
  const hasFilter = !!(query || locationFilter !== null || tagFilter !== null || statusFilter.length > 0 || Object.values(customFieldFilters).some(Boolean))
  const noLocationCount = divisionContacts.filter(
    (c) => !LOCATIONS.some((l) => c.tags.includes(l.id))
  ).length

  const locationsByRegion = getLocationsByRegion()

  // 都道府県以外のユニークタグ一覧
  const prefectureSet = new Set<string>(LOCATIONS.map((l) => l.id))
  const otherTags = [...new Set(
    divisionContacts.flatMap((c) => c.tags.filter((t) => !prefectureSet.has(t)))
  )].sort()

  // 一覧の行に出す事業部カスタム区分（select型）の値。M&Aの「売主/買主」のように、
  // 開かないと分からない重要区分を一覧で見えるようにする。
  // 旧データ（custom_attributes）にも項目名でフォールバックする。
  const customBadges = useMemo(() => {
    const map: Record<string, string[]> = {}
    if (selectCustomFields.length === 0) return map
    for (const c of divisionContacts) {
      const vals = selectCustomFields
        .map((f) => {
          const v = listCustomValues[c.id]?.[f.id] ?? c.custom_attributes?.[f.name]
          return typeof v === 'string' ? v : ''
        })
        .filter((v) => v !== '')
      if (vals.length > 0) map[c.id] = vals
    }
    return map
  }, [selectCustomFields, divisionContacts, listCustomValues])

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-800">顧客管理</h1>
          <p className="text-sm text-gray-500">
            {dbLoading ? '読み込み中...' : `${filtered.length}件${hasFilter ? `（全${divisionContacts.length}件中）` : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isOwnDivision && contactsWithAddress.length > 0 && (
            <button
              onClick={() => setShowAutoTag((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border transition-colors',
                showAutoTag
                  ? 'bg-blue-500 border-blue-500 text-white'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              )}
            >
              <MapPin size={15} />
              <span className="hidden sm:inline">住所から拠点を設定</span>
            </button>
          )}
          <button
            onClick={handleExportAll}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors text-gray-600"
            title="表示中の顧客をCSVエクスポート"
          >
            <Download size={15} />
            <span className="hidden sm:inline">CSVエクスポート</span>
          </button>
          {isOwnDivision ? (
            <>
              <Button
                variant="secondary"
                icon={<CreditCard size={16} />}
                onClick={() => router.push('/contacts/new?mode=card')}
              >
                名刺から登録
              </Button>
              <Button
                icon={<Plus size={16} />}
                onClick={() => router.push('/contacts/new?mode=manual')}
              >
                新規顧客
              </Button>
            </>
          ) : (
            <Button icon={<Lock size={16} />} variant="secondary" disabled>
              新規顧客（閲覧のみ）
            </Button>
          )}
        </div>
      </div>

      {/* 他事業部閲覧中バナー */}
      {!isOwnDivision && (
        <div className="flex items-center gap-2 px-4 py-3 mb-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-800">
          <Lock size={15} className="flex-shrink-0 text-yellow-600" />
          <span>
            <strong>{activeDivision?.name}</strong> のデータを閲覧中です。
            編集・追加は担当者のみ可能です。トスアップは引き続きご利用いただけます。
          </span>
        </div>
      )}

      {/* ─── 住所から拠点を自動設定パネル ──────────────────────────── */}
      {showAutoTag && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 mb-4 shadow-sm">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="font-bold text-gray-800 flex items-center gap-2">
                <MapPin size={16} className="text-blue-500" />
                住所から拠点タグを自動設定
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                住所に含まれるキーワードをカンマ区切りで設定してください。一致した顧客に拠点タグが付与されます。
              </p>
            </div>
            <button onClick={() => setShowAutoTag(false)} className="text-gray-400 hover:text-gray-600 p-1">
              <X size={16} />
            </button>
          </div>

          <div className="space-y-3 mb-4">
            {LOCATIONS.map((loc) => (
              <div key={loc.id} className="flex items-center gap-3">
                <span className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold flex-shrink-0 w-16 justify-center', loc.color)}>
                  {loc.label}
                </span>
                <span className="text-gray-400 text-sm flex-shrink-0">→</span>
                <input
                  type="text"
                  value={autoTagKeywords[loc.id] ?? ''}
                  onChange={(e) => setAutoTagKeywords((p) => ({ ...p, [loc.id]: e.target.value }))}
                  placeholder="都道府県をカンマ区切りで（例: 東京都,神奈川県）"
                  className="flex-1 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              住所が登録されている顧客: <strong>{contactsWithAddress.length}件</strong>が対象
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowAutoTag(false)}
                className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleAutoTag}
                disabled={autoTagRunning || contactsWithAddress.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-500 text-white rounded-xl hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {autoTagRunning ? (
                  <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />実行中...</>
                ) : (
                  <><MapPin size={14} />実行</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Toolbar (1行) ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={toggleSelectAll}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
          title={allFilteredSelected ? '選択解除' : '全選択'}
        >
          {allFilteredSelected ? <CheckSquare size={18} className="text-orange-500" /> : <Square size={18} />}
        </button>

        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名前・会社名・メール・役職・電話番号で検索..."
            className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={13} />
            </button>
          )}
        </div>

        {/* フィルターボタン */}
        <button
          onClick={() => setShowFilters((v) => !v)}
          aria-label="絞り込み"
          aria-expanded={showFilters}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition-all flex-shrink-0',
            activeFilterCount > 0
              ? 'bg-orange-500 border-orange-500 text-white shadow-sm'
              : showFilters
                ? 'bg-gray-100 border-gray-300 text-gray-700'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
          )}
        >
          <Filter size={14} />
          <span className="hidden sm:inline">絞り込み</span>
          {activeFilterCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-white text-orange-500 text-[10px] font-bold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
          <ChevronDown size={12} className={cn('transition-transform', showFilters && 'rotate-180')} />
        </button>

        {/* Sort */}
        <div className="relative flex-shrink-0" ref={sortMenuRef}>
          <button
            onClick={() => setShowSortMenu((v) => !v)}
            aria-label={`並び替え: ${currentSortLabel}`}
            aria-expanded={showSortMenu}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors text-gray-600"
          >
            <SlidersHorizontal size={14} />
            <span className="hidden sm:inline text-xs">{currentSortLabel}</span>
            <ChevronDown size={12} className={cn('transition-transform', showSortMenu && 'rotate-180')} />
          </button>
          {showSortMenu && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg min-w-48 py-1">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setSortKey(opt.value); setShowSortMenu(false) }}
                  className={cn('w-full text-left px-4 py-2.5 text-sm transition-colors', sortKey === opt.value ? 'bg-orange-50 text-orange-600 font-medium' : 'text-gray-700 hover:bg-gray-50')}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* View toggle */}
        <div className="flex items-center bg-white border border-gray-200 rounded-xl overflow-hidden flex-shrink-0">
          {([
            { mode: 'list'    as const, Icon: LayoutList,  title: 'リスト表示' },
            { mode: 'card'    as const, Icon: LayoutGrid,   title: 'カード表示' },
            { mode: 'company' as const, Icon: Building2,    title: '会社別表示' },
          ]).map(({ mode, Icon, title }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn('p-2 transition-colors', viewMode === mode ? 'bg-orange-500 text-white' : 'text-gray-500 hover:bg-gray-50')}
              title={title}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
      </div>

      {/* ─── フィルターパネル ─────────────────────────────────────── */}
      {showFilters && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4 shadow-sm space-y-3">
          {/* カスタムフィールド（select型のみ）。事業部固有の区分（M&Aの売主/買主等）は
              最もよく使う絞り込みなので、都道府県より上に置く */}
          {selectCustomFields.map((field) => (
            <div key={field.id} className="flex items-start gap-4">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-1.5 w-14 flex-shrink-0 truncate">{field.label}</span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setCustomFieldFilters((p) => ({ ...p, [field.id]: '' }))}
                  className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors', !customFieldFilters[field.id] ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
                >全て</button>
                {field.options?.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setCustomFieldFilters((p) => ({ ...p, [field.id]: p[field.id] === opt ? '' : opt }))}
                    className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors', customFieldFilters[field.id] === opt ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
                  >{opt}</button>
                ))}
              </div>
            </div>
          ))}

          {/* 都道府県（地方別グループ） */}
          <div className="flex items-start gap-4">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-1.5 w-14 flex-shrink-0">都道府県</span>
            <div className="flex-1 space-y-1.5">
              <button
                onClick={() => setLocationFilter(null)}
                className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors', locationFilter === null ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
              >全て</button>
              {Object.entries(locationsByRegion).map(([region, locs]) => (
                <div key={region} className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-gray-400 w-10 flex-shrink-0 text-right">{region}</span>
                  {locs.map((loc) => (
                    <button
                      key={loc.id}
                      onClick={() => setLocationFilter(locationFilter === loc.id ? null : loc.id)}
                      className={cn('inline-flex items-center gap-0.5 px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors',
                        locationFilter === loc.id ? loc.color + ' ring-2 ring-offset-1 ring-current' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
                    >
                      <MapPin size={9} />{loc.label}
                    </button>
                  ))}
                </div>
              ))}
              {noLocationCount > 0 && (
                <button
                  onClick={() => setLocationFilter(locationFilter === 'none' ? null : 'none')}
                  className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors', locationFilter === 'none' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}
                >拠点なし ({noLocationCount})</button>
              )}
            </div>
          </div>

          {/* その他タグ */}
          {otherTags.length > 0 && (
            <div className="flex items-start gap-4">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-1.5 w-14 flex-shrink-0">タグ</span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setTagFilter(null)}
                  className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors', tagFilter === null ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
                >全て</button>
                {otherTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                    className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors',
                      tagFilter === tag ? 'bg-purple-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
                  >{tag}</button>
                ))}
              </div>
            </div>
          )}

          {/* ステータス */}
          <div className="flex items-start gap-4">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-1.5 w-14 flex-shrink-0">状態</span>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_CONFIG.map(({ status, icon: Icon, label, activeClass }) => {
                const active = statusFilter.includes(status)
                return (
                  <button
                    key={status}
                    onClick={() => toggleStatus(status)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all',
                      active ? 'border-transparent bg-gray-800 text-white shadow-sm' : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
                    )}
                  >
                    <Icon size={11} fill={active ? 'currentColor' : 'none'} className={active ? 'text-white' : activeClass} />
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* フッター */}
          {activeFilterCount > 0 && (
            <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-400">{filtered.length}件が一致</span>
              <button onClick={clearFilters} className="text-xs font-medium text-orange-500 hover:text-orange-700 transition-colors">
                フィルターをクリア
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── アクティブフィルターバッジ（パネル非表示時のみ） ────── */}
      {!showFilters && hasFilter && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {query && (
            <span className="inline-flex items-center gap-1 bg-orange-50 text-orange-700 border border-orange-200 px-2.5 py-1 rounded-full text-xs font-medium">
              「{query}」<button onClick={() => setQuery('')}><X size={10} /></button>
            </span>
          )}
          {locationFilter && (
            <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 border border-gray-200 px-2.5 py-1 rounded-full text-xs font-medium">
              <MapPin size={10} />{locationFilter === 'none' ? '拠点なし' : locationFilter}
              <button onClick={() => setLocationFilter(null)}><X size={10} /></button>
            </span>
          )}
          {tagFilter && (
            <span className="inline-flex items-center gap-1 bg-purple-100 text-purple-700 border border-purple-200 px-2.5 py-1 rounded-full text-xs font-medium">
              #{tagFilter}
              <button onClick={() => setTagFilter(null)}><X size={10} /></button>
            </span>
          )}
          {statusFilter.map((s) => {
            const cfg = STATUS_CONFIG.find((c) => c.status === s)
            return cfg ? (
              <span key={s} className="inline-flex items-center gap-1 bg-gray-800 text-white px-2.5 py-1 rounded-full text-xs font-medium">
                {cfg.label}<button onClick={() => toggleStatus(s)}><X size={10} /></button>
              </span>
            ) : null
          })}
          {Object.entries(customFieldFilters).filter(([, v]) => v).map(([fieldId, val]) => {
            const field = selectCustomFields.find((f) => f.id === fieldId)
            return field ? (
              <span key={fieldId} className="inline-flex items-center gap-1 bg-orange-50 text-orange-700 border border-orange-200 px-2.5 py-1 rounded-full text-xs font-medium">
                {field.label}: {val}
                <button onClick={() => setCustomFieldFilters((p) => ({ ...p, [fieldId]: '' }))}><X size={10} /></button>
              </span>
            ) : null
          })}
          <button onClick={() => { setQuery(''); clearFilters() }} className="text-xs text-gray-400 hover:text-gray-600 ml-1 underline">
            すべてクリア
          </button>
        </div>
      )}

      {/* Content */}
      {filtered.length === 0 ? (
        <EmptyState
          imgSrc="/characters/char-fisher.png"
          title="顧客が見つかりません"
          description={
            divisionContacts.length === 0
              ? 'この事業部にはまだ顧客が登録されていません'
              : hasFilter
                ? '検索条件・フィルターに一致する顧客がいません'
                : '検索条件を変えてみてください'
          }
          action={
            hasFilter ? (
              <Button variant="secondary" size="sm" onClick={() => { setQuery(''); setLocationFilter(null) }}>
                フィルターをクリア
              </Button>
            ) : undefined
          }
        />
      ) : viewMode === 'list' ? (
        <ListView
          contacts={filtered}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onSelect={(id) => router.push(`/contacts/${id}`)}
          isReadOnly={!isOwnDivision}
          contactStatuses={contactStatuses}
          listStatuses={listStatuses}
          dealCounts={dealCounts}
          customBadges={customBadges}
        />
      ) : viewMode === 'company' ? (
        <CompanyView
          contacts={filtered}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onSelect={(id: string) => router.push(`/contacts/${id}`)}
          onViewDetail={(id: string) => router.push(`/contacts/company/${id}`)}
          isReadOnly={!isOwnDivision}
          contactStatuses={contactStatuses}
          listStatuses={listStatuses}
        />
      ) : (
        <CardView
          contacts={filtered}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onSelect={(id) => router.push(`/contacts/${id}`)}
          isReadOnly={!isOwnDivision}
          contactStatuses={contactStatuses}
          listStatuses={listStatuses}
          dealCounts={dealCounts}
          customBadges={customBadges}
        />
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40
          bg-gray-900 text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 whitespace-nowrap">
          <span className="text-sm font-medium">{selectedIds.size}件選択中</span>
          <button
            onClick={handleExportSelected}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
          >
            <Download size={14} />
            CSVエクスポート
          </button>
          {isOwnDivision && (
            <button
              onClick={handleDeleteSelected}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50"
            >
              <Trash2 size={14} />
              {deleting ? '削除中...' : '削除'}
            </button>
          )}
          <button
            onClick={() => setSelectedIds(new Set())}
            className="p-1 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────
type ContactStatusMap = Record<string, ContactStatus[]>

// ─── Status icons ─────────────────────────────────────────────────────────────
function StatusIcons({ contactId, contactStatuses, listStatuses }: { contactId: string; contactStatuses: ContactStatusMap; listStatuses: Record<string, string[]> }) {
  const active = listStatuses[contactId] ?? contactStatuses[contactId] ?? []
  if (active.length === 0) return null
  return (
    <span className="flex items-center gap-0.5 flex-shrink-0">
      {STATUS_CONFIG.filter(({ status }) => active.includes(status)).map(({ status, icon: Icon, label, activeClass }) => (
        <span key={status} title={label} className={activeClass}>
          <Icon size={13} fill="currentColor" />
        </span>
      ))}
    </span>
  )
}

function DealBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      className="inline-flex items-center gap-0.5 flex-shrink-0 text-xs bg-orange-50 text-orange-600 rounded-full px-1.5 py-0.5"
      title={`商談${count}件`}
    >
      <Briefcase size={11} />
      {count}
    </span>
  )
}

// 事業部カスタム区分（M&Aの「売主/買主」等）を一覧の行に出すバッジ
function CustomValueBadges({ values }: { values?: string[] }) {
  if (!values || values.length === 0) return null
  return (
    <>
      {values.map((v, i) => (
        // 複数のカスタム項目で同じ選択肢名が選ばれてもkeyが衝突しないようindexを含める
        <Badge key={`${i}-${v}`} className="flex-shrink-0 bg-sky-50 text-sky-700 border border-sky-200">
          {v}
        </Badge>
      ))}
    </>
  )
}

function AssigneeChip({ userId }: { userId?: string }) {
  if (!userId) return null
  const member = MOCK_TEAM_MEMBERS.find((m) => m.id === userId)
  if (!member) return null
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
      <span className="w-3.5 h-3.5 rounded-full bg-orange-400 text-white flex items-center justify-center text-[8px] font-bold flex-shrink-0">
        {getInitials(member.name)}
      </span>
      {member.name}
    </span>
  )
}

// ─── List View ────────────────────────────────────────────────────────────────
function ListView({
  contacts, selectedIds, onToggleSelect, onSelect, isReadOnly, contactStatuses, listStatuses, dealCounts, customBadges,
}: {
  contacts: Contact[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelect: (id: string) => void
  isReadOnly: boolean
  contactStatuses: ContactStatusMap
  listStatuses: Record<string, string[]>
  dealCounts: Record<string, number>
  customBadges: Record<string, string[]>
}) {
  return (
    <div className="space-y-2">
      {contacts.map((contact) => {
        const selected = selectedIds.has(contact.id)
        return (
          <div
            key={contact.id}
            className={cn(
              'bg-white border rounded-2xl p-4 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200',
              selected ? 'border-orange-300 bg-orange-50/30' : 'border-gray-100'
            )}
          >
            <div className="flex items-center gap-4">
              {/* Checkbox */}
              <button
                onClick={(e) => { e.stopPropagation(); onToggleSelect(contact.id) }}
                className="flex-shrink-0 text-gray-300 hover:text-orange-500 transition-colors"
              >
                {selected
                  ? <CheckSquare size={18} className="text-orange-500" />
                  : <Square size={18} />}
              </button>

              <div
                onClick={() => onSelect(contact.id)}
                className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0',
                  isReadOnly ? 'bg-gray-100 text-gray-500' : 'bg-orange-100 text-orange-600'
                )}
              >
                {getInitials(contact.name)}
              </div>

              <div className="flex-1 min-w-0" onClick={() => onSelect(contact.id)}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-800">{contact.name}</span>
                  <StatusIcons contactId={contact.id} contactStatuses={contactStatuses} listStatuses={listStatuses} />
                  <CustomValueBadges values={customBadges[contact.id]} />
                  <DealBadge count={dealCounts[contact.id] ?? 0} />
                  {isReadOnly && (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                      <Lock size={10} /> 閲覧のみ
                    </span>
                  )}
                  <AssigneeChip userId={contact.assigned_user_id} />
                  {sortTags(contact.tags).map((tag) => (
                    <TagBadge key={tag} tag={tag} />
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                  {contact.companies && (
                    <span className="flex items-center gap-1">
                      <Building2 size={12} />
                      {contact.companies.name}
                    </span>
                  )}
                  {contact.position && <span>{contact.position}</span>}
                  {contact.phone && (
                    <a
                      href={`tel:${contact.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 hover:text-orange-600 transition-colors"
                    >
                      <Phone size={12} />
                      {contact.phone}
                    </a>
                  )}
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 truncate max-w-52 hover:text-orange-600 transition-colors"
                    >
                      <Mail size={12} />
                      {contact.email}
                    </a>
                  )}
                </div>
              </div>

              <div className="text-xs text-gray-400 flex-shrink-0 text-right" onClick={() => onSelect(contact.id)}>
                <div>{formatRelativeTime(contact.updated_at)}</div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Company View ─────────────────────────────────────────────────────────────
function CompanyView({
  contacts, selectedIds, onToggleSelect, onSelect, onViewDetail, isReadOnly, contactStatuses, listStatuses,
}: {
  contacts: Contact[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelect: (id: string) => void
  onViewDetail: (companyId: string) => void
  isReadOnly: boolean
  contactStatuses: ContactStatusMap
  listStatuses: Record<string, string[]>
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; contacts: Contact[] }>()
    for (const c of contacts) {
      const key = c.company_id ?? '__none__'
      const name = c.companies?.name ?? '会社未設定'
      if (!map.has(key)) map.set(key, { id: key, name, contacts: [] })
      map.get(key)!.contacts.push(c)
    }
    return [...map.values()].sort((a, b) => {
      if (a.id === '__none__') return 1
      if (b.id === '__none__') return -1
      return a.name.localeCompare(b.name, 'ja')
    })
  }, [contacts])

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const isOpen = expanded.has(group.id)
        const allSelected = group.contacts.every((c) => selectedIds.has(c.id))
        return (
          <div key={group.id} className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
            {/* 会社ヘッダー行 */}
            <div className="flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors">
              <button
                onClick={(e) => { e.stopPropagation(); group.contacts.forEach((c) => onToggleSelect(c.id)) }}
                className="flex-shrink-0 text-gray-300 hover:text-orange-500 transition-colors"
                title={allSelected ? '全解除' : '全選択'}
              >
                {allSelected
                  ? <CheckSquare size={17} className="text-orange-500" />
                  : <Square size={17} />}
              </button>
              <button
                onClick={() => toggle(group.id)}
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
              >
                <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Building2 size={17} className="text-blue-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800 truncate">{group.name}</p>
                  <p className="text-xs text-gray-400">{group.contacts.length}名</p>
                </div>
              </button>
              {group.id !== '__none__' && (
                <button
                  onClick={(e) => { e.stopPropagation(); onViewDetail(group.id) }}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex-shrink-0"
                >
                  <Info size={13} />
                  <span className="hidden sm:inline">詳細</span>
                </button>
              )}
              <button
                onClick={() => toggle(group.id)}
                className="flex-shrink-0 text-gray-400 hover:text-gray-600"
              >
                <ChevronDown size={15} className={cn('transition-transform', isOpen && 'rotate-180')} />
              </button>
            </div>

            {/* 担当者リスト（展開時） */}
            {isOpen && (
              <div className="border-t border-gray-100 divide-y divide-gray-50">
                {group.contacts.map((contact) => {
                  const selected = selectedIds.has(contact.id)
                  return (
                    <div
                      key={contact.id}
                      className={cn('flex items-center gap-3 pl-4 pr-4 py-3 cursor-pointer hover:bg-orange-50/50 transition-colors', selected && 'bg-orange-50/30')}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleSelect(contact.id) }}
                        className="flex-shrink-0 text-gray-300 hover:text-orange-500 transition-colors"
                      >
                        {selected ? <CheckSquare size={15} className="text-orange-500" /> : <Square size={15} />}
                      </button>
                      <div
                        onClick={() => onSelect(contact.id)}
                        className={cn('w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0',
                          isReadOnly ? 'bg-gray-100 text-gray-500' : 'bg-orange-100 text-orange-600')}
                      >
                        {getInitials(contact.name)}
                      </div>
                      <div className="flex-1 min-w-0" onClick={() => onSelect(contact.id)}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-gray-800">{contact.name}</span>
                          <StatusIcons contactId={contact.id} contactStatuses={contactStatuses} listStatuses={listStatuses} />
                          {contact.position && <span className="text-xs text-gray-500">{contact.position}</span>}
                          {isReadOnly && <span className="inline-flex items-center gap-1 text-xs text-gray-400"><Lock size={9} /> 閲覧のみ</span>}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400 flex-wrap">
                          {contact.phone && (
                            <a href={`tel:${contact.phone}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 hover:text-orange-600">
                              <Phone size={11} />{contact.phone}
                            </a>
                          )}
                          {contact.email && (
                            <a href={`mailto:${contact.email}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 hover:text-orange-600 truncate max-w-48">
                              <Mail size={11} />{contact.email}
                            </a>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-gray-300 flex-shrink-0" onClick={() => onSelect(contact.id)}>
                        {formatRelativeTime(contact.updated_at)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Card View ────────────────────────────────────────────────────────────────
function CardView({
  contacts, selectedIds, onToggleSelect, onSelect, isReadOnly, contactStatuses, listStatuses, dealCounts, customBadges,
}: {
  contacts: Contact[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelect: (id: string) => void
  isReadOnly: boolean
  contactStatuses: ContactStatusMap
  listStatuses: Record<string, string[]>
  dealCounts: Record<string, number>
  customBadges: Record<string, string[]>
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {contacts.map((contact) => {
        const selected = selectedIds.has(contact.id)
        return (
          <div
            key={contact.id}
            onClick={() => onSelect(contact.id)}
            className={cn(
              'bg-white border rounded-2xl p-5 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col relative',
              selected ? 'border-orange-300 bg-orange-50/30' : 'border-gray-100'
            )}
          >
            {/* Checkbox */}
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect(contact.id) }}
              className="absolute top-3 left-3 text-gray-300 hover:text-orange-500 transition-colors"
            >
              {selected
                ? <CheckSquare size={16} className="text-orange-500" />
                : <Square size={16} />}
            </button>

            <div className="flex items-start justify-between mb-3 pl-5">
              <div className={cn(
                'w-12 h-12 rounded-full flex items-center justify-center font-bold text-base',
                isReadOnly ? 'bg-gray-100 text-gray-500' : 'bg-orange-100 text-orange-600'
              )}>
                {getInitials(contact.name)}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  <StatusIcons contactId={contact.id} contactStatuses={contactStatuses} listStatuses={listStatuses} />
                  <CustomValueBadges values={customBadges[contact.id]} />
                  <DealBadge count={dealCounts[contact.id] ?? 0} />
                </div>
                {isReadOnly && (
                  <span className="inline-flex items-center gap-1 text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
                    <Lock size={10} /> 閲覧のみ
                  </span>
                )}
                {sortTags(contact.tags)
                  .filter((t) => LOCATIONS.some((l) => l.id === t))
                  .map((tag) => <LocationBadge key={tag} tag={tag} />)}
              </div>
            </div>

            <div className="mb-2">
              <p className="font-bold text-gray-800 text-sm">{contact.name}</p>
              {contact.position && <p className="text-xs text-gray-500 mt-0.5">{contact.position}</p>}
              {contact.assigned_user_id && (
                <div className="mt-1">
                  <AssigneeChip userId={contact.assigned_user_id} />
                </div>
              )}
            </div>

            {contact.companies && (
              <div className="flex items-center gap-1 text-xs text-gray-500 mb-3">
                <Building2 size={11} className="flex-shrink-0" />
                <span className="truncate">{contact.companies.name}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-1 mb-3">
              {sortTags(contact.tags)
                .filter((t) => !LOCATIONS.some((l) => l.id === t))
                .map((tag) => <TagBadge key={tag} tag={tag} />)}
            </div>

            <div className="mt-auto pt-3 border-t border-gray-100 flex items-center gap-3">
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-orange-600 transition-colors"
                  title={contact.phone}
                >
                  <Phone size={12} />
                  <span className="truncate max-w-24">{contact.phone}</span>
                </a>
              )}
              {contact.email && (
                <a
                  href={`mailto:${contact.email}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-orange-600 transition-colors ml-auto"
                  title={contact.email}
                >
                  <Mail size={12} />
                  <span className="truncate max-w-28">{contact.email}</span>
                </a>
              )}
            </div>
            <div className="text-xs text-gray-300 mt-1 text-right">{formatRelativeTime(contact.updated_at)}</div>
          </div>
        )
      })}
    </div>
  )
}
