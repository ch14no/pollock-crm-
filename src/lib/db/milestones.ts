import { getSupabase } from './client'
import type { DealMilestone, DivisionMilestoneType, DivisionNotificationSettings } from '@/types/database'

// 案件の対応期日（マイルストーン）＋Slack通知設定（M&A事業部要望⑧）。
// supabase/migrations/022_deal_milestones_and_slack.sql のテーブルを使用する。
// 022未適用の環境では呼び出し側（DealMilestonesSection等）がエラーを捕捉してセクションごと隠す。

type RawMilestoneType = { id: string; division_id: string; name: string; sort_order: number; created_at: string }

// 050（completed_at）未適用の環境で、当該カラムが存在しないことに起因するエラーかどうか。
// deals.ts/activities.tsと同じ判定基準
function isMissingColumnError(error: { message?: string } | null, column: string): boolean {
  const msg = error?.message ?? ''
  return msg.includes(column) && (msg.includes('column') || msg.includes('schema cache'))
}

export async function fetchMilestoneTypesByDivision(divisionId: string): Promise<DivisionMilestoneType[]> {
  const { data, error } = await getSupabase()
    .from('division_milestone_types')
    .select('*')
    .eq('division_id', divisionId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r: RawMilestoneType) => ({
    id: r.id, division_id: r.division_id, name: r.name,
    sort_order: r.sort_order, created_at: r.created_at,
  }))
}

type RawDealMilestone = {
  id: string; deal_id: string; division_id: string; milestone_type_id: string
  due_date: string | null; notified_at: string | null; completed_at: string | null
  created_at: string; updated_at: string
  division_milestone_types: RawMilestoneType | null
}

export async function fetchDealMilestones(dealId: string): Promise<DealMilestone[]> {
  const { data, error } = await getSupabase()
    .from('deal_milestones')
    .select('*, division_milestone_types(*)')
    .eq('deal_id', dealId)
  if (error) throw error
  return (data ?? []).map((r: RawDealMilestone) => ({
    id: r.id, deal_id: r.deal_id, division_id: r.division_id,
    milestone_type_id: r.milestone_type_id,
    due_date: r.due_date ?? undefined,
    notified_at: r.notified_at ?? undefined,
    completed_at: r.completed_at ?? undefined,
    created_at: r.created_at, updated_at: r.updated_at,
    division_milestone_types: r.division_milestone_types ?? undefined,
  }))
}

// due_date・completed_atのどちらも空になったときだけ行自体を削除する
// （UNIQUE(deal_id, milestone_type_id)のupsertでnull行を積み上げない）。
// 050で「対応済み」チェックを日付と独立に持てるようにしたため、日付だけクリアしても
// 対応済みチェックが入っていれば行を残す（従来はdue_date空＝即削除だった）。
// completedが未指定（undefined）のときは既存のcompleted_atに触れない
// （呼び出し元＝DealMilestonesSectionが「チェックが実際に操作されたか」を判定して渡す。
// ここでundefinedをbooleanに合成してしまうと、日付だけの編集のたびに
// completed_atが「今」に再スタンプされ、本来の対応済み日時が上書きされ続ける）。
// そのため「削除してよいか」の最終判断は、両方が空になると分かっている
// 呼び出し元にshouldDeleteとして委ねる
export async function upsertDealMilestone(dealId: string, divisionId: string, milestoneTypeId: string, updates: {
  dueDate: string | null; completed?: boolean; shouldDelete: boolean
}): Promise<void> {
  if (updates.shouldDelete) {
    const { error } = await getSupabase()
      .from('deal_milestones')
      .delete()
      .eq('deal_id', dealId)
      .eq('milestone_type_id', milestoneTypeId)
    if (error) throw error
    return
  }
  const payload: Record<string, unknown> = {
    deal_id: dealId, division_id: divisionId, milestone_type_id: milestoneTypeId,
    due_date: updates.dueDate,
  }
  // completedが指定されたときだけ任意カラム（050）を含める。未適用環境でも
  // 既存の日付保存まで巻き添えで失敗させないため
  if (updates.completed !== undefined) {
    payload.completed_at = updates.completed ? new Date().toISOString() : null
  }
  const upsert = (p: Record<string, unknown>) =>
    getSupabase().from('deal_milestones').upsert(p, { onConflict: 'deal_id,milestone_type_id' }).select('id')

  // .select() を付けないと、RLSに拒否された0件更新でもエラーにならず「保存できたように見えて
  // 実際は保存されていない」状態になるため、更新行を必ず検証する（修正4。updateContactと同じパターン）
  let { data, error } = await upsert(payload)
  if (error && 'completed_at' in payload && isMissingColumnError(error, 'completed_at')) {
    delete payload.completed_at
    ;({ data, error } = await upsert(payload))
  }
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('対応期日が保存されませんでした（編集権限がないか、対象が存在しません）')
  }
}

type RawNotificationSettings = {
  division_id: string; slack_webhook_url: string | null; slack_mention: string | null
  days_before: number; enabled: boolean; updated_at: string
}

export async function fetchNotificationSettings(divisionId: string): Promise<DivisionNotificationSettings | null> {
  const { data, error } = await getSupabase()
    .from('division_notification_settings')
    .select('*')
    .eq('division_id', divisionId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const r = data as RawNotificationSettings
  return {
    division_id: r.division_id,
    slack_webhook_url: r.slack_webhook_url ?? undefined,
    slack_mention: r.slack_mention ?? undefined,
    days_before: r.days_before,
    enabled: r.enabled,
    updated_at: r.updated_at,
  }
}

export async function upsertNotificationSettings(divisionId: string, input: {
  slackWebhookUrl?: string | null; slackMention?: string | null
  daysBefore: number; enabled: boolean
}): Promise<void> {
  // 修正4: .select()による行数検証がないと、RLSに拒否された0件更新でも
  // エラーにならず「保存できたように見えて実際は保存されていない」状態になる
  const { data, error } = await getSupabase()
    .from('division_notification_settings')
    .upsert({
      division_id: divisionId,
      slack_webhook_url: input.slackWebhookUrl ?? null,
      slack_mention: input.slackMention ?? null,
      days_before: input.daysBefore,
      enabled: input.enabled,
    }, { onConflict: 'division_id' })
    .select('division_id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('通知設定が保存されませんでした（編集権限がないか、対象が存在しません）')
  }
}
