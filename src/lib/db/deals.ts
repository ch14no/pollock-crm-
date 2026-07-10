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
    created_at: d.created_at, updated_at: d.updated_at,
    contacts: d.contacts ?? undefined,
    users: d.users ?? undefined,
  })) as Deal[]
}

// product_name カラム（010マイグレーション）が存在しないことに起因するエラーかどうか。
// 無関係なエラー（RLS拒否・制約違反等）でリトライして商品名だけ静かに失うのを防ぐため、
// スキーマ由来のエラーに限定して判定する。
function isMissingProductNameColumn(error: { message?: string } | null): boolean {
  return !!error?.message?.includes('product_name')
}

export async function createDeal(input: {
  divisionId: string; contactId?: string; assignedUserId?: string
  title: string; amount: number; stageId: string; closeDate?: string; description?: string
  productName?: string
}): Promise<string> {
  const base = {
    division_id: input.divisionId, contact_id: input.contactId ?? null,
    assigned_user_id: input.assignedUserId ?? null,
    title: input.title, amount: input.amount, stage_id: input.stageId,
    close_date: input.closeDate ?? null, description: input.description ?? null,
  }
  const insertDeal = (payload: Record<string, unknown>) =>
    getSupabase().from('deals').insert(payload).select('id').single()

  // 商品が選択されたときだけ product_name を含める（010未適用の環境で
  // 商品未選択の通常の商談登録まで巻き添えで失敗させないため）
  const withProduct = input.productName !== undefined
  let { data, error } = await insertDeal(withProduct ? { ...base, product_name: input.productName } : base)
  if (error && withProduct && isMissingProductNameColumn(error)) {
    ;({ data, error } = await insertDeal(base))
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
  productName?: string | null
}): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (updates.title !== undefined) patch.title = updates.title
  if (updates.amount !== undefined) patch.amount = updates.amount
  if (updates.stageId !== undefined) patch.stage_id = updates.stageId
  if (updates.closeDate !== undefined) patch.close_date = updates.closeDate
  if (updates.description !== undefined) patch.description = updates.description
  if (updates.productName !== undefined) patch.product_name = updates.productName
  let { error } = await getSupabase().from('deals').update(patch).eq('id', id)
  // product_name カラム（010マイグレーション）未適用の環境では商品以外の更新だけ通す。
  // 列不在エラーに限定してリトライする（無関係なエラーの握りつぶし防止）
  if (error && updates.productName !== undefined && isMissingProductNameColumn(error)) {
    delete patch.product_name
    ;({ error } = await getSupabase().from('deals').update(patch).eq('id', id))
  }
  if (error) throw error
}
