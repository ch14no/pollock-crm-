import { getSupabase, chunkIdList, fetchAllByCursor, DEFAULT_PAGE_SIZE } from './client'
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
  // 052マイグレーション（接触経路（詳細）の人物紐づけ）未適用の環境では
  // select に含めないため常に optional。referrer_*と同型
  source_type?: string | null
  source_user_id?: string | null
  source_contact_id?: string | null
  source_user?: { id: string; name: string; email: string; role: string; created_at: string } | null
  source_contact?: {
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
    source_type: (r.source_type as ReferrerType | null | undefined) ?? undefined,
    source_user_id: r.source_user_id ?? undefined,
    source_contact_id: r.source_contact_id ?? undefined,
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
    source_user: r.source_user ? { ...r.source_user, role: r.source_user.role as 'super_admin' | 'manager' | 'user' } : undefined,
    source_contact: r.source_contact ? {
      id: r.source_contact.id,
      name: r.source_contact.name,
      department: r.source_contact.department ?? undefined,
      position: r.source_contact.position ?? undefined,
      email: r.source_contact.email ?? undefined,
      phone: r.source_contact.phone ?? undefined,
      company_id: r.source_contact.company_id ?? undefined,
      companies: r.source_contact.companies ?? undefined,
    } : undefined,
  }
}

// 021（紹介者）・052（接触経路詳細の人物紐づけ）が未適用の環境でも既存の顧客一覧・
// 詳細取得が壊れないよう、join込みで失敗したら従来selectにフォールバックする。
// 021と052は別々のタイミングで適用されうる（052はまだ未適用の環境がありうる）ため、
// 2つを1本のselect+1段フォールバックにまとめると、052未適用の環境で052分の
// エラーが出た時点で021分のjoin（既に本番で使われている紹介者表示）まで巻き添えで
// 失われてしまう。source（052）→referrer（021）→無しの3段階に分けて、
// どちらか片方だけ未適用でももう片方は生かす
const CONTACT_BASE_SELECT = '*, companies(*), users:assigned_user_id(id,name,email,role,created_at)'
const CONTACT_SELECT_WITH_REFERRER = `${CONTACT_BASE_SELECT},
  referrer_user:referrer_user_id(id,name,email,role,created_at),
  referrer_contact:referrer_contact_id(id,name,department,position,email,phone,company_id,companies(id,name))`
const CONTACT_SELECT_FULL = `${CONTACT_SELECT_WITH_REFERRER},
  source_user:source_user_id(id,name,email,role,created_at),
  source_contact:source_contact_id(id,name,department,position,email,phone,company_id,companies(id,name))`

function isMissingSourceColumn(error: { message?: string } | null): boolean {
  const msg = error?.message ?? ''
  const mentionsSource = msg.includes('source_user') || msg.includes('source_contact')
  return mentionsSource && (msg.includes('column') || msg.includes('schema cache') || msg.includes('relationship'))
}

function isMissingReferrerColumn(error: { message?: string } | null): boolean {
  const msg = error?.message ?? ''
  return msg.includes('referrer') && (msg.includes('column') || msg.includes('schema cache') || msg.includes('relationship'))
}

