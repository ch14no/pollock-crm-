'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { FileText, ExternalLink, Plus, Trash2 } from 'lucide-react'
import {
  fetchDealDocuments,
  createDealDocument,
  deleteDealDocument,
  fetchDivisionDocTypes,
  DEFAULT_DOC_TYPES,
} from '@/lib/db/documents'
import type { DealDocument, DivisionDocType } from '@/types/database'
import { useAppStore } from '@/store/appStore'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'

interface DealDocumentsSectionProps {
  dealId: string
  divisionId: string
}

// カテゴリ一覧（DBに未設定ならデフォルトへフォールバック）。常設スロット判定に使うため id は空でも可
type DocTypeOption = Pick<DivisionDocType, 'name' | 'is_pinned'>

interface DocumentFormState {
  docType: string
  name: string
  url: string
}

function isHttpUrl(value: string): boolean {
  // モバイルの自動大文字化（HTTPS://...）も有効なURLとして受け付ける
  return /^https?:\/\//i.test(value.trim())
}

export function DealDocumentsSection({ dealId, divisionId }: DealDocumentsSectionProps) {
  const currentUser = useAppStore((s) => s.currentUser)

  const [visible, setVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [documents, setDocuments] = useState<DealDocument[]>([])
  const [docTypes, setDocTypes] = useState<DocTypeOption[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<DocumentFormState>({ docType: '', name: '', url: '' })

  // 連続操作や商談切替時に古いレスポンスが新しい表示を上書きしないよう通し番号で破棄する
  const loadSeq = useRef(0)
  const loadData = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const [docs, types] = await Promise.all([
        fetchDealDocuments(dealId),
        fetchDivisionDocTypes(divisionId),
      ])
      if (loadSeq.current !== seq) return
      setDocuments(docs)
      setDocTypes(types.length > 0 ? types : DEFAULT_DOC_TYPES)
      setVisible(true)
    } catch {
      // 013マイグレーション未適用など。エラーは画面に出さずセクション自体を隠す
      if (loadSeq.current === seq) setVisible(false)
    } finally {
      if (loadSeq.current === seq) setLoaded(true)
    }
  }, [dealId, divisionId])

  useEffect(() => {
    setLoaded(false)
    void loadData()
  }, [loadData])

  const pinnedTypes = useMemo(() => docTypes.filter((t) => t.is_pinned), [docTypes])

  // 常設スロット：カテゴリ名ごとに最新の登録済み資料（複数あれば最新のもの）を対応付ける
  const pinnedSlots = useMemo(() => {
    return pinnedTypes.map((type) => ({
      type,
      document: documents.find((d) => d.doc_type === type.name),
    }))
  }, [pinnedTypes, documents])

  const otherDocuments = useMemo(() => {
    // 常設スロットに「表示されている資料」だけを除外する。カテゴリ名で丸ごと除外すると、
    // 同じ常設カテゴリに2件以上登録された場合に2件目以降がどこにも表示されなくなる
    const shownInSlots = new Set(
      pinnedSlots.map((s) => s.document?.id).filter((id): id is string => !!id)
    )
    return documents
      .filter((d) => !shownInSlots.has(d.id))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [documents, pinnedSlots])

  const openFormWithType = useCallback((docType: string) => {
    setForm({ docType, name: '', url: '' })
    setFormOpen(true)
  }, [])

  const handleToggleForm = useCallback(() => {
    setFormOpen((open) => {
      const next = !open
      if (next) setForm({ docType: docTypes[0]?.name ?? '', name: '', url: '' })
      return next
    })
  }, [docTypes])

  const handleSave = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('資料名を入力してください'); return }
    if (!form.url.trim()) { toast.error('URLを入力してください'); return }
    if (!isHttpUrl(form.url)) { toast.error('URLは http:// または https:// で始めてください'); return }

    setSaving(true)
    try {
      await createDealDocument({
        dealId,
        divisionId,
        docType: form.docType || docTypes[0]?.name || 'その他',
        name: form.name.trim(),
        url: form.url.trim(),
        createdBy: currentUser?.id,
      })
      await loadData()
      setForm({ docType: docTypes[0]?.name ?? '', name: '', url: '' })
      setFormOpen(false)
      toast.success('資料を登録しました')
    } catch {
      toast.error('資料の登録に失敗しました')
    } finally {
      setSaving(false)
    }
  }, [form, dealId, divisionId, currentUser, loadData, docTypes])

  const handleDelete = useCallback(async (doc: DealDocument) => {
    if (!window.confirm(`「${doc.name}」を削除しますか？`)) return
    try {
      await deleteDealDocument(doc.id)
      await loadData()
      toast.success('資料を削除しました')
    } catch {
      toast.error('資料の削除に失敗しました')
    }
  }, [loadData])

  if (!loaded || !visible) return null

  return (
    <div className="pt-2 border-t border-gray-100">
      <div className="flex items-center gap-1.5 mb-2">
        <FileText className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
        <h3 className="text-sm font-medium text-gray-700">資料（Driveリンク）</h3>
      </div>

      {/* 常設スロット */}
      {pinnedSlots.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {pinnedSlots.map(({ type, document }) => (
            <div
              key={type.name}
              className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-orange-100 text-orange-700">
                  {type.name}
                </span>
                {document ? (
                  <a
                    href={document.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${document.name}を新しいタブで開く`}
                    className="flex items-center gap-1 min-w-0 text-gray-700 hover:text-orange-600 truncate"
                  >
                    <span className="truncate">{document.name}</span>
                    <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="text-gray-400">未登録</span>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-1">
                {document ? (
                  <button
                    type="button"
                    onClick={() => handleDelete(document)}
                    aria-label={`${document.name}を削除`}
                    className="p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => openFormWithType(type.name)}
                    aria-label={`${type.name}を追加`}
                    className="flex items-center gap-0.5 px-2 py-1 text-xs font-medium text-orange-600 hover:bg-orange-50 rounded transition-colors"
                  >
                    <Plus className="w-3 h-3" aria-hidden="true" />
                    追加
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 資料リスト（pinned以外） */}
      {otherDocuments.length > 0 && (
        <ul className="space-y-1.5 mb-2">
          {otherDocuments.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-2 px-3 py-2 border border-gray-100 rounded-lg text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-100 text-gray-600">
                  {doc.doc_type}
                </span>
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${doc.name}を新しいタブで開く`}
                  className="flex items-center gap-1 min-w-0 text-gray-700 hover:text-orange-600 truncate"
                >
                  <span className="truncate">{doc.name}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                </a>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(doc)}
                aria-label={`${doc.name}を削除`}
                className="shrink-0 p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 追加フォーム */}
      {formOpen ? (
        <form onSubmit={handleSave} className="space-y-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="deal-doc-type" className="block text-xs font-medium text-gray-600 mb-1">
                カテゴリ
              </label>
              <select
                id="deal-doc-type"
                value={form.docType}
                onChange={(e) => setForm((f) => ({ ...f, docType: e.target.value }))}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg
                  focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
              >
                {docTypes.map((t) => (
                  <option key={t.name} value={t.name}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="deal-doc-name" className="block text-xs font-medium text-gray-600 mb-1">
                資料名 <span className="text-red-500">*</span>
              </label>
              <input
                id="deal-doc-name"
                type="text"
                maxLength={255}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="例: ノンネームシート"
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg
                  focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
              />
            </div>
          </div>
          <div>
            <label htmlFor="deal-doc-url" className="block text-xs font-medium text-gray-600 mb-1">
              URL <span className="text-red-500">*</span>
            </label>
            <input
              id="deal-doc-url"
              type="text"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://drive.google.com/..."
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg
                focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium text-white bg-orange-500 hover:bg-orange-600
                rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存する'}
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={handleToggleForm}
          className={cn(
            'flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700',
            'px-2 py-1.5 rounded-lg hover:bg-orange-50 transition-colors'
          )}
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          資料リンクを追加
        </button>
      )}
    </div>
  )
}
