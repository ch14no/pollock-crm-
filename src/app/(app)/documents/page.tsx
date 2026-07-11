'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, ExternalLink, X, AlertTriangle, FileText } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { formatRelativeTime, cn, matchSearch } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchDocumentsByDivision } from '@/lib/db/documents'
import type { DealDocument } from '@/types/database'

export default function DocumentsPage() {
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const activeDivision   = useAppStore((s) => s.activeDivision)

  const [documents, setDocuments] = useState<DealDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [migrationError, setMigrationError] = useState(false)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  // リクエストの通し番号。事業部切替や連続リロードで古いレスポンスが
  // 後から届いて最新の表示を上書きするのを防ぐ
  const requestSeq = useRef(0)

  const loadDocuments = async () => {
    const divId = activeDivisionId
    if (!divId || !isSupabaseConfigured()) return
    const seq = ++requestSeq.current
    setLoading(true)
    try {
      const data = await fetchDocumentsByDivision(divId)
      if (requestSeq.current !== seq) return // 古いレスポンスは破棄
      setDocuments(data)
      setMigrationError(false)
    } catch {
      if (requestSeq.current !== seq) return
      // 013_deal_documents.sql 未適用（テーブル未作成）を含め、取得失敗時は
      // 画面をクラッシュさせずに案内バナーを表示する
      setDocuments([])
      setMigrationError(true)
    } finally {
      if (requestSeq.current === seq) setLoading(false)
    }
  }

  // 事業部変更時に再取得。前事業部の資料を即座にクリアし、
  // 取得完了までの間に他事業部の資料が新しい一覧へ紛れ込むのを防ぐ
  useEffect(() => {
    setDocuments([])
    setCategoryFilter('all')
    setQuery('') // 前事業部の検索条件が残ると「資料がありません」に見えるためリセット
    loadDocuments()
  }, [activeDivisionId]) // eslint-disable-line

  const categories = useMemo(
    () => Array.from(new Set(documents.map((d) => d.doc_type))).sort((a, b) => a.localeCompare(b, 'ja')),
    [documents]
  )

  const filtered = useMemo(() => documents.filter((d) => {
    if (categoryFilter !== 'all' && d.doc_type !== categoryFilter) return false
    if (!query) return true
    return matchSearch(d.name, query) || matchSearch(d.deals?.title, query) || matchSearch(d.doc_type, query)
  }), [documents, categoryFilter, query])

  if (!isSupabaseConfigured()) {
    return (
      <div className="w-full max-w-4xl">
        <h1 className="text-2xl font-black text-gray-800 mb-4">資料一覧</h1>
        <EmptyState
          icon={<FileText size={48} />}
          title="デモモードでは資料管理は利用できません"
          description="Supabase接続を設定すると、各事業部の案件に紐づく資料リンクを横断的に確認できます。"
        />
      </div>
    )
  }

  return (
    <div className="w-full max-w-4xl">
      <div className="mb-5">
        <h1 className="text-2xl font-black text-gray-800">資料一覧</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {activeDivision?.name}
          {loading ? ' · 読み込み中...' : ` · ${documents.length}件`}
        </p>
      </div>

      {migrationError && (
        <div className="flex items-center gap-2 px-4 py-3 mb-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-800">
          <AlertTriangle size={15} className="flex-shrink-0 text-yellow-600" />
          <span>資料管理のDBテーブルが未適用です（013_deal_documents.sql）</span>
        </div>
      )}

      {!migrationError && (
        <>
          {/* 検索・カテゴリフィルタ */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="資料名・案件名・カテゴリで検索..."
                aria-label="資料を検索"
                className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="検索条件をクリア"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {categories.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setCategoryFilter('all')}
                  aria-pressed={categoryFilter === 'all'}
                  className={cn('px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                    categoryFilter === 'all' ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50')}
                >
                  すべて
                </button>
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategoryFilter(c)}
                    aria-pressed={categoryFilter === c}
                    className={cn('px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                      categoryFilter === c ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50')}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* リスト */}
          {documents.length === 0 ? (
            <EmptyState
              icon={<FileText size={48} />}
              title="資料がありません"
              description="資料リンクは商談の編集画面から登録できます。"
            />
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-10">条件に一致する資料が見つかりません</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((doc) => (
                <div key={doc.id}
                  className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl p-4 shadow-sm"
                >
                  <Badge variant="orange" className="flex-shrink-0">{doc.doc_type}</Badge>
                  <div className="flex-1 min-w-0">
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm font-medium text-gray-800 hover:text-orange-600 hover:underline truncate"
                    >
                      <ExternalLink size={13} className="flex-shrink-0 text-gray-400" />
                      <span className="truncate">{doc.name}</span>
                    </a>
                    {doc.deals?.title && (
                      <p className="text-xs text-gray-400 truncate mt-0.5">{doc.deals.title}</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0">{formatRelativeTime(doc.updated_at)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
