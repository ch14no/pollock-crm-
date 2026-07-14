import { getSupabase } from './client'
import type { Deal, ReferrerType } from '@/types/database'

// 021マイグレーション（紹介者）が未適用の環境でも一覧取得が壊れないよう、
// join込みで失敗したら紹介者なしの従来selectにフォールバックする
const DEAL_BASE_SELECT = '*, contacts(id,name,company_id,companies(id,name)), users:assigned_user_id(id,name,email,role,created_at)'
const DEAL_SELECT_WITH_REFERRER = `${DEAL_BASE_SELECT},
  referrer_user:referrer_user_id(id,name,email,role,created_at),
  referrer_contact:referrer_contact_id(id,name,department,position,email,phone,company_id,companies(id,name))`

function isMissingReferrerColumn(error: { message?: string } | null): boolean {
  const msg = error?.message ?? ''
  return msg.includes('referrer') && (msg.includes('column') || msg.includes('schema cache') || msg.includes('relationship'))
}

// Supabaseのjoin結果（referrer込み/なし両対応の緩い形）をDeal型へ変換
type RawDeal = {
  id: string; contact_id: string | null; division_id: string; assigned_user_id: string | null
  title: string; amount: number; stage_id: string
  close_date: string | null; description: string | null
  product_name?: string | null; priority?: string | null
  created_at: string; updated_at: string
  contacts?: Deal['contacts'] | null
  users?: Deal['users'] | null
  referrer_type?: string | null
  referrer_user_id?: string | null
  referrer_contact_id?: string | null
  referrer_user?: Deal['referrer_user'] | null
  referrer_contact?: Deal['referrer_contact'] | null
}

function toDeal(d: RawDeal): Deal {
  return {
    id: d.id, contact_id: d.contact_id ?? undefined, division_id: d.division_id,
    assigned_user_id: d.assigned_user_id ?? undefined, title: d.title,
    amount: d.amount, stage_id: d.stage_id,
    close_date: d.close_date ?? undefined, description: d.description ?? undefined,
    product_name: d.product_name ?? undefined,
    priority: (d.priority as Deal['priority']) ?? undefined,
    referrer_type: (d.referrer_type as ReferrerType | null | undefined) ?? undefined,
    referrer_user_id: d.referrer_user_id ?? undefined,
    referrer_contact_id: d.referrer_contact_id ?? undefined,
    created_at: d.created_at, updated_at: d.updated_at,
    contacts: d.contacts ?? undefined,
    users: d.users ?? undefined,
    referrer_user: d.referrer_user ?? undefined,
    referrer_contact: d.referrer_contact ?? undefined,
  }
}

export async function fetchDealsByDivision(divisionId: string): Promise<Deal[]> {
  let { data, error } = await getSupabase()
    .from('deals')
    .select(DEAL_SELECT_WITH_REFERRER)
    .eq('division_id', divisionId)
    .order('updated_at', { ascending: false })
  if (error && isMissingReferrerColumn(error)) {
    ;({ data, error } = await getSupabase()
      .from('deals')
      .select(DEAL_BASE_SELECT)
      .eq('division_id', divisionId)
      .order('updated_at', { ascending: false }))
  }
  if (error) throw error
  return (data ?? []).map(toDeal)
}

export async function fetchDealsByContact(contactId: string): Promise<Deal[]> {
  let { data, error } = await getSupabase()
    .from('deals')
    .select(DEAL_SELECT_WITH_REFERRER)
    .eq('contact_id', contactId)
    .order('updated_at', { ascending: false })
  if (error && isMissingReferrerColumn(error)) {
    ;({ data, error } = await getSupabase()
      .from('deals')
      .select(DEAL_BASE_SELECT)
      .eq('contact_id', contactId)
      .order('updated_at', { ascending: false }))
  }
  if (error) throw error
  return (data ?? []).map(toDeal)
}

// 後続マイグレーション（010: product_name、012: priority、021: referrer_*）未適用の環境で、
// 当該カラムが存在しないことに起因するエラーかどうか。無関係なエラー
// （RLS拒否・制約違反等）でリトライして値だけ静かに失うのを防ぐため、
// スキーマ由来のエラーに限定して判定する。
function isMissingColumnError(error: { message?: string } | null, column: string): boolean {
  const msg = error?.message ?? ''
  // PostgRESTの列不在エラー例: "Could not find the 'priority' column of 'deals' in the schema cache"。
  // CHECK制約違反（例: violates check constraint "deals_priority_check"）等の別エラーには
  // カラム名が含まれるため、列不在を示す文言もあわせて要求して誤検知を防ぐ
  return msg.includes(column) && (msg.includes('column') || msg.includes('schema cache'))
}