// division_idで絞り込むため通常は1000件未満（現状最大の事業部でも数百件規模）。
// tasks/dashboard/activities/analysis等9箇所から呼ばれ、事業部切り替え時の
// 連打・Realtime再取得と競合しやすい実装が多いため、ここは意図的に単一リクエストの
// ままにして待ち時間を増やさない（全件取得が要る場合はfetchAllContacts側で対応する）
export async function fetchContactsByDivision(divisionId: string): Promise<Contact[]> {
  let { data, error } = await getSupabase()
    .from('contacts')
    .select(CONTACT_SELECT_FULL)
    .eq('division_id', divisionId)
    .order('updated_at', { ascending: false })
  if (error && isMissingSourceColumn(error)) {
    ;({ data, error } = await getSupabase()
      .from('contacts')
      .select(CONTACT_SELECT_WITH_REFERRER)
      .eq('division_id', divisionId)
      .order('updated_at', { ascending: false }))
  }
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

// ContactPicker（事業部を絞らない全社検索）用に全件取得する
// （「全件ロード→クライアントフィルタ」方式）。PostgRESTの1リクエストあたり
// 返却件数上限（db-max-rows、本番実測1000件）をクライアント側の.limit()では
// 超えられないため、取得はidカーソルのキーセット方式でたぐる（OFFSETと違い、
// ページ取得の合間に他の担当者が連絡先を編集・登録しても取りこぼし・重複が
// 起きない）。表示順は取得後にupdated_at降順へ並べ直し、従来通り「最近更新した
// 連絡先が上に来る」体験を保つ
export async function fetchAllContacts(): Promise<Contact[]> {
  let tier: 'full' | 'referrer' | 'base' = 'full'

  const fetchBasePage = async (afterId: string | null): Promise<RawContact[]> => {
    let query = getSupabase().from('contacts').select(CONTACT_BASE_SELECT).order('id').limit(DEFAULT_PAGE_SIZE)
    if (afterId) query = query.gt('id', afterId)
    const { data, error } = await query
    if (error) throw error
    return data ?? []
  }

  const fetchReferrerPage = async (afterId: string | null): Promise<RawContact[]> => {
    let query = getSupabase().from('contacts').select(CONTACT_SELECT_WITH_REFERRER).order('id').limit(DEFAULT_PAGE_SIZE)
    if (afterId) query = query.gt('id', afterId)
    const { data, error } = await query
    if (error && isMissingReferrerColumn(error)) {
      tier = 'base'
      return fetchBasePage(afterId)
    }
    if (error) throw error
    return data ?? []
  }

  const rows = await fetchAllByCursor<RawContact>(async (afterId) => {
    if (tier === 'base') return fetchBasePage(afterId)
    if (tier === 'referrer') return fetchReferrerPage(afterId)
    let query = getSupabase().from('contacts').select(CONTACT_SELECT_FULL).order('id').limit(DEFAULT_PAGE_SIZE)
    if (afterId) query = query.gt('id', afterId)
    const { data, error } = await query
    if (error && isMissingSourceColumn(error)) {
      tier = 'referrer'
      return fetchReferrerPage(afterId)
    }
    if (error) throw error
    return data ?? []
  }, (r) => r.id)

  rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
  return rows.map(toContact)
}

export async function fetchContactById(id: string): Promise<Contact | null> {
  let { data, error } = await getSupabase()
    .from('contacts')
    .select(CONTACT_SELECT_FULL)
    .eq('id', id)
    .single()
  if (error && isMissingSourceColumn(error)) {
    ;({ data, error } = await getSupabase()
      .from('contacts')
      .select(CONTACT_SELECT_WITH_REFERRER)
      .eq('id', id)
      .single())
  }
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

// 021（紹介者）・052（接触経路詳細の人物紐づけ）未適用の環境ではinsert/updateから
// 当該カラムを外してリトライする（deals.ts の OPTIONAL_DEAL_COLUMNS と同じ考え方）
const OPTIONAL_CONTACT_COLUMNS = [
  'referrer_type', 'referrer_user_id', 'referrer_contact_id',
  'source_type', 'source_user_id', 'source_contact_id',
] as const

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
  sourceType?: ReferrerType; sourceUserId?: string; sourceContactId?: string
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
  if (input.sourceType !== undefined) payload.source_type = input.sourceType
  if (input.sourceUserId !== undefined) payload.source_user_id = input.sourceUserId
  if (input.sourceContactId !== undefined) payload.source_contact_id = input.sourceContactId

  const insertContact = (p: Record<string, unknown>) =>
    getSupabase().from('contacts').insert(p).select('*, companies(*)').single()

  let { data, error } = await insertContact(payload)
  // for文の1回巡回だと、あるカラムを除去した結果「次のエラーが実は前段で
  // 既にチェック済みの別カラムを指す」場合に取りこぼす（列不在エラーの報告順が
  // OPTIONAL_CONTACT_COLUMNSの配列順と一致する保証はないため。activities.tsの
  // OPTIONAL_ACTIVITY_COLUMNSと同じ理由・同じ対策）。未試行のカラム集合が
  // 尽きるかエラーが消えるまで回すことで対応
  const strippedFields: string[] = []
  const remaining = new Set(OPTIONAL_CONTACT_COLUMNS)
  while (error && remaining.size > 0) {
    const hit = [...remaining].find((col) => col in payload && isMissingContactColumnError(error, col))
    if (!hit) break
    delete payload[hit]
    remaining.delete(hit)
    strippedFields.push(hit)
    ;({ data, error } = await insertContact(payload))
  }
  if (error) throw error
  return { contact: toContact(data), strippedFields }
}

export async function updateContact(id: string, updates: {
  name?: string; email?: string | null; phone?: string | null
  position?: string | null; address?: string | null; department?: string | null
  notes?: string | null; tags?: string[]
  referrerType?: ReferrerType | null; referrerUserId?: string | null; referrerContactId?: string | null
  sourceType?: ReferrerType | null; sourceUserId?: string | null; sourceContactId?: string | null
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
  if (updates.sourceType !== undefined) patch.source_type = updates.sourceType
  if (updates.sourceUserId !== undefined) patch.source_user_id = updates.sourceUserId
  if (updates.sourceContactId !== undefined) patch.source_contact_id = updates.sourceContactId

  // .select() を付けないと、RLSに拒否された0件更新でもエラーにならず
  // 「保存できたように見えて実際は保存されていない」状態になるため、更新行を必ず検証する
  let { data, error } = await getSupabase()
    .from('contacts')
    .update(patch)
    .eq('id', id)
    .select('id')
  // 削除した任意カラム名を呼び出し元へ返す（修正5）。createContactと同じ
  // while+Setの取りこぼさないリトライ（列不在エラーの報告順が配列順と
  // 一致する保証はないため）
  const strippedFields: string[] = []
  const remaining = new Set(OPTIONAL_CONTACT_COLUMNS)
  while (error && remaining.size > 0) {
    const hit = [...remaining].find((col) => col in patch && isMissingContactColumnError(error, col))
    if (!hit) break
    delete patch[hit]
    remaining.delete(hit)
    strippedFields.push(hit)
    ;({ data, error } = await getSupabase().from('contacts').update(patch).eq('id', id).select('id'))
  }
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('更新が保存されませんでした（編集権限がないか、対象が存在しません）')
  }
  return { strippedFields }
}

export async function fetchContactsCustomValues(contactIds: string[]): Promise<Record<string, Record<string, string>>> {
  if (contactIds.length === 0) return {}
  // 事業部の全顧客IDが渡され得るためURL長制限（chunkIdListのコメント参照）を避けて分割取得
  const rows = await Promise.all(chunkIdList(contactIds).map(async (ids) => {
    const { data, error } = await getSupabase()
      .from('contact_custom_values')
      .select('contact_id, field_id, value')
      .in('contact_id', ids)
    return error ? [] : (data ?? [])
  }))
  const result: Record<string, Record<string, string>> = {}
  for (const row of rows.flat()) {
    const cid = row.contact_id as string
    const fid = row.field_id as string
    if (!result[cid]) result[cid] = {}
    result[cid][fid] = (row.value as string) ?? ''
  }
  return result
}

export async function deleteContact(id: string): Promise<void> {
  // .select()を付けないと、RLSに拒否された0件削除でもエラーにならず
  // 「削除できたつもり」のまま実際は残り続ける（deals.deleteDealの040対応と同根）
  const { data, error } = await getSupabase().from('contacts').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('削除できませんでした（削除権限がないか、対象が存在しません）')
  }
}

