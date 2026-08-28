'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, X, Building2 } from 'lucide-react'
import { fetchAllCompanies } from '@/lib/db/companies'
import { cn } from '@/lib/utils'
import type { Company } from '@/types/database'

function normalize(str: string): string {
  return str.toLowerCase().normalize('NFKC').replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60)
  )
}

// グループ会社紐づけ・買手打診リストのどちらも「検索して選んだら即追加」の
// 単発アクションであり、ContactPickerのような永続フィールド（選択後に表示・
// 変更ボタンを出す）ではないため、selectedCompanyId/onClearは持たない
interface CompanyPickerProps {
  onSelect: (companyId: string, company: Company) => void
  label?: string
  disabled?: boolean
  // グループ会社紐づけ・買手打診リストの両方で、自分自身や既に紐づけ済みの
  // 会社を検索候補から除外するために使う（呼び出し元が都度組み立てる）
  excludeIds?: string[]
  placeholder?: string
}

// グループ会社紐づけ・買手打診リストの両方で共通利用するため export する
export function CompanySearchPopup({
  excludeIds,
  onSelect,
  onClose,
}: {
  excludeIds?: string[]
  onSelect: (company: Company) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    setLoading(true)
    fetchAllCompanies().then(setCompanies).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const excludeSet = useMemo(() => new Set(excludeIds ?? []), [excludeIds])

  const candidates = useMemo(() => {
    const base = companies.filter((c) => !excludeSet.has(c.id))
    if (!query.trim()) return base.slice(0, 50)
    const q = normalize(query)
    return base.filter((c) =>
      normalize(c.name).includes(q) ||
      normalize(c.name_kana ?? '').includes(q) ||
      normalize(c.representative ?? '').includes(q)
    )
  }, [query, companies, excludeSet])

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-16 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <Search size={16} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="会社名・フリガナ・代表者名で検索..."
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

        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
          <p className="text-xs text-gray-400">
            {loading ? '読み込み中...' :
              query ? `「${query}」の検索結果 ${candidates.length}件` : `会社 ${candidates.length}件`}
          </p>
        </div>

        <div className="overflow-y-auto max-h-80">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <Building2 size={28} className="mb-2 text-gray-300" />
              <p className="text-sm">一致する会社がありません</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {candidates.map((company) => (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => onSelect(company)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-orange-50 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center flex-shrink-0">
                    <Building2 size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{company.name}</p>
                    {company.representative && (
                      <p className="text-xs text-gray-400 truncate mt-0.5">代表: {company.representative}</p>
                    )}
                  </div>
                  <span className="text-orange-300 text-sm flex-shrink-0">→</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400">クリックで選択 · Esc で閉じる</p>
        </div>
      </div>
    </div>
  )
}

export function CompanyPicker({
  onSelect,
  label,
  disabled,
  excludeIds,
  placeholder = '会社を選択...',
}: CompanyPickerProps) {
  const [open, setOpen] = useState(false)

  const handleSelect = (company: Company) => {
    onSelect(company.id, company)
    setOpen(false)
  }

  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      )}

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
            <Building2 size={14} />
            検索
          </button>
        )}
      </div>

      {open && (
        <CompanySearchPopup
          excludeIds={excludeIds}
          onSelect={handleSelect}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
