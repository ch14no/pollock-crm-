'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, X, Building2 } from 'lucide-react'
import { searchTsrProspects, type TsrProspect } from '@/lib/db/tsrProspects'
import { cn, formatErrorDetail } from '@/lib/utils'

const PAGE_SIZE = 30

// 「顧客」（ソーシング一覧＝tsr_prospects。TSR 46万社＋手動登録）から会社を選ぶ検索ポップアップ。
// 買手打診リストの追加に使う。旧 CompanyPicker（companies 全件＋担当者のいる会社だけに絞る）は
// M&A 事業部が「顧客」を会社単位の一覧に統合したため、買手候補の入口としては廃止した。
// 46万社をクライアントに持てないので、検索は /sourcing と同じ tsr_search RPC でサーバー側に任せる
interface ProspectSearchPopupProps {
  divisionId: string
  // 既に打診リストに入っている会社（companies.id）。候補には出すが「追加済み」として選べなくする
  excludeCompanyIds: string[]
  // 呼び出し元が会社行の用意（未登録なら promote）と追加まで行う。失敗時は例外を投げればポップアップは開いたまま
  onSelect: (prospect: TsrProspect) => Promise<void>
  onClose: () => void
}

function ProspectSearchPopup({ divisionId, excludeCompanyIds, onSelect, onClose }: ProspectSearchPopupProps) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<TsrProspect[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectingCode, setSelectingCode] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !selectingCode) onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, selectingCode])

  useEffect(() => {
    const mySeq = ++seq.current
    const t = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await searchTsrProspects(divisionId, { query: query.trim() || undefined }, { page: 0, pageSize: PAGE_SIZE, skipCount: true })
        if (seq.current !== mySeq) return
        setRows(res.rows)
        setHasMore(res.hasMore)
      } catch (e) {
        if (seq.current !== mySeq) return
        console.error('prospect search failed', e)
        setRows([])
        setError(formatErrorDetail(e))
      } finally {
        if (seq.current === mySeq) setLoading(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [divisionId, query])

  const excludeSet = new Set(excludeCompanyIds)

  const handleSelect = async (p: TsrProspect) => {
    if (selectingCode) return
    setSelectingCode(p.tsr_code)
    try {
      await onSelect(p)
    } catch (e) {
      // 利用者向けの表示（toast）は onSelect 側の責務。ここでは記録して選択中状態を解く
      console.error('prospect select failed', e)
    } finally {
      setSelectingCode(null)
    }
  }

  const countLabel = (() => {
    if (loading) return '検索中...'
    if (error) return ''
    // 件数は数えない（skipCount）。続きがあるときは上位だけ出していることを伝える
    if (hasMore) return `上位${rows.length}件を表示中。社名などで絞り込んでください`
    return query.trim() ? `「${query.trim()}」の検索結果 ${rows.length}件` : `顧客 ${rows.length}件`
  })()

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-16 px-4"
      onClick={(e) => e.target === e.currentTarget && !selectingCode && onClose()}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !selectingCode && onClose()} />
      <div role="dialog" aria-modal="true" aria-label="顧客から買手候補を検索"
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <Search size={16} className="text-gray-400 flex-shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="会社名・フリガナ・電話番号・企業コードで検索..."
            aria-label="顧客を検索"
            className="flex-1 text-sm focus:outline-none placeholder-gray-400"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="検索語を消去"
              className="text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
          <button type="button" onClick={onClose} disabled={!!selectingCode} aria-label="閉じる"
            className="ml-1 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
          <p className="text-xs text-gray-400" aria-live="polite">{countLabel}</p>
        </div>

        <div className="overflow-y-auto max-h-80">
          {loading && rows.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-red-500">顧客の検索に失敗しました</p>
              <p className="text-[11px] text-gray-400 mt-1 break-all">{error}</p>
              <p className="text-[11px] text-gray-400 mt-1">時間を置いてもう一度お試しください</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 px-4 text-gray-400">
              <Building2 size={28} className="mb-2 text-gray-300" aria-hidden="true" />
              <p className="text-sm">一致する顧客がありません</p>
              <p className="text-[11px] mt-1 text-center">一覧に無い会社は「顧客」画面の「会社を追加」から登録してください</p>
            </div>
          ) : (
            <div className={cn('divide-y divide-gray-50', loading && 'opacity-60')}>
              {rows.map((p) => {
                const added = !!p.company_id && excludeSet.has(p.company_id)
                const selecting = selectingCode === p.tsr_code
                const sub = [p.prefecture, p.rep_name && `代表: ${p.rep_name}`, p.industry1_name].filter(Boolean).join(' · ')
                return (
                  <button
                    key={p.tsr_code}
                    type="button"
                    disabled={added || !!selectingCode}
                    onClick={() => handleSelect(p)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-orange-50 transition-colors text-left
                      disabled:hover:bg-transparent disabled:cursor-not-allowed"
                  >
                    <div className={cn(
                      'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                      added ? 'bg-gray-100 text-gray-300' : 'bg-orange-100 text-orange-600'
                    )}>
                      <Building2 size={16} aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-sm font-medium truncate', added ? 'text-gray-400' : 'text-gray-800')}>
                        {p.name}
                        {p.source === 'manual' && (
                          <span className="ml-1.5 text-[10px] font-normal text-gray-400 border border-gray-200 rounded px-1">手動登録</span>
                        )}
                      </p>
                      {sub && <p className="text-xs text-gray-400 truncate mt-0.5">{sub}</p>}
                    </div>
                    <span className="text-xs flex-shrink-0">
                      {added ? <span className="text-gray-400">追加済み</span>
                        : selecting ? <span className="text-orange-500">追加中...</span>
                        : <span className="text-orange-300 text-sm">→</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400">クリックで追加 · Esc で閉じる</p>
        </div>
      </div>
    </div>
  )
}

interface ProspectPickerProps extends Omit<ProspectSearchPopupProps, 'onClose'> {
  placeholder?: string
}

export function ProspectPicker({ placeholder = '顧客から検索...', onSelect, ...rest }: ProspectPickerProps) {
  const [open, setOpen] = useState(false)

  // onSelect が例外を投げなければ追加成功とみなしてポップアップを閉じる
  const handleSelect = async (p: TsrProspect) => {
    await onSelect(p)
    setOpen(false)
  }

  return (
    <div>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex-1 flex items-center gap-2 px-3 py-2 text-sm border rounded-lg text-left transition-all
            border-gray-200 bg-gray-50 text-gray-400 hover:border-orange-400 hover:bg-orange-50 cursor-pointer"
        >
          <Search size={14} className="flex-shrink-0" aria-hidden="true" />
          <span>{placeholder}</span>
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-orange-500 text-white text-xs font-medium
            rounded-lg hover:bg-orange-600 active:bg-orange-700 transition-colors shadow-sm"
        >
          <Building2 size={14} aria-hidden="true" />
          検索
        </button>
      </div>

      {open && (
        <ProspectSearchPopup {...rest} onSelect={handleSelect} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}