// 実際に削除できたIDだけを返す。`.in()`はRLSで一部の行だけ無音でフィルタされうるため、
// `error`が無くても要求件数どおり削除されたとは限らない（1件版のdeleteContactと同じ理由）。
// 例外を投げず常に{deletedIds, failedIds}を返す設計にしている点に注意: チャンク単位で
// 例外を投げて全体を中断すると、それより前のチャンクで既に削除済みのIDが呼び出し元に
// 一切伝わらず、成功済み分までUI上に残り続ける「幽霊」になる（/code-reviewで指摘）。
// 1チャンクだけ失敗（ネットワークエラー等）しても、行単位のRLS拒否と区別せず
// そのチャンク全件をfailedIdsに計上し、後続チャンクの処理は継続する
export async function deleteContacts(ids: string[]): Promise<{ deletedIds: string[]; failedIds: string[] }> {
  // Supabase の URL 長制限を避けるため 50 件ずつ分割して削除
  const CHUNK = 50
  const deletedIds: string[] = []
  const failedIds: string[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    try {
      const { data, error } = await getSupabase().from('contacts').delete().in('id', chunk).select('id')
      if (error) throw error
      const deletedSet = new Set((data ?? []).map((d) => d.id as string))
      chunk.forEach((id) => (deletedSet.has(id) ? deletedIds.push(id) : failedIds.push(id)))
    } catch {
      failedIds.push(...chunk)
    }
  }
  return { deletedIds, failedIds }
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
  // 事業部の全顧客IDが渡され得るためURL長制限（chunkIdListのコメント参照）を避けて分割取得
  const rows = await Promise.all(chunkIdList(contactIds).map(async (ids) => {
    const { data } = await getSupabase()
      .from('contact_statuses')
      .select('contact_id, status')
      .in('contact_id', ids)
    return data ?? []
  }))
  const result: Record<string, string[]> = {}
  for (const row of rows.flat()) {
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
