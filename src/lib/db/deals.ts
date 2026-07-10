import { getSupabase } from './client'
import type { Deal } from '@/types/database'

export async function fetchDealsByDivision(divisionId: string): Promise<Deal[]> {
  const { data, error } = await getSupabase()
    .from('deals')
    .select('*, contacts(id,name,company_id,companies(id,name)), users:assigned_user_id(id,name,email,role,created_at)')
    .eq('division_id', divisionId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((d) => ({
    id: d.id, contact_id: d.contact_id ?? undefined, division_id: d.division_id,
    assigned_user_id: d.assigned_user_id ?? undefined, title: d.title,
    amount: d.amount, stage_id: d.stage_id,
    close_date: d.close_date ?? undefined, description: d.description ?? undefined,
    product_name: d.product_name ?? undefined,
    priority: (d.priority as Deal['priority']) ?? undefined,
    created_at: d.created_at, updated_at: d.updated_at,
    contacts: d.contacts ?? undefined,
    users: d.users ?? undefined,
  })) as Deal[]
}

export async function fetchDealsByContact(contactId: string): Promise<Deal[]> {
  const { data, error } = await getSupabase()
    .from('deals')
    .select('*, contacts(id,name,company_id,companies(id,name)), users:assigned_user_id(id,name,email,role,created_at)')
    .eq('contact_id', contactId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((d) => ({
    id: d.id, contact_id: d.contact_id ?? undefined, division_id: d.division_id,
    assigned_user_id: d.assigned_user_id ?? undefined, title: d.title,
    amount: d.amount, stage_id: d.stage_id,
    close_date: d.close_date ?? undefined, description: d.description ?? undefined,
    product_name: d.product_name ?? undefined,
    priority: (d.priority as Deal['priority']) ?? undefined,
    created_at: d.created_at, updated_at: d.updated_at,
    contacts: d.contacts ?? undefined,
    users: d.users ?? undefined,
  })) as Deal[]
}

// 後続マイグレーション（010: product_name、012: priority）未適用の環境で、
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
const OPTIONAL_DEAL_COLUMNS = ['product_name', 'priority'] as const

export async function createDeal(input: {
  divisionId: string; contactId?: string; assignedUserId?: string
  title: string; amount: number; stageId: string; closeDate?: string; description?: string
  productName?: string; priority?: Deal['priority']
}): Promise<string> {
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

  const insertDeal = (p: Record<string, unknown>) =>
    getSupabase().from('deals').insert(p).select('id').single()

  let { data, error } = await insertDeal(payload)
  for (const col of OPTIONAL_DEAL_COLUMNS) {
    if (error && col in payload && isMissingColumnError(error, col)) {
      delete payload[col]
      ;({ data, error } = await insertDeal(payload))
    }
  }
  if (error) throw error
  if (!data) throw new Error('商談の作成結果を取得できませんでした')
  return data.id
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
}): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (updates.title !== undefined) patch.title = updates.title
  if (updates.amount !== undefined) patch.amount = updates.amount
  if (updates.stageId !== undefined) patch.stage_id = updates.stageId
  if (updates.closeDate !== undefined) patch.close_date = updates.closeDate
  if (updates.description !== undefined) patch.description = updates.description
  if (updates.productName !== undefined) patch.product_name = updates.productName
  if (updates.priority !== undefined) patch.priority = updates.priority
  let { error } = await getSupabase().from('deals').update(patch).eq('id', id)
  // 任意カラム（010/012マイグレーション）未適用の環境では、そのカラム以外の更新だけ通す。
  // 列不在エラーに限定してリトライする（無関係なエラーの握りつぶし防止）
  for (const col of OPTIONAL_DEAL_COLUMNS) {
    if (error && col in patch && isMissingColumnError(error, col)) {
      delete patch[col]
      ;({ error } = await getSupabase().from('deals').update(patch).eq('id', id))
    }
  }
  if (error) throw error
}
