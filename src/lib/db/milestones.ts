import { getSupabase } from './client'
import type { DealMilestone, DivisionMilestoneType, DivisionNotificationSettings } from '@/types/database'

// 案件の対応期日（マイルストーン）＋Slack通知設定（M&A事業部要望⑧）。
// supabase/migrations/022_deal_milestones_and_slack.sql のテーブルを使用する。
// 022未適用の環境では呼び出し側（DealMilestonesSection等）がエラーを捕捉してセクションごと隠す。

type RawMilestoneType = { id: string; division_id: string; name: string; sort_order: number; created_at: string }

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
  due_date: string | null; notified_at: string | null
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
    created_at: r.created_at, updated_at: r.updated_at,
    division_milestone_types: r.division_milestone_types ?? undefined,
  }))
}

// due_date が空なら行自体を削除する（UNIQUE(deal_id, milestone_type_id)のupsertで
// null日付を積み上げない。日付クリア操作を「未設定に戻す」として扱う）
export async function upsertDealMilestone(dealId: string, divisionId: string, milestoneTypeId: string, dueDate: string | null): Promise<void> {
  if (!dueDate) {
    const { error } = await getSupabase()
      .from('deal_milestones')
      .delete()
      .eq('deal_id', dealId)
      .eq('milestone_type_id', milestoneTypeId)
    if (error) throw error
    return
  }
  // .select() を付けないと、RLSに拒否された0件更新でもエラーにならず「保存できたように見えて
  // 実際は保存されていない」状態になるため、更新行を必ず検証する（修正4。updateContactと同じパターン）
  const { data, error } = await getSupabase()
    .from('deal_milestones')
    .upsert(
      { deal_id: dealId, division_id: divisionId, milestone_type_id: milestoneTypeId, due_date: dueDate },
      { onConflict: 'deal_id,milestone_type_id' }
    )
    .select('id')
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
