import { getSupabase } from './client'
import type { Company, Contact } from '@/types/database'

function toCompany(data: Record<string, unknown>): Company {
  return {
    ...data,
    corporate_number: data.corporate_number ?? undefined,
    website: data.website ?? undefined,
    ir_url: data.ir_url ?? undefined,
    address: data.address ?? undefined,
    phone: data.phone ?? undefined,
    industry: data.industry ?? undefined,
    representative: data.representative ?? undefined,
    employee_count: data.employee_count ?? undefined,
    capital: data.capital ?? undefined,
    established_on: data.established_on ?? undefined,
    note: data.note ?? undefined,
  } as Company
}

export async function fetchCompanyById(id: string): Promise<Company | null> {
  const { data, error } = await getSupabase()
    .from('companies')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return null
  return toCompany(data)
}

// 会社情報の更新。019適用後はログイン済みの全ユーザーが更新可能
// （companies_updateポリシー。会社は全社共有マスタのため変更は全事業部に反映される）
export async function updateCompany(id: string, updates: {
  name?: string; corporateNumber?: string | null; website?: string | null; irUrl?: string | null
  address?: string | null; phone?: string | null; industry?: string | null
  representative?: string | null; employeeCount?: number | null; capital?: number | null
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
  if (updates.representative !== undefined) patch.representative = updates.representative
  if (updates.employeeCount !== undefined) patch.employee_count = updates.employeeCount
  if (updates.capital !== undefined) patch.capital = updates.capital
  if (updates.establishedOn !== undefined) patch.established_on = updates.establishedOn
  if (updates.note !== undefined) patch.note = updates.note
  const { data, error } = await getSupabase()
    .from('companies')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return toCompany(data)
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
