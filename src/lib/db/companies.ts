import { getSupabase } from './client'
import type { Company, Contact } from '@/types/database'

export async function fetchCompanyById(id: string): Promise<Company | null> {
  const { data, error } = await getSupabase()
    .from('companies')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return null
  return {
    ...data,
    corporate_number: data.corporate_number ?? undefined,
    website: data.website ?? undefined,
  } as Company
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
