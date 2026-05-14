import { getSupabase } from './client'
import type { Contact } from '@/types/database'

type RawContact = {
  id: string; company_id: string | null; division_id: string; assigned_user_id: string | null
  name: string; email: string | null; phone: string | null; position: string | null
  tags: string[]; custom_attributes: Record<string, unknown>; notes: string | null
  created_at: string; updated_at: string
  companies: { id: string; name: string; website: string | null; corporate_number: string | null; created_at: string; updated_at: string } | null
  users: { id: string; name: string; email: string; role: string; created_at: string } | null
}

function toContact(r: RawContact): Contact {
  return {
    id: r.id, company_id: r.company_id ?? undefined, division_id: r.division_id,
    assigned_user_id: r.assigned_user_id ?? undefined,
    name: r.name, email: r.email ?? undefined, phone: r.phone ?? undefined,
    position: r.position ?? undefined, tags: r.tags ?? [], custom_attributes: r.custom_attributes ?? {},
    created_at: r.created_at, updated_at: r.updated_at,
    companies: r.companies ? {
      ...r.companies,
      corporate_number: r.companies.corporate_number ?? undefined,
      website: r.companies.website ?? undefined,
    } : undefined,
    users: r.users ? { ...r.users, role: r.users.role as 'super_admin' | 'manager' | 'user' } : undefined,
  }
}

export async function fetchContactsByDivision(divisionId: string): Promise<Contact[]> {
  const { data, error } = await getSupabase()
    .from('contacts')
    .select('*, companies(*), users:assigned_user_id(id,name,email,role,created_at)')
    .eq('division_id', divisionId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(toContact)
}

export async function fetchContactById(id: string): Promise<Contact | null> {
  const { data, error } = await getSupabase()
    .from('contacts')
    .select('*, companies(*), users:assigned_user_id(id,name,email,role,created_at)')
    .eq('id', id)
    .single()
  if (error) return null
  return toContact(data)
}

export async function createContact(input: {
  divisionId: string; assignedUserId?: string; companyId?: string
  name: string; email?: string; phone?: string; position?: string
  tags?: string[]; customAttributes?: Record<string, unknown>
}): Promise<Contact> {
  const { data, error } = await getSupabase()
    .from('contacts')
    .insert({
      division_id: input.divisionId,
      assigned_user_id: input.assignedUserId ?? null,
      company_id: input.companyId ?? null,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      position: input.position ?? null,
      tags: input.tags ?? [],
      custom_attributes: input.customAttributes ?? {},
    })
    .select('*, companies(*)')
    .single()
  if (error) throw error
  return toContact(data)
}

export async function updateContact(id: string, updates: {
  name?: string; email?: string | null; phone?: string | null
  position?: string | null; tags?: string[]
}): Promise<void> {
  const { error } = await getSupabase()
    .from('contacts')
    .update({ ...updates })
    .eq('id', id)
  if (error) throw error
}

// カスタムフィールド値
export async function upsertContactCustomValue(contactId: string, fieldId: string, value: string): Promise<void> {
  const { error } = await getSupabase()
    .from('contact_custom_values')
    .upsert({ contact_id: contactId, field_id: fieldId, value })
  if (error) throw error
}

export async function fetchContactCustomValues(contactId: string): Promise<Record<string, string>> {
  const { data, error } = await getSupabase()
    .from('contact_custom_values')
    .select('field_id, value')
    .eq('contact_id', contactId)
  if (error) return {}
  return Object.fromEntries((data ?? []).map((r) => [r.field_id, r.value ?? '']))
}

// 顧客ステータス（星・ハート等）
export async function fetchContactStatuses(contactId: string): Promise<string[]> {
  const { data } = await getSupabase()
    .from('contact_statuses')
    .select('status')
    .eq('contact_id', contactId)
  return (data ?? []).map((r) => r.status)
}

export async function toggleContactStatusDb(contactId: string, status: string, userId: string): Promise<void> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('contact_statuses')
    .select('status')
    .eq('contact_id', contactId)
    .eq('status', status)
    .single()

  if (data) {
    await supabase.from('contact_statuses').delete().eq('contact_id', contactId).eq('status', status)
  } else {
    await supabase.from('contact_statuses').insert({ contact_id: contactId, status, user_id: userId })
  }
}
