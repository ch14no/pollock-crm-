'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Plus, Building2, Phone, Mail,
  LayoutList, LayoutGrid, ChevronDown, MapPin, SlidersHorizontal, Lock, CreditCard, X,
  Trash2, Download, CheckSquare, Square,
} from 'lucide-react'
import { MOCK_CONTACTS, MOCK_TEAM_MEMBERS } from '@/lib/mock-data'
import { LOCATIONS, getLocationConfig, sortTags } from '@/lib/config'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatRelativeTime, getInitials, cn } from '@/lib/utils'
import { useAppStore, selectIsOwnDivision } from '@/store/appStore'
import type { ContactStatus } from '@/store/appStore'
import { STATUS_CONFIG } from '@/lib/contactStatus'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchContactsByDivision, deleteContacts } from '@/lib/db/contacts'
import type { Contact } from '@/types/database'
import toast from 'react-hot-toast'

type ViewMode = 'list' | 'card'
type SortKey = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc' | 'company_asc'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'updated_desc', label: '最終更新（新しい順）' },
  { value: 'updated_asc',  label: '最終更新（古い順）' },
  { value: 'name_asc',     label: '氏名（昇順）' },
  { value: 'name_desc',    label: '氏名（降順）' },
  { value: 'company_asc',  label: '会社名（昇順）' },
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
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
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
  const activeDivisionId  = useAppStore((s) => s.activeDivisionId)
  const activeDivision    = useAppStore((s) => s.activeDivision)
  const isOwnDivision     = useAppStore(selectIsOwnDivision)
  const contactStatuses   = useAppStore((s) => s.contactStatuses)
  const localContactEdits = useAppStore((s) => s.localContactEdits)

  const [dbContacts, setDbContacts] = useState<Contact[]>([])
  const [dbLoading, setDbLoading] = useState(false)
  const [query, setQuery]               = useState('')
  const [sortKey, setSortKey]           = useState<SortKey>('updated_desc')
  const [viewMode, setViewMode]         = useState<ViewMode>('list')
  const [locationFilter, setLocationFilter] = useState<string | null>(null)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [deleting, setDeleting]         = useState(false)
  const sortMenuRef = useRef<HTMLDivElement>(null)

  const loadContacts = useCallback(async () => {
    if (!activeDivisionId || !isSupabaseConfigured()) return
    setDbLoading(true)
    try {
      const data = await fetchContactsByDivision(activeDivisionId)
      setDbContacts(data)
    } finally {
      setDbLoading(false)
    }
  }, [activeDivisionId])

  useEffect(() => {
    loadContacts()
    setSelectedIds(new Set())
  }, [loadContacts])

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

      return matchQuery && matchLocation
    })

    result = [...result].sort((a, b) => {
      switch (sortKey) {
        case 'updated_desc': return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        case 'updated_asc':  return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
        case 'name_asc':     return a.name.localeCompare(b.name, 'ja')
        case 'name_desc':    return b.name.localeCompare(a.name, 'ja')
        case 'company_asc':  return (a.companies?.name ?? '').localeCompare(b.companies?.name ?? '', 'ja')
        default: return 0
      }
    })
    return result
  }, [divisionContacts, query, sortKey, locationFilter])

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

  const currentSortLabel = SORT_OPTIONS.find((o) => o.value === sortKey)?.label ?? ''
  const hasFilter = query || locationFilter !== null
  const noLocationCount = divisionContacts.filter(
    (c) => !LOCATIONS.some((l) => c.tags.includes(l.id))
  ).length

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

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {/* 全選択チェックボックス */}
        <button
          onClick={toggleSelectAll}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
          title={allFilteredSelected ? '選択解除' : '全選択'}
        >
          {allFilteredSelected ? <CheckSquare size={18} className="text-orange-500" /> : <Square size={18} />}
        </button>

        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名前・会社名・メール・役職・電話番号で検索..."
            className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-gray-200 rounded-xl
              focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Location filter */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setLocationFilter(null)}
            className={cn(
              'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
              locationFilter === null
                ? 'bg-orange-500 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            )}
          >
            全拠点
          </button>
          {LOCATIONS.map((loc) => (
            <button
              key={loc.id}
              onClick={() => setLocationFilter(locationFilter === loc.id ? null : loc.id)}
              className={cn(
                'inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                locationFilter === loc.id
                  ? loc.color + ' ring-2 ring-offset-1 ring-current'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              )}
            >
              <MapPin size={12} />
              {loc.label}
            </button>
          ))}
          {noLocationCount > 0 && (
            <button
              onClick={() => setLocationFilter(locationFilter === 'none' ? null : 'none')}
              className={cn(
                'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                locationFilter === 'none'
                  ? 'bg-gray-700 text-white'
                  : 'bg-white text-gray-500 border border-dashed border-gray-300 hover:bg-gray-50'
              )}
            >
              拠点なし ({noLocationCount})
            </button>
          )}
        </div>

        {/* Sort */}
        <div className="relative" ref={sortMenuRef}>
          <button
            onClick={() => setShowSortMenu((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl
              hover:bg-gray-50 transition-colors text-gray-600"
          >
            <SlidersHorizontal size={14} />
            <span className="hidden sm:inline">{currentSortLabel}</span>
            <ChevronDown size={12} className={cn('transition-transform', showSortMenu && 'rotate-180')} />
          </button>
          {showSortMenu && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg min-w-48 py-1">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setSortKey(opt.value); setShowSortMenu(false) }}
                  className={cn(
                    'w-full text-left px-4 py-2.5 text-sm transition-colors',
                    sortKey === opt.value
                      ? 'bg-orange-50 text-orange-600 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* View toggle */}
        <div className="flex items-center bg-white border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'p-2 transition-colors',
              viewMode === 'list' ? 'bg-orange-500 text-white' : 'text-gray-500 hover:bg-gray-50'
            )}
            title="リスト表示"
          >
            <LayoutList size={16} />
          </button>
          <button
            onClick={() => setViewMode('card')}
            className={cn(
              'p-2 transition-colors',
              viewMode === 'card' ? 'bg-orange-500 text-white' : 'text-gray-500 hover:bg-gray-50'
            )}
            title="カード表示"
          >
            <LayoutGrid size={16} />
          </button>
        </div>
      </div>

      {/* Active filters summary */}
      {hasFilter && (
        <div className="flex items-center gap-2 mb-3 text-xs text-gray-500">
          <span>フィルター中:</span>
          {query && (
            <span className="flex items-center gap-1 bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
              「{query}」
              <button onClick={() => setQuery('')}><X size={10} /></button>
            </span>
          )}
          {locationFilter && (
            <span className="flex items-center gap-1 bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
              {locationFilter === 'none' ? '拠点なし' : locationFilter}
              <button onClick={() => setLocationFilter(null)}><X size={10} /></button>
            </span>
          )}
          <button onClick={() => { setQuery(''); setLocationFilter(null) }} className="text-gray-400 hover:text-gray-600 ml-1">
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
        />
      ) : (
        <CardView
          contacts={filtered}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onSelect={(id) => router.push(`/contacts/${id}`)}
          isReadOnly={!isOwnDivision}
          contactStatuses={contactStatuses}
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
function StatusIcons({ contactId, contactStatuses }: { contactId: string; contactStatuses: ContactStatusMap }) {
  const active = contactStatuses[contactId] ?? []
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
  contacts, selectedIds, onToggleSelect, onSelect, isReadOnly, contactStatuses,
}: {
  contacts: Contact[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelect: (id: string) => void
  isReadOnly: boolean
  contactStatuses: ContactStatusMap
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
                  <StatusIcons contactId={contact.id} contactStatuses={contactStatuses} />
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

// ─── Card View ────────────────────────────────────────────────────────────────
function CardView({
  contacts, selectedIds, onToggleSelect, onSelect, isReadOnly, contactStatuses,
}: {
  contacts: Contact[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelect: (id: string) => void
  isReadOnly: boolean
  contactStatuses: ContactStatusMap
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
                <StatusIcons contactId={contact.id} contactStatuses={contactStatuses} />
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
