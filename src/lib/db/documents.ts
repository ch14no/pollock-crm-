import { getSupabase } from './client'
import type { DealDocument, DivisionDocType } from '@/types/database'

// 案件資料（deal_documents）と事業部別カテゴリ（division_document_types）。
// supabase/migrations/013_deal_documents.sql のテーブルを使用する。

// カテゴリ未設定の事業部向けフォールバック（M&A以外の事業部でもすぐ使えるように）
export const DEFAULT_DOC_TYPES: Pick<DivisionDocType, 'name' | 'is_pinned'>[] = [
  { name: '契約書',   is_pinned: false },
  { name: '提案資料', is_pinned: false },
  { name: 'その他',   is_pinned: false },
]

type RawDocument = {
  id: string; deal_id: string; division_id: string
  doc_type: string; name: string; url: string; note: string | null
  created_by: string | null; created_at: string; updated_at: string
  deals: { id: string; title: string } | null
}

function toDocument(r: RawDocument): DealDocument {
  return {
    id: r.id, deal_id: r.deal_id, division_id: r.division_id,
    doc_type: r.doc_type, name: r.name, url: r.url,
    note: r.note ?? undefined, created_by: r.created_by ?? undefined,
    created_at: r.created_at, updated_at: r.updated_at,
    deals: r.deals ?? undefined,
  }
}

export async function fetchDealDocuments(dealId: string): Promise<DealDocument[]> {
  const { data, error } = await getSupabase()
    .from('deal_documents')
    .select('*, deals(id, title)')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(toDocument)
}

// 資料一覧ページ用（事業部単位・案件タイトル付き）
export async function fetchDocumentsByDivision(divisionId: string): Promise<DealDocument[]> {
  const { data, error } = await getSupabase()
    .from('deal_documents')
    .select('*, deals(id, title)')
    .eq('division_id', divisionId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(toDocument)
}

export async function createDealDocument(input: {
  dealId: string; divisionId: string; docType: string
  name: string; url: string; note?: string; createdBy?: string
}): Promise<DealDocument> {
  const { data, error } = await getSupabase()
    .from('deal_documents')
    .insert({
      deal_id: input.dealId, division_id: input.divisionId,
      doc_type: input.docType, name: input.name, url: input.url,
      note: input.note ?? null, created_by: input.createdBy ?? null,
    })
    .select('*, deals(id, title)')
    .single()
  if (error) throw error
  return toDocument(data)
}

export async function updateDealDocument(id: string, updates: {
  docType?: string; name?: string; url?: string; note?: string | null
}): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (updates.docType !== undefined) patch.doc_type = updates.docType
  if (updates.name !== undefined) patch.name = updates.name
  if (updates.url !== undefined) patch.url = updates.url
  if (updates.note !== undefined) patch.note = updates.note
  const { data, error } = await getSupabase()
    .from('deal_documents')
    .update(patch)
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('資料の更新が保存されませんでした（権限がないか、対象が存在しません）')
}

export async function deleteDealDocument(id: string): Promise<void> {
  const { error } = await getSupabase().from('deal_documents').delete().eq('id', id)
  if (error) throw error
}

// ─── 事業部別カテゴリ ─────────────────────────────────────────────

export async function fetchDivisionDocTypes(divisionId: string): Promise<DivisionDocType[]> {
  const { data, error } = await getSupabase()
    .from('division_document_types')
    .select('*')
    .eq('division_id', divisionId)
    .order('sort_order')
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id as string,
    division_id: r.division_id as string,
    name: r.name as string,
    sort_order: (r.sort_order as number) ?? 0,
    is_pinned: (r.is_pinned as boolean) ?? false,
  }))
}

export async function createDivisionDocType(input: {
  divisionId: string; name: string; sortOrder: number; isPinned: boolean
}): Promise<void> {
  const { error } = await getSupabase()
    .from('division_document_types')
    .insert({ division_id: input.divisionId, name: input.name, sort_order: input.sortOrder, is_pinned: input.isPinned })
  if (error) throw error
}

export async function updateDivisionDocType(id: string, updates: { name?: string; sortOrder?: number; isPinned?: boolean }): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (updates.name !== undefined) patch.name = updates.name
  if (updates.sortOrder !== undefined) patch.sort_order = updates.sortOrder
  if (updates.isPinned !== undefined) patch.is_pinned = updates.isPinned
  const { error } = await getSupabase().from('division_document_types').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteDivisionDocType(id: string): Promise<void> {
  const { error } = await getSupabase().from('division_document_types').delete().eq('id', id)
  if (error) throw error
}
