import { getSupabase } from './client'
import type { Activity, DivisionMemoCategory } from '@/types/database'

// カテゴリ未設定の事業部向けフォールバック（020適用前・カテゴリ0件でもすぐ使えるように）
export const DEFAULT_MEMO_CATEGORY_NAMES: string[] = ['顧客', '案件', '面談', '契約']

// 020マイグレーション未適用の環境で memo_category 列が無くても
// 通常の活動記録まで巻き添えで失敗させないための判定（deals.tsと同じ実装。
// 列不在を示す文言もあわせて要求し、CHECK制約違反等での誤検知を防ぐ）
function isMissingColumnError(error: { message?: string } | null, column: string): boolean {
  const msg = error?.message ?? ''
  return msg.includes(column) && (msg.includes('column') || msg.includes('schema cache'))
}

export async function fetchActivitiesByUser(userId: string): Promise<Activity[]> {
  const { data, error } = await getSupabase()
    .from('activities')
    .select('*, users:user_id(id,name,email,role,created_at)')
    .eq('user_id', userId)
    .order('action_date', { ascending: false })
    .limit(200)
  if (error) throw error
  return (data ?? []).map(toActivity)
}

export async function fetchActivitiesByTarget(targetType: string, targetId: string): Promise<Activity[]> {
  const { data, error } = await getSupabase()
    .from('activities')
    .select('*, users:user_id(id,name,email,role,created_at)')
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .order('action_date', { ascending: false })
  if (error) throw error
  return (data ?? []).map(toActivity)
}

export async function createActivity(input: {
  targetType: string; targetId: string; userId?: string; activityType: string
  title?: string; memo?: string; memoCategory?: string; dueDate?: string; status?: string; actionDate?: string
}): Promise<string> {
  const payload: Record<string, unknown> = {
    target_type: input.targetType, target_id: input.targetId,
    user_id: input.userId ?? null, activity_type: input.activityType,
    title: input.title ?? null, memo: input.memo ?? null,
    due_date: input.dueDate ?? null, status: input.status ?? 'done',
    action_date: input.actionDate ?? new Date().toISOString(),
  }
  // 値が指定されたときだけ任意カラム（020）を含める
  if (input.memoCategory !== undefined) payload.memo_category = input.memoCategory

  const insert = (p: Record<string, unknown>) =>
    getSupabase().from('activities').insert(p).select('id').single()

  let { data, error } = await insert(payload)
  if (error && 'memo_category' in payload && isMissingColumnError(error, 'memo_category')) {
    delete payload.memo_category
    ;({ data, error } = await insert(payload))
  }
  if (error) throw error
  if (!data) throw new Error('活動の作成結果を取得できませんでした')
  return data.id
}

export async function updateActivityStatus(id: string, status: string): Promise<void> {
  const { error } = await getSupabase()
    .from('activities').update({ status }).eq('id', id)
  if (error) throw error
}

export async function upsertTaskMeta(activityId: string, urgency: boolean, importance: boolean, scope: string): Promise<void> {
  const { error } = await getSupabase()
    .from('task_meta')
    .upsert({ activity_id: activityId, urgency, importance, scope })
  if (error) throw error
}

export async function updateTaskKanbanStage(activityId: string, stageId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('task_meta')
    .upsert({ activity_id: activityId, kanban_stage_id: stageId })
  if (error) throw error
}

export async function fetchTaskKanbanStages(activityIds: string[]): Promise<Record<string, string>> {
  if (activityIds.length === 0) return {}
  const { data } = await getSupabase()
    .from('task_meta')
    .select('activity_id, kanban_stage_id')
    .in('activity_id', activityIds)
  const result: Record<string, string> = {}
  for (const row of (data ?? [])) {
    if (row.kanban_stage_id) result[row.activity_id as string] = row.kanban_stage_id as string
  }
  return result
}

export async function fetchActivitiesByDivision(divisionId: string): Promise<Activity[]> {
  const { data: contacts } = await getSupabase()
    .from('contacts').select('id').eq('division_id', divisionId)
  const contactIds = (contacts ?? []).map((c: { id: string }) => c.id)
  return fetchActivitiesByContactIds(contactIds)
}

