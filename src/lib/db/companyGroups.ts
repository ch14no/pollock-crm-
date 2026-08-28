import { getSupabase } from './client'
import { toCompany } from './companies'
import type { CompanyGroupLink } from '@/types/database'

// company_group_links は companies への FK を2本持つ（company_id / related_company_id）。
// bareな`companies(...)`埋め込みのままだとPostgRESTが埋め込み先を一意に決められず
// PGRST201になる（2026-08-20にdeals→contactsの2本FKで全事業部の商談取得が全滅した
// 実例あり）。制約名を明示して回避する（列名の後ろにPostgresのデフォルト命名規則
// `<table>_<column>_fkey`が付く。046のマイグレーションで明示的なCONSTRAINT名を
// 指定していないため、この規則通りの名前になっている点に注意）
const GROUP_LINK_SELECT = `
  id, company_id, related_company_id, note, created_at,
  company:companies!company_group_links_company_id_fkey(*),
  related:companies!company_group_links_related_company_id_fkey(*)
`

// 呼び出し元companyIdの視点で「相手会社」を正規化して返す（無向ペアのため
// company_id側・related_company_id側のどちらに自分がいるかを都度判定する）
export async function fetchCompanyGroupLinks(companyId: string): Promise<CompanyGroupLink[]> {
  const { data, error } = await getSupabase()
    .from('company_group_links')
    .select(GROUP_LINK_SELECT)
    .or(`company_id.eq.${companyId},related_company_id.eq.${companyId}`)
    .order('created_at')
  if (error) throw error
  return (data ?? []).map((row) => {
    const raw = row as unknown as {
      id: string; company_id: string; related_company_id: string
      note: string | null; created_at: string
      company: Record<string, unknown>; related: Record<string, unknown>
    }
    const isCompanySide = raw.company_id === companyId
    const relatedRaw = isCompanySide ? raw.related : raw.company
    return {
      id: raw.id,
      companyId,
      relatedCompany: toCompany(relatedRaw),
      note: raw.note ?? undefined,
      createdAt: raw.created_at,
    }
  })
}

export async function addCompanyGroupLink(companyId: string, relatedCompanyId: string, note?: string): Promise<void> {
  const { error } = await getSupabase()
    .from('company_group_links')
    .insert({ company_id: companyId, related_company_id: relatedCompanyId, note: note || null })
  if (error) throw error
}

export async function deleteCompanyGroupLink(id: string): Promise<void> {
  const { data, error } = await getSupabase().from('company_group_links').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('削除できませんでした（権限がないか、対象が存在しません）')
  }
}
