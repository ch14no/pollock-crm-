import { getSupabase } from './client'
import { toCompany, COMPANY_SELECT } from './companies'
import type { DealBuyerProspect, NameClearStatus } from '@/types/database'

// 買手打診リスト（047、M&A事業部要望フェーズ2）。
// supabase/migrations/047_deal_buyer_prospects.sql のテーブルを使用する。
// 047未適用の環境では呼び出し側（DealBuyerProspectsSection）がエラーを捕捉してセクションごと隠す。
//
// companiesへのFKは1本のみのためPGRST201の心配はない（companyGroups.tsの2本FKケースとは異なる）
const PROSPECT_SELECT = `id, deal_id, division_id, company_id, note, name_clear, created_by, created_at, updated_at,
  company:companies(${COMPANY_SELECT})`

type RawProspect = {
  id: string; deal_id: string; division_id: string; company_id: string | null
  note: string | null; name_clear: string | null; created_by: string | null
  created_at: string; updated_at: string
  company: Record<string, unknown> | null
}

function toProspect(r: RawProspect): DealBuyerProspect {
  return {
    id: r.id,
    deal_id: r.deal_id,
    division_id: r.division_id,
    company_id: r.company_id ?? undefined,
    note: r.note ?? undefined,
    name_clear: (r.name_clear as NameClearStatus | null) ?? undefined,
    created_by: r.created_by ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
    company: r.company ? toCompany(r.company) : undefined,
  }
}

// 「No」列は連番を持たず、created_at昇順（登録順）の表示位置で決める
export async function fetchDealBuyerProspects(dealId: string): Promise<DealBuyerProspect[]> {
  const { data, error } = await getSupabase()
    .from('deal_buyer_prospects')
    .select(PROSPECT_SELECT)
    .eq('deal_id', dealId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => toProspect(r as unknown as RawProspect))
}

export async function createBuyerProspect(params: {
  dealId: string; divisionId: string; companyId: string; createdBy?: string
}): Promise<void> {
  const { error } = await getSupabase()
    .from('deal_buyer_prospects')
    .insert({
      deal_id: params.dealId,
      division_id: params.divisionId,
      company_id: params.companyId,
      created_by: params.createdBy ?? null,
    })
  if (error) {
    if (error.code === '23505') {
      throw new Error('この会社は既に打診リストに登録されています')
    }
    throw error
  }
}

export async function updateBuyerProspect(id: string, updates: {
  note?: string | null; nameClear?: NameClearStatus | null
}): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (updates.note !== undefined) patch.note = updates.note
  if (updates.nameClear !== undefined) patch.name_clear = updates.nameClear
  // .select()を付けないとRLS拒否の0件更新を検出できない（deleteDeal等で繰り返し学んだ教訓）
  const { data, error } = await getSupabase()
    .from('deal_buyer_prospects')
    .update(patch)
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('保存されませんでした（既に削除されたか、編集権限がありません）')
  }
}

export async function deleteBuyerProspect(id: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from('deal_buyer_prospects')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('削除できませんでした（既に削除されたか、削除権限がありません）')
  }
}
