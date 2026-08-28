'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { Search, X, Briefcase, ChevronRight, ChevronLeft, Check } from 'lucide-react'
import { fetchIndustryClasses } from '@/lib/db/industries'
import { cn } from '@/lib/utils'
import type { IndustryClass } from '@/types/database'

function normalize(str: string): string {
  return str.toLowerCase().normalize('NFKC').replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60)
  )
}

// 「[コード] 名称」表記（酒田さん提供の運用ガイドが推奨する、TSR/帝国データバンクの
// データ突合を意識したコード表記）
function displayLabel(cls: IndustryClass): string {
  return `${cls.code} ${cls.name}`
}

// 選択済みコードから親を辿ってパンくず（大＞中＞小）を組み立てる
function buildBreadcrumb(code: string, byCode: Map<string, IndustryClass>): IndustryClass[] {
  const chain: IndustryClass[] = []
  let cur: IndustryClass | undefined = byCode.get(code)
  while (cur) {
    chain.unshift(cur)
    cur = cur.parent_code ? byCode.get(cur.parent_code) : undefined
  }
  return chain
}

interface IndustryPickerProps {
  selectedCode?: string
  onSelect: (code: string, industryClass: IndustryClass) => void
  onClear: () => void
  label?: string
  disabled?: boolean
}

function IndustrySearchPopup({
  classes, onSelect, onClose,
}: {
  classes: IndustryClass[]
  onSelect: (cls: IndustryClass) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [parentCode, setParentCode] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const byCode = useMemo(() => new Map(classes.map((c) => [c.code, c])), [classes])
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, IndustryClass[]>()
    for (const c of classes) {
      const key = c.parent_code ?? null
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(c)
    }
    for (const list of map.values()) list.sort((a, b) => a.sort_order - b.sort_order)
    return map
  }, [classes])

  // 前方一致（コード）＋部分一致（名称・キーワード）で全階層横断検索。
  // ContactPicker.tsxのnormalize()と同じ正規化ロジック（NFKC＋カナ→かな）
  const searchResults = useMemo(() => {
    if (!query.trim()) return []
    const q = normalize(query)
    return classes.filter((c) =>
      normalize(c.code).startsWith(q) ||
      normalize(c.name).includes(q) ||
      normalize(c.keywords ?? '').includes(q)
    ).slice(0, 100)
  }, [query, classes])

  const currentParent = parentCode ? byCode.get(parentCode) : null
  const drillList = childrenOf.get(parentCode) ?? []
  const showingSearch = query.trim().length > 0

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
            placeholder="コード・業種名で検索（例: 413 出版業）..."
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

        {!showingSearch && (
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100">
            {currentParent ? (
              <button
                onClick={() => setParentCode(currentParent.parent_code ?? null)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-orange-600 transition-colors"
              >
                <ChevronLeft size={13} />
                {displayLabel(currentParent)}
              </button>
            ) : (
              <p className="text-xs text-gray-400">大分類を選択してください</p>
            )}
          </div>
        )}

        <div className="overflow-y-auto max-h-80">
          {showingSearch ? (
            searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <Briefcase size={28} className="mb-2 text-gray-300" />
                <p className="text-sm">一致する業種がありません</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {searchResults.map((cls) => (
                  <button
                    key={cls.code}
                    type="button"
                    onClick={() => onSelect(cls)}
                    className="w-full flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-orange-50 transition-colors text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{displayLabel(cls)}</p>
                      {cls.keywords && <p className="text-xs text-gray-400 truncate mt-0.5">{cls.keywords}</p>}
                    </div>
                    <span className="text-orange-300 text-sm flex-shrink-0">→</span>
                  </button>
                ))}
              </div>
            )
          ) : drillList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <Briefcase size={28} className="mb-2 text-gray-300" />
              <p className="text-sm">業種マスタが未登録です</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {drillList.map((cls) => {
                const hasChildren = (childrenOf.get(cls.code) ?? []).length > 0
                return (
                  <div key={cls.code} className="flex items-center hover:bg-orange-50 transition-colors">
                    <button
                      type="button"
                      onClick={() => onSelect(cls)}
                      className="flex-1 flex items-center gap-2 px-4 py-2.5 text-left min-w-0"
                    >
                      <Check size={13} className="text-gray-300 flex-shrink-0" />
                      <span className="text-sm text-gray-800 truncate">{displayLabel(cls)}</span>
                    </button>
                    {hasChildren && (
                      <button
                        type="button"
                        onClick={() => setParentCode(cls.code)}
                        title="下位の分類を見る"
                        className="flex-shrink-0 p-2.5 text-gray-300 hover:text-orange-500 transition-colors"
                      >
                        <ChevronRight size={16} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400">左のチェックでその分類を確定 · 右の矢印で下位分類へ · Esc で閉じる</p>
        </div>
      </div>
    </div>
  )
}

export function IndustryPicker({ selectedCode, onSelect, onClear, label, disabled }: IndustryPickerProps) {
  const [open, setOpen] = useState(false)
  const [classes, setClasses] = useState<IndustryClass[]>([])

  useEffect(() => {
    fetchIndustryClasses().then(setClasses)
  }, [])

  const byCode = useMemo(() => new Map(classes.map((c) => [c.code, c])), [classes])
  const breadcrumb = selectedCode ? buildBreadcrumb(selectedCode, byCode) : []

  const handleSelect = (cls: IndustryClass) => {
    onSelect(cls.code, cls)
    setOpen(false)
  }

  // 044/045未適用（マスタ0件）かどうかの判断は呼び出し元（CompanyEditModalの
  // industryMasterReady）に任せる。ここで独自にfetchIndustryClasses()を再判定して
  // 自己非表示すると、呼び出し元は「マスタあり」と判断済みなのにこちら側の
  // 別フェッチが一時的に失敗しただけで欄ごと消える不整合が起きうるため

  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      )}

      {breadcrumb.length > 0 ? (
        <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg">
          <Briefcase size={14} className="text-orange-500 flex-shrink-0" />
          <span className="text-sm font-medium text-orange-700 flex-1 truncate">
            {breadcrumb.map((c) => displayLabel(c)).join(' ＞ ')}
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
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen(true)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 text-sm border rounded-lg text-left transition-all',
            disabled
              ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'border-gray-200 bg-gray-50 text-gray-400 hover:border-orange-400 hover:bg-orange-50 cursor-pointer'
          )}
        >
          <Search size={14} className="flex-shrink-0" />
          <span>業種を選択...</span>
        </button>
      )}

      {open && (
        <IndustrySearchPopup classes={classes} onSelect={handleSelect} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}