export async function fetchActivitiesByContactIds(contactIds: string[]): Promise<Activity[]> {
  if (contactIds.length === 0) return []
  const { data, error } = await getSupabase()
    .from('activities')
    .select('*, users:user_id(id,name,email,role,created_at)')
    .eq('target_type', 'contact')
    .in('target_id', contactIds)
    .order('action_date', { ascending: false })
    .limit(500)
  if (error) throw error
  return (data ?? []).map(toActivity)
}

export async function fetchActivitiesByCompany(companyId: string, contactIds: string[]): Promise<Activity[]> {
  const [companyActivities, contactActivities] = await Promise.all([
    getSupabase()
      .from('activities')
      .select('*, users:user_id(id,name,email,role,created_at)')
      .eq('target_type', 'company')
      .eq('target_id', companyId)
      .order('action_date', { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (error) throw error
        return (data ?? []).map(toActivity)
      }),
    fetchActivitiesByContactIds(contactIds),
  ])
  return [...companyActivities, ...contactActivities]
    .sort((a, b) => new Date(b.action_date).getTime() - new Date(a.action_date).getTime())
}

// 通知欄用: 自事業部の商談の直近ステージ変更（015のトリガーが記録した活動）。
// excludeUserId には自分のIDを渡し、自分の操作は通知に出さない
export async function fetchRecentDealStageChanges(
  divisionId: string, sinceIso: string, excludeUserId?: string
): Promise<Activity[]> {
  const { data: deals, error: dealsError } = await getSupabase()
    .from('deals')
    .select('id')
    .eq('division_id', divisionId)
    .order('updated_at', { ascending: false })
    .limit(500)
  if (dealsError) throw dealsError
  const dealIds = (deals ?? []).map((d: { id: string }) => d.id)
  if (dealIds.length === 0) return []

  let query = getSupabase()
    .from('activities')
    .select('*, users:user_id(id,name,email,role,created_at)')
    .eq('target_type', 'deal')
    .in('target_id', dealIds)
    .like('title', 'ステージ変更:%')
    .gte('action_date', sinceIso)
    .order('action_date', { ascending: false })
    .limit(20)
  if (excludeUserId) query = query.neq('user_id', excludeUserId)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(toActivity)
}

export async function deleteActivity(id: string): Promise<void> {
  // RLSに弾かれた削除はエラーにならず0行で成功扱いになる（activities_deleteポリシーが
  // 存在しなかった期間、削除が無音で効いていなかった）。0件削除を失敗として検知する
  const { data, error } = await getSupabase()
    .from('activities').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('削除できませんでした（対象が存在しないか、削除する権限がありません）')
  }
}

export async function updateActivityFields(id: string, updates: {
  title?: string | null; memo?: string | null; due_date?: string | null
}): Promise<void> {
  const { error } = await getSupabase().from('activities').update(updates).eq('id', id)
  if (error) throw error
}

function toActivity(r: Record<string, unknown>): Activity {
  return {
    id: r.id as string,
    target_type: r.target_type as 'contact' | 'deal',
    target_id: r.target_id as string,
    user_id: r.user_id as string | undefined,
    activity_type: r.activity_type as Activity['activity_type'],
    title: r.title as string | undefined,
    memo: r.memo as string | undefined,
    memo_category: (r.memo_category as string | null) ?? undefined,
    due_date: r.due_date as string | undefined,
    status: r.status as Activity['status'],
    action_date: r.action_date as string,
    created_at: r.created_at as string,
    users: r.users as Activity['users'],
  }
}

// ─── 事業部別メモカテゴリ（division_memo_categories・020） ─────────

export async function fetchDivisionMemoCategories(divisionId: string): Promise<DivisionMemoCategory[]> {
  const { data, error } = await getSupabase()
    .from('division_memo_categories')
    .select('*')
    .eq('division_id', divisionId)
    .order('sort_order')
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id as string,
    division_id: r.division_id as string,
    name: r.name as string,
    sort_order: (r.sort_order as number) ?? 0,
  }))
}

export async function createDivisionMemoCategory(input: {
  divisionId: string; name: string; sortOrder: number
}): Promise<void> {
  const { error } = await getSupabase()
    .from('division_memo_categories')
    .insert({ division_id: input.divisionId, name: input.name, sort_order: input.sortOrder })
  if (error) throw error
}

export async function deleteDivisionMemoCategory(id: string): Promise<void> {
  const { error } = await getSupabase().from('division_memo_categories').delete().eq('id', id)
  if (error) throw error
}
