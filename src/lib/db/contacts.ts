import { getSupabase } from './client'
import type { Contact, ReferrerType } from '@/types/database'

type RawContact = {
  id: string; company_id: string | null; division_id: string; assigned_user_id: string | null
  name: string; email: string | null; phone: string | null; position: string | null
  address: string | null; department: string | null
  tags: string[]; custom_attributes: Record<string, unknown>; notes: string | null
  created_at: string; updated_at: string
  companies: { id: string; name: string; website: string | null; corporate_number: string | null; created_at: string; updated_at: string } | null
  users: { id: string; name: string; email: string; role: string; created_at: string } | null
  // 021マイグレーション（紹介者）未適用の環境では select に含めないため常に optional
  referrer_type?: string | null
  referrer_user_id?: string | null
  referrer_contact_id?: string | null
  referrer_user?: { id: string; name: string; email: string; role: string; created_at: string } | null
  referrer_contact?: {
    id: string; name: string; department: string | null; position: string | null
    email: string | null; phone: string | null; company_id: string | null
    companies: { id: string; name: string } | null
  } | null
}

function toContact(r: RawContact): Contact {
  return {
    id: r.id, company_id: r.company_id ?? undefined, division_id: r.division_id,
    assigned_user_id: r.assigned_user_id ?? undefined,
    name: r.name, email: r.email ?? undefined, phone: r.phone ?? undefined,
    position: r.position ?? undefined, address: r.address ?? undefined,
    department: r.department ?? undefined, notes: r.notes ?? undefined,
    tags: r.tags ?? [], custom_attributes: r.custom_attributes ?? {},
    referrer_type: (r.referrer_type as ReferrerType | null | undefined) ?? undefined,
    referrer_user_id: r.referrer_user_id ?? undefined,
    referrer_contact_id: r.referrer_contact_id ?? undefined,
    created_at: r.created_at, updated_at: r.updated_at,
    companies: r.companies ? {
      ...r.companies,
      corporate_number: r.companies.corporate_number ?? undefined,
      website: r.companies.website ?? undefined,
    } : undefined,
    users: r.users ? { ...r.users, role: r.users.role as 'super_admin' | 'manager' | 'user' } : undefined,
    referrer_user: r.referrer_user ? { ...r.referrer_user, role: r.referrer_user.role as 'super_admin' | 'manager' | 'user' } : undefined,
    referrer_contact: r.referrer_contact ? {
      id: r.referrer_contact.id,
      name: r.referrer_contact.name,
      department: r.referrer_contact.department ?? undefined,
      position: r.referrer_contact.position ?? undefined,
      email: r.referrer_contact.email ?? undefined,
      phone: r.referrer_contact.phone ?? undefined,
      company_id: r.referrer_contact.company_id ?? undefined,
      companies: r.referrer_contact.companies ?? undefined,
    } : undefined,
  }
}

// 021マイグレーション（紹介者：referrer_type/referrer_user_id/referrer_contact_id）が
// 未適用の環境でも既存の顧客一覧・詳細取得が壊れないよう、join込みで失敗したら
// 紹介者なしの従来select にフォールバックする
const CONTACT_BASE_SELECT = '*, companies(*), users:assigned_user_id(id,name,email,role,created_at)'
const CONTACT_SELECT_WITH_REFERRER = `${CONTACT_BASE_SELECT},
  referrer_user:referrer_user_id(id,name,email,role,created_at),
  referrer_contact:referrer_contact_id(id,name,department,position,email,phone,company_id,companies(id,name))`

function isMissingReferrerColumn(error: { message?: string } | null): boolean {
  const msg = error?.message ?? ''
  return msg.includes('referrer') && (msg.includes('column') || msg.includes('schema cache') || msg.includes('relationship'))
}

export async function fetchContactsByDivision(divisionId: string): Promise<Contact[]> {
  let { data, error } = await getSupabase()
    .from('contacts')
    .select(CONTACT_SELECT_WITH_REFERRER)
    .eq('division_id', divisionId)
    .order('updated_at', { ascending: false })
  if (error && isMissingReferrerColumn(error)) {
    ;({ data, error } = await getSupabase()
      .from('contacts')
      .select(CONTACT_BASE_SELECT)
      .eq('division_id', divisionId)
      .order('updated_at', { ascending: false }))
  }
  if (error) throw error
  return (data ?? []).map(toContact)
}

export async function fetchAllContacts(): Promise<Contact[]> {
  let { data, error } = await getSupabase()
    .from('contacts')
    .select(CONTACT_SELECT_WITH_REFERRER)
    .order('updated_at', { ascending: false })
    .limit(500)
  if (error && isMissingReferrerColumn(error)) {
    ;({ data, error } = await getSupabase()
      .from('contacts')
      .select(CONTACT_BASE_SELECT)
      .order('updated_at', { ascending: false })
      .limit(500))
  }
  if (error) throw error
  return (data ?? []).map(toContact)
}

