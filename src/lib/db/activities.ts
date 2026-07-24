import { getSupabase, chunkIdList } from './client'
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

export interface TaskKanbanMeta {
  stageId?: string
  sortOrder?: number
  updatedAt: string
}

// タスクの列・並び順・更新日時をまとめて取得する（033・task_meta.updated_at）。
// updatedAtはフロント側でDBとローカルどちらが新しいか比較するために使う
// （appStore.hydrateTaskMeta参照）。以前はfetchTaskKanbanStages/fetchTaskOrdersの
// 2関数に分かれ同じテーブルへ2回問い合わせていたが、1回にまとめた。
//
// 1クエリにまとめた副作用として、updated_at（033）が未適用の環境ではクエリ全体が
// エラーになる。以前は列（025）と並び順（031）が独立クエリだったため、
// どちらか一方が未適用でも他方は正常に取得できていたが、統合後はそれが失われて
// 「デプロイ直後・マイグレーション未適用の間、列・並び順の同期が全ユーザーぶん
// サイレントに完全停止する」リスクがある（code-reviewで指摘）。createActivityの
// isMissingColumnErrorと同じ方針で、updated_at列が無い場合はそれを含めずに
// 再取得し、列・並び順の同期だけは引き続き機能させる
export async function fetchTaskKanbanMeta(activityIds: string[]): Promise<Record<string, TaskKanbanMeta>> {
  if (activityIds.length === 0) return {}
  // IDリストはURL長制限を超えないよう分割して取得（chunkIdListのコメント参照）
  const rows = await Promise.all(chunkIdList(activityIds).map(async (ids) => {
    let data: Record<string, unknown>[] | null
    let error: { message?: string } | null
    ;({ data, error } = await getSupabase()
      .from('task_meta')
      .select('activity_id, kanban_stage_id, sort_order, updated_at')
      .in('activity_id', ids))
    if (error && isMissingColumnError(error, 'updated_at')) {
      ;({ data, error } = await getSupabase()
        .from('task_meta')
        .select('activity_id, kanban_stage_id, sort_order')
        .in('activity_id', ids))
    }
    if (error) return []
    return data ?? []
  }))
  const result: Record<string, TaskKanbanMeta> = {}
  for (const row of rows.flat()) {
    result[row.activity_id as string] = {
      stageId: (row.kanban_stage_id as string | null | undefined) ?? undefined,
      sortOrder: (row.sort_order as number | null | undefined) ?? undefined,
      // updated_at未適用環境ではrowに含まれない。この場合は比較のしようがないため
      // 最古の日時にしておき、ローカルに既知の値があれば上書きしない
      // （＝033適用前の古い「ローカル優先」挙動にフォールバックする。033適用後の
      // 環境では通常この分岐に入らない）
      updatedAt: (row.updated_at as string | undefined) ?? new Date(0).toISOString(),
    }
  }
  return result
}

// カード移動時（列変更・列内並び替え）に、移動先の列全体を連番で保存する。
// 1件ずつ独立してupsertする（Promise.allSettled）。1件でも失敗すると、一括upsert
// では1回のSQL文が丸ごとロールバックされ列全体の保存が失敗していた（実際に発生した障害）。
// 想定される単一行の失敗要因は2種類あり、いずれもエラーコードで分岐せず一律に
// 弾いてfailedIdsへ回す:
//   (1) 他ブラウザで既に削除されたタスクがローカルキャッシュに残っている場合。
//       task_meta.activity_idはactivitiesへのFK（ON DELETE CASCADE）なので親が
//       消えるとtask_meta行もCASCADE削除され、upsertはINSERT扱いになりFK違反(23503)で弾かれる
//       （task_metaのINSERTポリシーはauth.uid() IS NOT NULLのみで、ここではRLSは弾かない）。
//   (2) 既存行だが呼び出し元にUPDATE権限が無い場合（例: 対象がcompany等でdivisionを
//       解決できない未担当タスク）。ON CONFLICT DO UPDATEのUSING不成立でRLS(42501)が上がる。
// 行ごとに分離することで、これら失敗行以外の正常な行は巻き添えにならない。
// task_metaのUPDATE権限は030で同一事業部メンバーに開放済みのため追加の権限確認は不要
export async function upsertTaskOrders(
  orders: { activityId: string; stageId: string; sortOrder: number }[]
): Promise<{ failedIds: string[] }> {
  if (orders.length === 0) return { failedIds: [] }
  const results = await Promise.allSettled(
    orders.map((o) =>
      getSupabase()
        .from('task_meta')
        .upsert({
          activity_id: o.activityId, kanban_stage_id: o.stageId, sort_order: o.sortOrder,
        })
        .then(({ error }) => {
          if (error) throw error
        })
    )
  )
  const failedIds = orders
    .filter((_, i) => results[i].status === 'rejected')
    .map((o) => o.activityId)
  return { failedIds }
}

export async function fetchActivitiesByDivision(divisionId: string): Promise<Activity[]> {
  const { data: contacts } = await getSupabase()
    .from('contacts').select('id').eq('division_id', divisionId)
  const contactIds = (contacts ?? []).map((c: { id: string }) => c.id)
  return fetchActivitiesByContactIds(contactIds)
}

export async function fetchActivitiesByContactIds(contactIds: string[]): Promise<Activity[]> {
  if (contactIds.length === 0) return []
  // 事業部の全顧客IDが渡されるため件数の上限がない。URL長制限（chunkIdListの
  // コメント参照）を超えると事業部全体のタスク・活動一覧が静かに空になるので分割取得する
  const results = await Promise.all(chunkIdList(contactIds).map(async (ids) => {
    const { data, error } = await getSupabase()
      .from('activities')
      .select('*, users:user_id(id,name,email,role,created_at)')
      .eq('target_type', 'contact')
      .in('target_id', ids)
      .order('action_date', { ascending: false })
      .limit(500)
    if (error) throw error
    return (data ?? []).map(toActivity)
  }))
  // 分割前と同じ「全体で直近500件」に揃える
  return results.flat()
    .sort((a, b) => new Date(b.action_date).getTime() - new Date(a.action_date).getTime())
    .slice(0, 500)
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

  // dealIdsは最大500件になり得るためURL長制限（chunkIdListのコメント参照）を避けて分割取得
  const results = await Promise.all(chunkIdList(dealIds).map(async (ids) => {
    let query = getSupabase()
      .from('activities')
      .select('*, users:user_id(id,name,email,role,created_at)')
      .eq('target_type', 'deal')
      .in('target_id', ids)
      .like('title', 'ステージ変更:%')
      .gte('action_date', sinceIso)
      .order('action_date', { ascending: false })
      .limit(20)
    if (excludeUserId) query = query.neq('user_id', excludeUserId)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(toActivity)
  }))
  // 分割前と同じ「全体で直近20件」に揃える
  return results.flat()
    .sort((a, b) => new Date(b.action_date).getTime() - new Date(a.action_date).getTime())
    .slice(0, 20)
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

// タスクの担当者変更。activities_update の RLS（本人のみUPDATE可）は他フィールドの
// 誤編集を避けるため広げず、再アサインという1操作に絞った SECURITY DEFINER 関数
// （029_task_reassignment.sql）経由で行う。同一事業部メンバー間のみ許可される。
// newAssigneeId に null を渡すと「未担当」に戻せる
export async function reassignTask(activityId: string, newAssigneeId: string | null): Promise<void> {
  const { error } = await getSupabase()
    .rpc('reassign_task', { target_activity_id: activityId, new_assignee_id: newAssigneeId })
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
