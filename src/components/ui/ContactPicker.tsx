'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, X, Users, Building2, Tag, UserCircle } from 'lucide-react'
import { MOCK_CONTACTS } from '@/lib/mock-data'
import { useAppStore } from '@/store/appStore'
import { cn, getInitials } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'

type Contact = typeof MOCK_CONTACTS[0]

interface ContactPickerProps {
  selectedContactId?: string
  onSelect: (contactId: string, contact: Contact) => void
  onClear: () => void
  label?: string
  required?: boolean
  disabled?: boolean
  filterDivisionId?: string   // undefined = 全事業部を検索
  placeholder?: string
}

function normalize(str: string): string {
  return str.toLowerCase().normalize('NFKC').replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60)
  )
}

// ─── 顧客検索ポップアップ本体 ──────────────────────────────────────
function ContactSearchPopup({
  filterDivisionId,
  onSelect,
  onClose,
}: {
  filterDivisionId?: string
  onSelect: (contact: Contact) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // キーボード操作
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const candidates = useMemo(() => {
    const base = filterDivisionId
      ? MOCK_CONTACTS.filter((c) => c.division_id === filterDivisionId)
      : MOCK_CONTACTS
    if (!query.trim()) return base.slice(0, 50)
    const q = normalize(query)
    return base.filter((c) =>
      normalize(c.name).includes(q) ||
      normalize(c.companies?.name ?? '').includes(q) ||
      normalize(c.position ?? '').includes(q) ||
      normalize(c.email ?? '').includes(q)
    )
  }, [query, filterDivisionId])

  return (
    // バックドロップ
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-16 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* 検索ヘッダー */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <Search size={16} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名前・会社名・役職・メールで検索..."
            className="flex-1 text-sm focus:outline-none placeholder-gray-400"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
          <button onClick={onClose}
            className="ml-1 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* 件数サマリー */}
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
          <p className="text-xs text-gray-400">
            {query ? `「${query}」の検索結果 ${candidates.length}件` : `顧客 ${candidates.length}件`}
            {filterDivisionId && ' （現在の事業部）'}
          </p>
        </div>

        {/* 顧客リスト */}
        <div className="overflow-y-auto max-h-80">
          {candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <Users size={28} className="mb-2 text-gray-300" />
              <p className="text-sm">一致する顧客がいません</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {candidates.map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => onSelect(contact)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-orange-50 transition-colors text-left"
                >
                  {/* アバター */}
                  <div className="w-9 h-9 rounded-full bg-orange-100 text-orange-600 font-bold text-sm
                    flex items-center justify-center flex-shrink-0">
                    {getInitials(contact.name)}
                  </div>

                  {/* 情報 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium text-gray-800">{contact.name}</span>
                      {contact.tags?.includes('VIP') && (
                        <Badge variant="orange" className="text-[10px] px-1.5 py-0">VIP</Badge>
                      )}
                      {contact.tags?.includes('キーマン') && (
                        <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium">キーマン</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400 flex-wrap">
                      {contact.companies && (
                        <span className="flex items-center gap-1">
                          <Building2 size={10} />
                          {contact.companies.name}
                        </span>
                      )}
                      {contact.position && (
                        <span className="flex items-center gap-1">
                          <UserCircle size={10} />
                          {contact.position}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 矢印 */}
                  <span className="text-orange-300 text-sm flex-shrink-0">→</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400">クリックで選択 · Esc で閉じる</p>
        </div>
      </div>
    </div>
  )
}

// ─── 公開コンポーネント ────────────────────────────────────────────
export function ContactPicker({
  selectedContactId,
  onSelect,
  onClear,
  label,
  required,
  disabled,
  filterDivisionId,
  placeholder = '顧客を選択...',
}: ContactPickerProps) {
  const [open, setOpen] = useState(false)
  const localContactEdits = useAppStore((s) => s.localContactEdits)

  // localContactEdits があれば名前・会社表示に反映
  const baseContact = MOCK_CONTACTS.find((c) => c.id === selectedContactId)
  const edit = selectedContactId ? localContactEdits[selectedContactId] : undefined
  const selectedContact = baseContact && edit ? { ...baseContact, ...edit } : baseContact

  const handleSelect = (contact: Contact) => {
    onSelect(contact.id, contact)
    setOpen(false)
  }

  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}{required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      {selectedContact ? (
        /* 選択済み表示 */
        <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg">
          <div className="w-6 h-6 rounded-full bg-orange-200 text-orange-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
            {getInitials(selectedContact.name)}
          </div>
          <span className="text-sm font-medium text-orange-700 flex-1 truncate">
            {selectedContact.name}
            {selectedContact.companies && (
              <span className="text-orange-500 font-normal ml-1 text-xs">
                （{selectedContact.companies.name}）
              </span>
            )}
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={onClear}
              className="flex-shrink-0 text-xs text-orange-500 hover:text-orange-700 font-medium
                px-2 py-0.5 rounded hover:bg-orange-100 transition-colors"
            >
              変更
            </button>
          )}
        </div>
      ) : (
        /* 未選択：入力+検索ボタン */
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => !disabled && setOpen(true)}
            className={cn(
              'flex-1 flex items-center gap-2 px-3 py-2 text-sm border rounded-lg text-left transition-all',
              disabled
                ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'border-gray-200 bg-gray-50 text-gray-400 hover:border-orange-400 hover:bg-orange-50 cursor-pointer'
            )}
          >
            <Search size={14} className="flex-shrink-0" />
            <span>{placeholder}</span>
          </button>
          {!disabled && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-orange-500 text-white text-xs font-medium
                rounded-lg hover:bg-orange-600 active:bg-orange-700 transition-colors shadow-sm"
            >
              <Users size={14} />
              検索
            </button>
          )}
        </div>
      )}

      {/* 検索ポップアップ */}
      {open && (
        <ContactSearchPopup
          filterDivisionId={filterDivisionId}
          onSelect={handleSelect}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
