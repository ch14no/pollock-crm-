import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// M&A事業部要望⑧: 対応期日（マイルストーン・クロージング予定日）の指定日数前に
// Slackへ自動通知するVercel Cron（毎日 UTC 22:00 = JST 7:00 に実行。vercel.json参照）。
// 022マイグレーション（division_notification_settings / deal_milestones）が前提。

export const dynamic = 'force-dynamic'

// due_date/close_date はDATE型（JSTのカレンダー日）で保存されているため、
// サーバーのUTC時刻からJSTの「今日」を算出する
function jstDateString(offsetDays: number): string {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  jst.setUTCDate(jst.getUTCDate() + offsetDays)
  const y = jst.getUTCFullYear()
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(jst.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

type NotificationSettingsRow = {
  division_id: string; slack_webhook_url: string | null; slack_mention: string | null
  days_before: number; enabled: boolean
}

type MilestoneRow = {
  id: string; due_date: string
  deals: { title: string } | { title: string }[] | null
  division_milestone_types: { name: string } | { name: string }[] | null
}

type DealRow = { id: string; title: string; close_date: string; close_date_alert_notified_at: string | null }

// SupabaseのPostgREST embedは1:1関係でも配列で返ることがあるため正規化する
function firstOf<T>(v: T | T[] | null | undefined): T | undefined {
  if (!v) return undefined
  return Array.isArray(v) ? v[0] : v
}

async function sendSlackMessage(webhookUrl: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function processDivision(admin: ReturnType<typeof createAdminClient>, settings: NotificationSettingsRow): Promise<void> {
  if (!settings.enabled || !settings.slack_webhook_url) return
  const targetDate = jstDateString(settings.days_before)

  // 完全一致（.eq）だと、1回のcron実行が失敗・スキップされた場合そのマイルストーン/
  // クロージングの通知が二度と送られない。「今日+days_before以前でまだ未通知」を
  // 対象にすることで、実行漏れの翌日以降にも再試行（キャッチアップ）できるようにする（修正7）。
  // 重複送信はnotified_at/close_date_alert_notified_atのNULLチェックで防ぐ
  const [milestonesRes, dealsRes] = await Promise.all([
    admin
      .from('deal_milestones')
      .select('id, due_date, deals(title), division_milestone_types(name)')
      .eq('division_id', settings.division_id)
      .lte('due_date', targetDate)
      .is('notified_at', null),
    admin
      .from('deals')
      .select('id, title, close_date, close_date_alert_notified_at')
      .eq('division_id', settings.division_id)
      .lte('close_date', targetDate)
      .is('close_date_alert_notified_at', null),
  ])

  const milestones = (milestonesRes.data ?? []) as MilestoneRow[]
  const deals = (dealsRes.data ?? []) as DealRow[]
  if (milestones.length === 0 && deals.length === 0) return

  const lines: string[] = []
  for (const m of milestones) {
    const dealTitle = firstOf(m.deals)?.title ?? '（案件名不明）'
    const typeName = firstOf(m.division_milestone_types)?.name ?? '（マイルストーン）'
    lines.push(`・${dealTitle} — ${typeName}（${m.due_date}）`)
  }
  for (const d of deals) {
    lines.push(`・${d.title} — クロージング予定日（${d.close_date}）`)
  }

  const mentionPrefix = settings.slack_mention ? `${settings.slack_mention}\n` : ''
  const text = `${mentionPrefix}📅 対応期日のお知らせ（${targetDate}・残り${settings.days_before}日）\n${lines.join('\n')}`

  const sent = await sendSlackMessage(settings.slack_webhook_url, text)
  if (!sent) return

  // 送信成功後、対象のdeal_milestones/dealsにnotified_at相当を記録して重複送信を防ぐ（修正7）
  const now = new Date().toISOString()
  await Promise.all([
    milestones.length > 0
      ? admin.from('deal_milestones').update({ notified_at: now }).in('id', milestones.map((m) => m.id))
      : Promise.resolve(),
    deals.length > 0
      ? admin.from('deals').update({ close_date_alert_notified_at: now }).in('id', deals.map((d) => d.id))
      : Promise.resolve(),
  ])
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: settingsList, error } = await admin
    .from('division_notification_settings')
    .select('division_id, slack_webhook_url, slack_mention, days_before, enabled')
    .eq('enabled', true)

  if (error) {
    // 022マイグレーション未適用等。cronの異常終了はVercel側で検知できるようエラーを返す
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results = await Promise.allSettled(
    ((settingsList ?? []) as NotificationSettingsRow[]).map((s) => processDivision(admin, s))
  )
  const failed = results.filter((r) => r.status === 'rejected').length

  return NextResponse.json({ ok: true, divisions: settingsList?.length ?? 0, failed })
}
