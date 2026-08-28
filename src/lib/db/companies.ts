import { getSupabase } from './client'
import type { Company, Contact } from '@/types/database'

// companyGroups.tsからも参照するためexportする（同じ変換ロジックの重複を避ける）
export function toCompany(data: Record<string, unknown>): Company {
  return {
    ...data,
    corporate_number: data.corporate_number ?? undefined,
    website: data.website ?? undefined,
    ir_url: data.ir_url ?? undefined,
    address: data.address ?? undefined,
    phone: data.phone ?? undefined,
    industry: data.industry ?? undefined,
    industry_code: data.industry_code ?? undefined,
    industry_class: data.industry_class ?? undefined,
    business_description: data.business_description ?? undefined,
    representative: data.representative ?? undefined,
    representative2: data.representative2 ?? undefined,
    name_kana: data.name_kana ?? undefined,
    representative_kana: data.representative_kana ?? undefined,
    representative2_kana: data.representative2_kana ?? undefined,
    employee_count: data.employee_count ?? undefined,
    capital: data.capital ?? undefined,
    established_on: data.established_on ?? undefined,
    note: data.note ?? undefined,
  } as Company
}

// companiesからindustry_classesへのFKは industry_code の1本のみのため、
// PGRST201の埋め込み衝突は起きない（bareなembedのままでよい）
const COMPANY_SELECT = '*, industry_class:industry_classes(code, level, parent_code, name, keywords, sort_order)'

export async function fetchCompanyById(id: string): Promise<Company | null> {
  const { data, error } = await getSupabase()
    .from('companies')
    .select(COMPANY_SELECT)
    .eq('id', id)
    .single()
  if (error) {
    // PGRST116 = single()が0行を返した（本当に存在しない）。それ以外（PGRST201の
    // embed衝突・ネットワークエラー等）はnullを返さず投げて、呼び出し元
    // （company/[id]/page.tsx）の「読み込みに失敗しました」表示に回す。
    // ここでnullに握りつぶすと、044未適用等の一時的な取得失敗が
    // 「会社が見つかりません」という紛らわしい表示になってしまう
    if (error.code === 'PGRST116') return null
    throw error
  }
  return toCompany(data)
}

// CompanyPicker（グループ会社・買手候補紐づけ）用に全件取得する。
// ContactPicker（fetchAllContacts）と同じ「全件ロード→クライアントフィルタ」方式
// （companiesは全社マスタで数千件規模までこの方式で問題ない）
export async function fetchAllCompanies(): Promise<Company[]> {
  const { data, error } = await getSupabase()
    .from('companies')
    .select(COMPANY_SELECT)
    .order('name')
    .limit(2000)
  if (error) throw error
  return (data ?? []).map(toCompany)
}

// 会社情報の更新。019適用後はログイン済みの全ユーザーが更新可能
// （companies_updateポリシー。会社は全社共有マスタのため変更は全事業部に反映される）
export async function updateCompany(id: string, updates: {
  name?: string; corporateNumber?: string | null; website?: string | null; irUrl?: string | null
  address?: string | null; phone?: string | null; industry?: string | null
  industryCode?: string | null; businessDescription?: string | null
  representative?: string | null; representative2?: string | null
  nameKana?: string | null; representativeKana?: string | null; representative2Kana?: string | null
  employeeCount?: number | null; capital?: number | null
  establishedOn?: string | null; note?: string | null
}): Promise<Company> {
  const patch: Record<string, unknown> = {}
  if (updates.name !== undefined) patch.name = updates.name
  if (updates.corporateNumber !== undefined) patch.corporate_number = updates.corporateNumber
  if (updates.website !== undefined) patch.website = updates.website
  if (updates.irUrl !== undefined) patch.ir_url = updates.irUrl
  if (updates.address !== undefined) patch.address = updates.address
  if (updates.phone !== undefined) patch.phone = updates.phone
  if (updates.industry !== undefined) patch.industry = updates.industry
  if (updates.industryCode !== undefined) patch.industry_code = updates.industryCode
  if (updates.businessDescription !== undefined) patch.business_description = updates.businessDescription
  if (updates.representative !== undefined) patch.representative = updates.representative
  if (updates.representative2 !== undefined) patch.representative2 = updates.representative2
  if (updates.nameKana !== undefined) patch.name_kana = updates.nameKana
  if (updates.representativeKana !== undefined) patch.representative_kana = updates.representativeKana
  if (updates.representative2Kana !== undefined) patch.representative2_kana = updates.representative2Kana
  if (updates.employeeCount !== undefined) patch.employee_count = updates.employeeCount
  if (updates.capital !== undefined) patch.capital = updates.capital
  if (updates.establishedOn !== undefined) patch.established_on = updates.establishedOn
  if (updates.note !== undefined) patch.note = updates.note
  const { data, error } = await getSupabase()
    .from('companies')
    .update(patch)
    .eq('id', id)
    .select(COMPANY_SELECT)
    .single()
  if (error) throw error
  return toCompany(data)
}

// 会社の削除（043）。全社共有マスタのためmanager/super_adminのみ実行可能
// （RLS側で判定・件数確認込み）。contacts.company_id/tossups.company_idは
// ON DELETE SET NULLのため、紐づく担当者・トスアップは削除されず「会社未設定」になる
export async function deleteCompany(id: string): Promise<void> {
  const { data, error } = await getSupabase().from('companies').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('削除できませんでした（削除権限がないか、対象が存在しません）')
  }
}

export async function fetchContactsByCompany(companyId: string, opts?: { divisionId?: string }): Promise<Contact[]> {
  let query = getSupabase()
    .from('contacts')
    .select('*, users:assigned_user_id(id,name,email,role,created_at)')
    .eq('company_id', companyId)
  if (opts?.divisionId) query = query.eq('division_id', opts.divisionId)
  const { data, error } = await query.order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id as string,
    company_id: (r.company_id as string | null) ?? undefined,
    division_id: r.division_id as string,
    assigned_user_id: (r.assigned_user_id as string | null) ?? undefined,
    name: r.name as string,
    email: (r.email as string | null) ?? undefined,
    phone: (r.phone as string | null) ?? undefined,
    position: (r.position as string | null) ?? undefined,
    address: (r.address as string | null) ?? undefined,
    department: (r.department as string | null) ?? undefined,
    notes: (r.notes as string | null) ?? undefined,
    tags: (r.tags as string[]) ?? [],
    custom_attributes: (r.custom_attributes as Record<string, unknown>) ?? {},
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    users: r.users
      ? {
          ...(r.users as { id: string; name: string; email: string; created_at: string }),
          role: (r.users as { role: string }).role as 'super_admin' | 'manager' | 'user',
        }
      : undefined,
  }))
}

export async function findOrCreateCompany(name: string): Promise<string | null> {
  if (!name.trim()) return null
  const supabase = getSupabase()
  const { data: existing } = await supabase
    .from('companies')
    .select('id')
    .eq('name', name.trim())
    .maybeSingle()
  if (existing) return existing.id
  const { data: created, error } = await supabase
    .from('companies')
    .insert({ name: name.trim() })
    .select('id')
    .single()
  if (error) return null
  return created.id
}
