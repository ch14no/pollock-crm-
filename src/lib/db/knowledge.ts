import { getSupabase } from './client'
import type { KnowledgePost, KnowledgeLink, KnowledgeVisibility, DivisionKnowledgeCategory } from '@/types/database'

// ナレッジベース（knowledge_posts）と事業部別カテゴリ（division_knowledge_categories）。
// supabase/migrations/018_knowledge_base.sql のテーブルを使用する。

// カテゴリ未設定の事業部向けフォールバック（M&A以外の事業部でもすぐ使えるように）
export const DEFAULT_KNOWLEDGE_CATEGORY_NAMES: string[] = ['ナレッジ', '研修資料', 'ニュース']

type RawPost = {
  id: string; division_id: string; category: string
  title: string; body: string; visibility: string
  links: unknown
  created_by: string | null; created_at: string; updated_at: string
  users: { id: string; name: string } | null
  divisions: { id: string; name: string; color_code: string | null } | null
}

function toLinks(raw: unknown): KnowledgeLink[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((l) => {
    if (typeof l !== 'object' || l === null) return []
    const { name, url } = l as { name?: unknown; url?: unknown }
    if (typeof name !== 'string' || typeof url !== 'string') return []
    return [{ name, url }]
  })
}

function toPost(r: RawPost): KnowledgePost {
  return {
    id: r.id, division_id: r.division_id, category: r.category,
    title: r.title, body: r.body,
    visibility: r.visibility === 'company' ? 'company' : 'division',
    links: toLinks(r.links),
    created_by: r.created_by ?? undefined,
    created_at: r.created_at, updated_at: r.updated_at,
    users: r.users ?? undefined,
    divisions: r.divisions
      ? { id: r.divisions.id, name: r.divisions.name, color_code: r.divisions.color_code ?? undefined }
      : undefined,
  }
}

// ナレッジ一覧: 自事業部の投稿 ＋ 他事業部の全社公開投稿（RLSでも同条件を強制）。
// 本文込みで全件取得するため、他のfetch系と同様に上限を設ける
export async function fetchKnowledgePosts(divisionId: string): Promise<KnowledgePost[]> {
  const { data, error } = await getSupabase()
    .from('knowledge_posts')
    .select('*, users:created_by(id, name), divisions:division_id(id, name, color_code)')
    .or(`division_id.eq.${divisionId},visibility.eq.company`)
    .order('updated_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return (data ?? []).map(toPost)
}

export async function createKnowledgePost(input: {
  divisionId: string; category: string; title: string; body: string
  visibility: KnowledgeVisibility; links: KnowledgeLink[]; createdBy: string
}): Promise<KnowledgePost> {
  const { data, error } = await getSupabase()
    .from('knowledge_posts')
    .insert({
      division_id: input.divisionId, category: input.category,
      title: input.title, body: input.body,
      visibility: input.visibility, links: input.links,
      created_by: input.createdBy,
    })
    .select('*, users:created_by(id, name), divisions:division_id(id, name, color_code)')
    .single()
  if (error) throw error
  return toPost(data)
}

export async function updateKnowledgePost(id: string, updates: {
  category?: string; title?: string; body?: string
  visibility?: KnowledgeVisibility; links?: KnowledgeLink[]
}): Promise<KnowledgePost> {
  const patch: Record<string, unknown> = {}
  if (updates.category !== undefined) patch.category = updates.category
  if (updates.title !== undefined) patch.title = updates.title
  if (updates.body !== undefined) patch.body = updates.body
  if (updates.visibility !== undefined) patch.visibility = updates.visibility
  if (updates.links !== undefined) patch.links = updates.links
  const { data, error } = await getSupabase()
    .from('knowledge_posts')
    .update(patch)
    .eq('id', id)
    .select('*, users:created_by(id, name), divisions:division_id(id, name, color_code)')
    .single()
  if (error) throw error
  return toPost(data)
}

export async function deleteKnowledgePost(id: string): Promise<void> {
  const { error } = await getSupabase().from('knowledge_posts').delete().eq('id', id)
  if (error) throw error
}

// ─── 事業部別カテゴリ ─────────────────────────────────────────────

export async function fetchDivisionKnowledgeCategories(divisionId: string): Promise<DivisionKnowledgeCategory[]> {
  const { data, error } = await getSupabase()
    .from('division_knowledge_categories')
    .select('*')
    .eq('division_id', divisionId)
    .order('sort_order')
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id as string,
    division_id: r.division_id as string,
    name: r.name as string,
    sort_order: (r.sort_order as number) ?? 0,
  }))
}

export async function createDivisionKnowledgeCategory(input: {
  divisionId: string; name: string; sortOrder: number
}): Promise<void> {
  const { error } = await getSupabase()
    .from('division_knowledge_categories')
    .insert({ division_id: input.divisionId, name: input.name, sort_order: input.sortOrder })
  if (error) throw error
}

export async function deleteDivisionKnowledgeCategory(id: string): Promise<void> {
  const { error } = await getSupabase().from('division_knowledge_categories').delete().eq('id', id)
  if (error) throw error
}
