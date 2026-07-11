'use client'

import { useState } from 'react'
import { Plus, Trash2, Link as LinkIcon, Eye, Edit3 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { AutoGrowTextarea } from '@/components/ui/AutoGrowTextarea'
import { MarkdownBody } from '@/components/knowledge/MarkdownBody'
import { cn, isHttpUrl } from '@/lib/utils'
import type { KnowledgePost, KnowledgeLink, KnowledgeVisibility } from '@/types/database'
import toast from 'react-hot-toast'

export interface KnowledgePostInput {
  category: string
  title: string
  body: string
  visibility: KnowledgeVisibility
  links: KnowledgeLink[]
}

interface KnowledgePostFormModalProps {
  onClose: () => void
  /** 選択できるカテゴリ名（事業部設定 or 既定値） */
  categories: string[]
  /** 編集時は既存投稿を渡す。未指定なら新規作成 */
  post?: KnowledgePost | null
  onSubmit: (input: KnowledgePostInput) => Promise<void>
}

// 開くたびに親が条件付きマウントする前提の部品（フォーム初期値はマウント時に確定）
export function KnowledgePostFormModal({ onClose, categories, post, onSubmit }: KnowledgePostFormModalProps) {
  const [title, setTitle] = useState(post?.title ?? '')
  const [category, setCategory] = useState(post?.category ?? categories[0] ?? 'ナレッジ')
  const [visibility, setVisibility] = useState<KnowledgeVisibility>(post?.visibility ?? 'division')
  const [body, setBody] = useState(post?.body ?? '')
  const [links, setLinks] = useState<KnowledgeLink[]>(post?.links ?? [])
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)

  const updateLink = (idx: number, patch: Partial<KnowledgeLink>) => {
    setLinks((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }

  const handleSubmit = async () => {
    if (!title.trim()) { toast.error('タイトルを入力してください'); return }
    if (!category) { toast.error('カテゴリを選択してください'); return }
    const cleanedLinks: KnowledgeLink[] = []
    for (const l of links) {
      const name = l.name.trim(); const url = l.url.trim()
      if (!name && !url) continue // 空行は無視
      if (!name) { toast.error('リンク名が未入力の行があります'); return }
      if (!isHttpUrl(url)) { toast.error(`リンク「${name}」のURLは http(s):// で始まる必要があります`); return }
      cleanedLinks.push({ name, url })
    }
    setSaving(true)
    try {
      await onSubmit({
        category, title: title.trim(), body,
        visibility, links: cleanedLinks,
      })
      onClose()
    } catch {
      toast.error(post ? '更新に失敗しました' : '投稿に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={post ? 'ナレッジを編集' : 'ナレッジを投稿'} size="lg">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">タイトル <span className="text-red-500">*</span></label>
          <input
            type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="例: デューデリジェンスのチェックリスト"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">カテゴリ</label>
            <select
              value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
            >
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              {/* 編集時: 投稿のカテゴリが設定から削除済みでも選択肢に残す */}
              {post && !categories.includes(post.category) && (
                <option value={post.category}>{post.category}</option>
              )}
            </select>
          </div>
          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1">公開範囲</span>
            {/* トグルボタン方式（aria-pressed）。codebaseのフィルタピルと同じ規約 */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {([
                { value: 'division', label: '自事業部のみ' },
                { value: 'company',  label: '全社公開' },
              ] as { value: KnowledgeVisibility; label: string }[]).map(({ value, label }) => (
                <button
                  key={value} type="button" aria-pressed={visibility === value}
                  onClick={() => setVisibility(value)}
                  className={cn('px-3 py-2 text-sm font-medium transition-colors',
                    visibility === value ? 'bg-orange-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-gray-700">本文（Markdown対応）</label>
            <button
              type="button" onClick={() => setPreview((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-orange-600 transition-colors"
            >
              {preview ? <><Edit3 size={12} />編集に戻る</> : <><Eye size={12} />プレビュー</>}
            </button>
          </div>
          {preview ? (
            <div className="min-h-[120px] px-3 py-2 border border-gray-200 rounded-lg bg-gray-50">
              {body.trim()
                ? <MarkdownBody>{body}</MarkdownBody>
                : <p className="text-sm text-gray-400">（本文が空です）</p>}
            </div>
          ) : (
            <AutoGrowTextarea
              value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxHeightPx={480}
              placeholder={'見出しは # 、箇条書きは - で書けます\n\n# 概要\n- ポイント1\n- ポイント2'}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono"
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">添付リンク（Drive・IRページ等のURL）</label>
          <div className="space-y-2">
            {links.map((l, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <LinkIcon size={13} className="flex-shrink-0 text-gray-300" />
                <input
                  type="text" value={l.name} onChange={(e) => updateLink(idx, { name: e.target.value })}
                  placeholder="リンク名" aria-label={`リンク${idx + 1}の名前`}
                  className="w-1/3 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <input
                  type="url" value={l.url} onChange={(e) => updateLink(idx, { url: e.target.value })}
                  placeholder="https://..." aria-label={`リンク${idx + 1}のURL`}
                  className="flex-1 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <button
                  type="button" onClick={() => setLinks((prev) => prev.filter((_, i) => i !== idx))}
                  aria-label={`リンク${idx + 1}を削除`}
                  className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              type="button" onClick={() => setLinks((prev) => [...prev, { name: '', url: '' }])}
              className="flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 transition-colors"
            >
              <Plus size={13} />リンクを追加
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Button variant="ghost" onClick={onClose} disabled={saving}>キャンセル</Button>
          <Button loading={saving} onClick={handleSubmit}>{post ? '更新する' : '投稿する'}</Button>
        </div>
      </div>
    </Modal>
  )
}