export async function fetchContactById(id: string): Promise<Contact | null> {
  let { data, error } = await getSupabase()
    .from('contacts')
    .select(CONTACT_SELECT_WITH_REFERRER)
    .eq('id', id)
    .single()
  if (error && isMissingReferrerColumn(error)) {
    ;({ data, error } = await getSupabase()
      .from('contacts')
      .select(CONTACT_BASE_SELECT)
      .eq('id', id)
      .single())
  }
  if (error) return null
  return toContact(data)
}

// 021マイグレーション（紹介者）未適用の環境ではinsert/updateから当該カラムを
// 外してリトライする（deals.ts の OPTIONAL_DEAL_COLUMNS と同じ考え方）
const OPTIONAL_CONTACT_COLUMNS = ['referrer_type', 'referrer_user_id', 'referrer_contact_id'] as const

function isMissingContactColumnError(error: { message?: string } | null, column: string): boolean {
  const msg = error?.message ?? ''
  return msg.includes(column) && (msg.includes('column') || msg.includes('schema cache'))
}

export async function createContact(input: {
  divisionId: string; assignedUserId?: string; companyId?: string
  name: string; email?: string; phone?: string; position?: string
  address?: string; department?: string; notes?: string
  tags?: string[]; customAttributes?: Record<string, unknown>
  referrerType?: ReferrerType; referrerUserId?: string; referrerContactId?: string
}): Promise<{ contact: Contact; strippedFields: string[] }> {
  const payload: Record<string, unknown> = {
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
  }
  if (input.referrerType !== undefined) payload.referrer_type = input.referrerType
  if (input.referrerUserId !== undefined) payload.referrer_user_id = input.referrerUserId
  if (input.referrerContactId !== undefined) payload.referrer_contact_id = input.referrerContactId

  const insertContact = (p: Record<string, unknown>) =>
    getSupabase().from('contacts').insert(p).select('*, companies(*)').single()

  let { data, error } = await insertContact(payload)
  // 削除した任意カラム名を呼び出し元へ返す（修正5）。OPTIONAL_CONTACT_COLUMNSは
  // 紹介者関連カラムのみなので、1件でも含まれれば「紹介者欄が未反映」を意味する
  const strippedFields: string[] = []
  for (const col of OPTIONAL_CONTACT_COLUMNS) {
    if (error && col in payload && isMissingContactColumnError(error, col)) {
      delete payload[col]
      strippedFields.push(col)
      ;({ data, error } = await insertContact(payload))
    }
  }
  if (error) throw error
  return { contact: toContact(data), strippedFields }
}

export async function updateContact(id: string, updates: {
  name?: string; email?: string | null; phone?: string | null
  position?: string | null; address?: string | null; department?: string | null
  notes?: string | null; tags?: string[]
  referrerType?: ReferrerType | null; referrerUserId?: string | null; referrerContactId?: string | null
}): Promise<{ strippedFields: string[] }> {
  const patch: Record<string, unknown> = {}
  if (updates.name !== undefined) patch.name = updates.name
  if (updates.email !== undefined) patch.email = updates.email
  if (updates.phone !== undefined) patch.phone = updates.phone
  if (updates.position !== undefined) patch.position = updates.position
  if (updates.address !== undefined) patch.address = updates.address
  if (updates.department !== undefined) patch.department = updates.department
  if (updates.notes !== undefined) patch.notes = updates.notes
  if (updates.tags !== undefined) patch.tags = updates.tags
  if (updates.referrerType !== undefined) patch.referrer_type = updates.referrerType
  if (updates.referrerUserId !== undefined) patch.referrer_user_id = updates.referrerUserId
  if (updates.referrerContactId !== undefined) patch.referrer_contact_id = updates.referrerContactId

  // .select() を付けないと、RLSに拒否された0件更新でもエラーにならず
  // 「保存できたように見えて実際は保存されていない」状態になるため、更新行を必ず検証する
  let { data, error } = await getSupabase()
    .from('contacts')
    .update(patch)
    .eq('id', id)
    .select('id')
  // 削除した任意カラム名を呼び出し元へ返す（修正5）
  const strippedFields: string[] = []
  for (const col of OPTIONAL_CONTACT_COLUMNS) {
    if (error && col in patch && isMissingContactColumnError(error, col)) {
      delete patch[col]
      strippedFields.push(col)
      ;({ data, error } = await getSupabase().from('contacts').update(patch).eq('id', id).select('id'))
    }
  }
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('更新が保存されませんでした（編集権限がないか、対象が存在しません）')
  }
  return { strippedFields }
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