// 任意カラム（マイグレーション未適用の可能性があるもの）のキー一覧
const OPTIONAL_DEAL_COLUMNS = ['product_name', 'priority', 'referrer_type', 'referrer_user_id', 'referrer_contact_id'] as const

export async function createDeal(input: {
  divisionId: string; contactId?: string; assignedUserId?: string
  title: string; amount: number; stageId: string; closeDate?: string; description?: string
  productName?: string; priority?: Deal['priority']
  referrerType?: ReferrerType; referrerUserId?: string; referrerContactId?: string
}): Promise<{ id: string; strippedFields: string[] }> {
  const payload: Record<string, unknown> = {
    division_id: input.divisionId, contact_id: input.contactId ?? null,
    assigned_user_id: input.assignedUserId ?? null,
    title: input.title, amount: input.amount, stage_id: input.stageId,
    close_date: input.closeDate ?? null, description: input.description ?? null,
  }
  // 値が指定されたときだけ任意カラムを含める（未適用環境で通常の登録まで
  // 巻き添えで失敗させないため）
  if (input.productName !== undefined) payload.product_name = input.productName
  if (input.priority !== undefined) payload.priority = input.priority
  if (input.referrerType !== undefined) payload.referrer_type = input.referrerType
  if (input.referrerUserId !== undefined) payload.referrer_user_id = input.referrerUserId
  if (input.referrerContactId !== undefined) payload.referrer_contact_id = input.referrerContactId

  const insertDeal = (p: Record<string, unknown>) =>
    getSupabase().from('deals').insert(p).select('id').single()

  let { data, error } = await insertDeal(payload)
  // 削除した任意カラム名を呼び出し元へ返す（修正5）。呼び出し元はreferrer関連が
  // 含まれていれば「保存されたが紹介者欄は未反映」である旨を警告として表示できる
  const strippedFields: string[] = []
  for (const col of OPTIONAL_DEAL_COLUMNS) {
    if (error && col in payload && isMissingColumnError(error, col)) {
      delete payload[col]
      strippedFields.push(col)
      ;({ data, error } = await insertDeal(payload))
    }
  }
  if (error) throw error
  if (!data) throw new Error('商談の作成結果を取得できませんでした')
  return { id: data.id, strippedFields }
}

export async function updateDealStage(id: string, stageId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('deals').update({ stage_id: stageId }).eq('id', id)
  if (error) throw error
}

export async function deleteDeal(id: string): Promise<void> {
  const { error } = await getSupabase().from('deals').delete().eq('id', id)
  if (error) throw error
}

export async function updateDeal(id: string, updates: {
  title?: string; amount?: number; stageId?: string
  closeDate?: string | null; description?: string | null
  productName?: string | null; priority?: Deal['priority']
  referrerType?: ReferrerType | null; referrerUserId?: string | null; referrerContactId?: string | null
}): Promise<{ strippedFields: string[] }> {
  const patch: Record<string, unknown> = {}
  if (updates.title !== undefined) patch.title = updates.title
  if (updates.amount !== undefined) patch.amount = updates.amount
  if (updates.stageId !== undefined) patch.stage_id = updates.stageId
  if (updates.closeDate !== undefined) patch.close_date = updates.closeDate
  if (updates.description !== undefined) patch.description = updates.description
  if (updates.productName !== undefined) patch.product_name = updates.productName
  if (updates.priority !== undefined) patch.priority = updates.priority
  if (updates.referrerType !== undefined) patch.referrer_type = updates.referrerType
  if (updates.referrerUserId !== undefined) patch.referrer_user_id = updates.referrerUserId
  if (updates.referrerContactId !== undefined) patch.referrer_contact_id = updates.referrerContactId
  // .select() を付けないと、RLSに拒否された0件更新でもエラーにならず「保存できたように見えて
  // 実際は保存されていない」状態になるため、更新行を必ず検証する
  // （修正3。updateContact/contacts.tsと同じパターン）
  let { data, error } = await getSupabase().from('deals').update(patch).eq('id', id).select('id')
  // 任意カラム（010/012/021マイグレーション）未適用の環境では、そのカラム以外の更新だけ通す。
  // 列不在エラーに限定してリトライする（無関係なエラーの握りつぶし防止）。
  // 削除したカラム名は呼び出し元へ返す（修正5）
  const strippedFields: string[] = []
  for (const col of OPTIONAL_DEAL_COLUMNS) {
    if (error && col in patch && isMissingColumnError(error, col)) {
      delete patch[col]
      strippedFields.push(col)
      ;({ data, error } = await getSupabase().from('deals').update(patch).eq('id', id).select('id'))
    }
  }
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('更新が保存されませんでした（編集権限がないか、対象が存在しません）')
  }
  return { strippedFields }
}
