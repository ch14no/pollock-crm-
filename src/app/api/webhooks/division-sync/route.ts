// ============================================================================
// pollock-cup (departments) → pollock-crm (divisions) 同期用 Webhook 受信エンドポイント
// ============================================================================
// pollock-crm と pollock-cup は別々の Supabase プロジェクトであるため、
// DBトリガーで直接同期することはできない。そのため各プロジェクトの
// Postgres 上で pg_net (net.http_post) を使い、アプリケーションレベルの
// Webhook としてお互いの `/api/webhooks/division-sync` を呼び合う構成にしている。
//
// 同期対象は CREATE と RENAME（name変更）のみ。
// DELETE は同期しない: 事業部の削除は contacts/deals 等の参照整合性に
// 影響するため、片方で削除されたからといってもう片方を自動削除するのは
// リスクが高い。削除された場合、もう片方のレコードは孤立したまま残る
// （害はないが不要になったレコード）。必要であれば人間が手動で整理する。
//
// ループ防止（idempotency）:
// rename時、現在保存されているnameと受信したnameが既に一致する場合は
// 書き込みをスキップする。これにより A→B→A のような無限更新の連鎖を止める。
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

interface DivisionSyncPayload {
  id: string
  name: string
  event: 'create' | 'rename'
}

function checkServiceKey(): NextResponse | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey || serviceKey.length < 50) {
    return NextResponse.json({
      error: 'サーバー設定エラー: SUPABASE_SERVICE_ROLE_KEY がVercelに設定されていません。Vercel → Settings → Environment Variables で追加してください。'
    }, { status: 500 })
  }
  return null
}

function checkSyncSecret(req: NextRequest): NextResponse | null {
  const expected = process.env.DIVISION_SYNC_SECRET
  if (!expected) {
    return NextResponse.json({
      error: 'サーバー設定エラー: DIVISION_SYNC_SECRET がVercelに設定されていません。Vercel → Settings → Environment Variables で追加してください。'
    }, { status: 500 })
  }
  const provided = req.headers.get('x-division-sync-secret')
  if (provided !== expected) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }
  return null
}

// POST: pollock-cup からの事業部同期を受信（create / rename のみ）
export async function POST(req: NextRequest) {
  const secretError = checkSyncSecret(req)
  if (secretError) return secretError
  const keyError = checkServiceKey()
  if (keyError) return keyError

  const { id, name, event } = await req.json() as DivisionSyncPayload
  if (!id || !name || !event) {
    return NextResponse.json({ error: 'id, name, event が必要です' }, { status: 400 })
  }
  if (event !== 'create' && event !== 'rename') {
    return NextResponse.json({ error: 'event は create または rename のみ対応しています' }, { status: 400 })
  }

  const admin = createAdminClient()

  if (event === 'create') {
    const { data: existing, error: selectError } = await admin
      .from('divisions')
      .select('id')
      .eq('id', id)
      .maybeSingle()
    if (selectError) return NextResponse.json({ error: selectError.message }, { status: 500 })

    if (existing) {
      // 既に同じidが存在する（重複INSERT防止）
      return NextResponse.json({ ok: true, skipped: true })
    }

    const { error: insertError } = await admin
      .from('divisions')
      .insert({ id, name })
    if (insertError) {
      if (insertError.code === '23505') {
        // TOCTOU: SELECTとINSERTの間に別リクエストが同じidを先にINSERTした場合。
        // idの重複INSERT防止として扱い、正常終了とする（既に存在するのでOK）。
        return NextResponse.json({ ok: true, skipped: true })
      }
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true }, { status: 201 })
  }

  // event === 'rename'
  const { data: current, error: selectError } = await admin
    .from('divisions')
    .select('name')
    .eq('id', id)
    .maybeSingle()
  if (selectError) return NextResponse.json({ error: selectError.message }, { status: 500 })

  if (!current) {
    // このidは存在しない（未同期、またはこちら側で削除済み）→ 何もせず正常終了
    return NextResponse.json({ ok: true, skipped: true })
  }

  if (current.name === name) {
    // 既に同じ名前 → ループ防止のため書き込みをスキップ
    return NextResponse.json({ ok: true, skipped: true })
  }

  const { error: updateError } = await admin
    .from('divisions')
    .update({ name })
    .eq('id', id)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
