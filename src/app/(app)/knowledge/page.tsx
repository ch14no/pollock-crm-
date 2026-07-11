'use client'

import { useState, useEffect, useMemo } from 'react'
import { Search, X, AlertTriangle, BookOpen, Plus, Globe, Link as LinkIcon } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { KnowledgePostFormModal, type KnowledgePostInput } from '@/components/knowledge/KnowledgePostFormModal'
import { KnowledgePostDetailModal } from '@/components/knowledge/KnowledgePostDetailModal'
import { formatRelativeTime, cn, normalizeForSearch } from '@/lib/utils'
import { useAppStore, selectIsOwnDivision } from '@/store/appStore'
import { isSupabaseConfigured } from '@/lib/db/client'
import {
  fetchKnowledgePosts, createKnowledgePost, updateKnowledgePost, deleteKnowledgePost,
  fetchDivisionKnowledgeCategories, DEFAULT_KNOWLEDGE_CATEGORY_NAMES,
} from '@/lib/db/knowledge'
import type { KnowledgePost } from '@/types/database'
import toast from 'react-hot-toast'

// 一覧カード用にMarkdown記法を粗く取り除いたプレーンテキストを返す
function toExcerpt(markdown: string, maxLen = 120): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')          // コードブロック
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // リンク・画像はラベルのみ残す
    .replace(/^[#>\-*+\s]+/gm, '')             // 見出し・引用・箇条書き記号
    .replace(/[*_`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > maxLen ? `${plain.slice(0, maxLen)}…` : plain
}

export default function KnowledgePage() {
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)

  if (!isSupabaseConfigured()) {
    return (
      <div className="w-full max-w-4xl">
        <h1 className="text-2xl font-black text-gray-800 mb-4">ナレッジ</h1>
        <EmptyState
          icon={<BookOpen size={48} />}
          title="デモモードではナレッジベースは利用できません"
          description="Supabase接続を設定すると、事業部内の知見・研修資料・ニュースを共有できます。"
        />
      </div>
    )
  }

  // 事業部切替でビューごと再マウントし、投稿・検索条件・カテゴリ等の
  // 事業部スコープの状態をまとめてリセットする（手動リセットの漏れ防止）
  return <KnowledgeView key={activeDivisionId ?? 'none'} />
}

function KnowledgeView() {
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const activeDivision   = useAppStore((s) => s.activeDivision)
  const currentUser      = useAppStore((s) => s.currentUser)
  const userOwnDivisionIds = useAppStore((s) => s.userOwnDivisionIds)
  // 非所属事業部の閲覧時は投稿UIを無効化（contacts/dealsページと同じ規約。RLSでも拒否される）
  const isOwnDivision = useAppStore(selectIsOwnDivision)

  const [posts, setPosts] = useState<KnowledgePost[]>([])
  const [categoryNames, setCategoryNames] = useState<string[]>([])
  // 事業部はkey付きマウントで固定なので、取得が走るかどうかは初期値で決まる
  const [loading, setLoading] = useState(Boolean(activeDivisionId))
  const [migrationError, setMigrationError] = useState(false)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editingPost, setEditingPost] = useState<KnowledgePost | null>(null)
  const [detailPostId, setDetailPostId] = useState<string | null>(null)

  // 詳細表示は一覧の投稿から導出する（編集・削除が一覧の更新だけでモーダルにも反映される）
  const detailPost = useMemo(
    () => posts.find((p) => p.id === detailPostId) ?? null,
    [posts, detailPostId]
  )

  useEffect(() => {
    const divId = activeDivisionId
    if (!divId) return
    let cancelled = false
    const load = async () => {
      try {
        const [postsData, cats] = await Promise.all([
          fetchKnowledgePosts(divId),
          fetchDivisionKnowledgeCategories(divId),
        ])
        if (cancelled) return
        setPosts(postsData)
        setCategoryNames(cats.length > 0 ? cats.map((c) => c.name) : DEFAULT_KNOWLEDGE_CATEGORY_NAMES)
        setMigrationError(false)
      } catch {
        if (cancelled) return
        // 018_knowledge_base.sql 未適用（テーブル未作成）を含め、取得失敗時は案内バナー表示
        setPosts([])
        setMigrationError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [activeDivisionId])

  // 検索・抜粋用の派生データは投稿が変わったときだけ再計算する
  const indexedPosts = useMemo(() => posts.map((post) => ({
    post,
    excerpt: toExcerpt(post.body),
    haystack: normalizeForSearch(
      [post.title, post.body, post.category, post.users?.name ?? ''].join('\n')
    ),
  })), [posts])

  // フィルタ候補: 設定済みカテゴリ ＋ 投稿に実在するカテゴリ（削除済みカテゴリの投稿も絞り込めるように）
  const filterCategories = useMemo(() => {
    const set = new Set(categoryNames)
    posts.forEach((p) => set.add(p.category))
    return Array.from(set)
  }, [categoryNames, posts])

  const filtered = useMemo(() => {
    const q = normalizeForSearch(query)
    return indexedPosts.filter(({ post, haystack }) => {
      if (categoryFilter !== 'all' && post.category !== categoryFilter) return false
      if (!q) return true
      return haystack.includes(q)
    })
  }, [indexedPosts, categoryFilter, query])

  const canEditPost = (post: KnowledgePost): boolean => {
    if (!currentUser) return false
    if (currentUser.role === 'super_admin') return true
    if (post.created_by && post.created_by === currentUser.id) return true
    return currentUser.role === 'manager' && userOwnDivisionIds.includes(post.division_id)
  }

  const handleSubmit = async (input: KnowledgePostInput) => {
    if (editingPost) {
      const updated = await updateKnowledgePost(editingPost.id, input)
      setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
      toast.success('ナレッジを更新しました')
    } else {
      if (!activeDivisionId || !currentUser) throw new Error('not ready')
      const created = await createKnowledgePost({
        divisionId: activeDivisionId, createdBy: currentUser.id, ...input,
      })
      setPosts((prev) => [created, ...prev])
      toast.success('ナレッジを投稿しました')
    }
    setEditingPost(null)
  }

  const handleDelete = async (post: KnowledgePost) => {
    if (!window.confirm(`「${post.title}」を削除しますか？この操作は取り消せません。`)) return
    try {
      await deleteKnowledgePost(post.id)
      setPosts((prev) => prev.filter((p) => p.id !== post.id))
      setDetailPostId(null)
      toast.success('削除しました')
    } catch {
      toast.error('削除に失敗しました')
    }
  }

  // 詳細モーダルを閉じてから編集フォームを開く（Modalの多重表示はEscや
  // 背景スクロール制御が競合するため、同時に1枚のみとする）
  const handleEditFromDetail = () => {
    if (!detailPost) return
    setEditingPost(detailPost)
    setDetailPostId(null)
    setFormOpen(true)
  }

  return (
    <div className="w-full max-w-4xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-black text-gray-800">ナレッジ</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {activeDivision?.name}
            {loading ? ' · 読み込み中...' : ` · ${posts.length}件`}
          </p>
        </div>
        <Button
          icon={<Plus size={15} />}
          onClick={() => { setEditingPost(null); setFormOpen(true) }}
          disabled={migrationError || !activeDivisionId || !isOwnDivision}
          title={!isOwnDivision ? '所属していない事業部には投稿できません' : undefined}
        >
          投稿する
        </Button>
      </div>

      {migrationError && (
        <div className="flex items-center gap-2 px-4 py-3 mb-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-800">
          <AlertTriangle size={15} className="flex-shrink-0 text-yellow-600" />
          <span>ナレッジベースのDBテーブルが未適用です（018_knowledge_base.sql）</span>
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
                placeholder="タイトル・本文・投稿者で検索..."
                aria-label="ナレッジを検索"
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

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setCategoryFilter('all')}
                aria-pressed={categoryFilter === 'all'}
                className={cn('px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                  categoryFilter === 'all' ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50')}
              >
                すべて
              </button>
              {filterCategories.map((c) => (
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
          </div>

          {/* 投稿一覧 */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : posts.length === 0 ? (
            <EmptyState
              icon={<BookOpen size={48} />}
              title="まだ投稿がありません"
              description="「投稿する」から事業部の知見・研修資料・ニュースを共有できます。"
            />
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-10">条件に一致する投稿が見つかりません</p>
          ) : (
            <div className="space-y-2">
              {filtered.map(({ post, excerpt }) => {
                const isOtherDivision = post.division_id !== activeDivisionId
                return (
                  <button
                    key={post.id}
                    onClick={() => setDetailPostId(post.id)}
                    className="w-full text-left bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:border-orange-200 hover:shadow transition-all"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="orange" className="flex-shrink-0">{post.category}</Badge>
                      {post.visibility === 'company' && (
                        <Badge variant="info" className="flex-shrink-0 gap-1"><Globe size={11} />全社</Badge>
                      )}
                      {isOtherDivision && post.divisions && (
                        <Badge className="flex-shrink-0 gap-1">
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: post.divisions.color_code ?? '#6b7280' }} />
                          {post.divisions.name}
                        </Badge>
                      )}
                      {post.links.length > 0 && (
                        <span className="flex items-center gap-0.5 text-xs text-gray-400">
                          <LinkIcon size={11} />{post.links.length}
                        </span>
                      )}
                      <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                        {post.users?.name ? `${post.users.name} · ` : ''}{formatRelativeTime(post.updated_at)}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-gray-800 mt-1.5">{post.title}</p>
                    {excerpt && (
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{excerpt}</p>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* 詳細 */}
      {!formOpen && (
        <KnowledgePostDetailModal
          post={detailPost}
          onClose={() => setDetailPostId(null)}
          canEdit={detailPost ? canEditPost(detailPost) : false}
          isOtherDivision={detailPost ? detailPost.division_id !== activeDivisionId : false}
          onEdit={handleEditFromDetail}
          onDelete={() => { if (detailPost) handleDelete(detailPost) }}
        />
      )}

      {/* 新規・編集フォーム（開くたびにマウントし直して初期値を確定させる） */}
      {formOpen && (
        <KnowledgePostFormModal
          onClose={() => { setFormOpen(false); setEditingPost(null) }}
          categories={
            // カテゴリは事業部ごとの分類。他事業部の全社公開投稿を編集するときは
            // 閲覧中事業部のカテゴリを混入させず、投稿の現カテゴリのみ選択可とする
            editingPost && editingPost.division_id !== activeDivisionId
              ? [editingPost.category]
              : categoryNames
          }
          post={editingPost}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}
