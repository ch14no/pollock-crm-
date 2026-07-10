import { getSupabase } from './client'
import type { Contact } from '@/types/database'

type RawContact = {
  id: string; company_id: string | null; division_id: string; assigned_user_id: string | null
  name: string; email: string | null; phone: string | null; position: string | null
  address: string | null; department: string | null
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
    position: r.position ?? undefined, address: r.address ?? undefined,
    department: r.department ?? undefined, notes: r.notes ?? undefined,
    tags: r.tags ?? [], custom_attributes: r.custom_attributes ?? {},
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

export async function fetchAllContacts(): Promise<Contact[]> {
  const { data, error } = await getSupabase()
    .from('contacts')
    .select('*, companies(*), users:assigned_user_id(id,name,email,role,created_at)')
    .order('updated_at', { ascending: false })
    .limit(500)
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
  address?: string; department?: string; notes?: string
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
      address: input.address ?? null,
      department: input.department ?? null,
      notes: input.notes ?? null,
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
  position?: string | null; address?: string | null; department?: string | null
  notes?: string | null; tags?: string[]
}): Promise<void> {
  // .select() を付けないと、RLSに拒否された0件更新でもエラーにならず
  // 「保存できたように見えて実際は保存されていない」状態になるため、更新行を必ず検証する
  const { data, error } = await getSupabase()
    .from('contacts')
    .update({ ...updates })
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('更新が保存されませんでした（編集権限がないか、対象が存在しません）')
  }
}

export async function fetchContactsCustomValues(contactIds: string[]): Promise<Record<string, Record<string, string>>> {
  if (contactIds.length === 0) return {}
  const { data, error } = await getSupabase()
    .from('contact_custom_values')
    .select('contact_id, field_id, value')
    .in('contact_id', contactIds)
  if (error) return {}
  const result: Record<string, Record<string, string>> = {}
  for (const row of (data ?? [])) {
    const cid = row.contact_id as string
    const fid = row.field_id as string
    if (!result[cid]) result[cid] = {}
    result[cid][fid] = (row.value as string) ?? ''
  }
  return result
}

export async function deleteContact(id: string): Promise<void> {
  const { error } = await getSupabase().from('contacts').delete().eq('id', id)
  if (error) throw error
}

export async function deleteContacts(ids: string[]): Promise<void> {
  // Supabase の URL 長制限を避けるため 50 件ずつ分割して削除
  const CHUNK = 50
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await getSupabase().from('contacts').delete().in('id', ids.slice(i, i + CHUNK))
    if (error) throw error
  }
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

// 顧客ステータス一括取得（リスト画面用）
export async function fetchContactStatusesBatch(contactIds: string[]): Promise<Record<string, string[]>> {
  if (contactIds.length === 0) return {}
  const { data } = await getSupabase()
    .from('contact_statuses')
    .select('contact_id, status')
    .in('contact_id', contactIds)
  const result: Record<string, string[]> = {}
  for (const row of (data ?? [])) {
    const cid = row.contact_id as string
    if (!result[cid]) result[cid] = []
    result[cid].push(row.status as string)
  }
  return result
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
