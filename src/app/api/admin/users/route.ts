import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'

// ユーザー自身のJWTでsuper_admin確認（service_role key不要）
async function verifySuperAdmin(req: NextRequest): Promise<boolean> {
  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) return false
    const token = authHeader.slice(7)

    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    )

    // トークンを検証してユーザーを取得
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return false

    // usersテーブルからroleを確認（RLS: 認証済みユーザーはSELECT可）
    const { data, error: dbError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()
    if (dbError || !data) return false

    return data.role === 'super_admin'
  } catch {
    return false
  }
}

// POST: ユーザー作成
export async function POST(req: NextRequest) {
  if (!await verifySuperAdmin(req)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }
  const { name, email, password, role, divisionIds } = await req.json() as {
    name: string; email: string; password: string; role: string; divisionIds?: string[]
  }
  if (!name || !email || !password || !role) {
    return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 })
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey || serviceKey.length < 50) {
    return NextResponse.json({
      error: 'サーバー設定エラー: SUPABASE_SERVICE_ROLE_KEY がVercelに設定されていません。Vercel → Settings → Environment Variables で追加してください。'
    }, { status: 500 })
  }

  const admin = createAdminClient()
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  })
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 })
  }

  const userId = authData.user.id
  const { error: dbError } = await admin
    .from('users')
    .upsert({ id: userId, name, email, role }, { onConflict: 'id' })
  if (dbError) {
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  if (divisionIds && divisionIds.length > 0) {
    // show_as_task_assignee: システム管理者はタスク看板の担当候補一覧から
    // 除外されるのが既定（032）。この画面でチェックした事業部＝表示してよい
    // 事業部という意味を兼ねるため一律trueにする（一般ユーザー・マネージャーは
    // 元々常に表示対象なのでこの値は無視され、実害はない）
    // division_idの重複はPK(user_id,division_id)違反で一括INSERTごと失敗するため除去する
    const uniqueIds = [...new Set(divisionIds)]
    const rows = uniqueIds.map((divId, i) => ({
      user_id: userId, division_id: divId, is_primary: i === 0, show_as_task_assignee: true,
    }))
    const { error: divError } = await admin.from('user_divisions').insert(rows)
    if (divError) {
      // 事業部割当に失敗したら、作成済みのauthユーザー・usersレコードごと
      // ロールバックする（「作成されたが無所属」の中途半端なユーザーを残さない。
      // usersテーブルのdbErrorと同じ方針）
      await admin.from('users').delete().eq('id', userId)
      await admin.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: divError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ id: userId, name, email, role }, { status: 201 })
}

// PUT: ユーザー更新（名前・ロール・パスワード・事業部）
export async function PUT(req: NextRequest) {
  if (!await verifySuperAdmin(req)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }
  const { id, name, role, password, divisionIds } = await req.json() as {
    id: string; name?: string; role?: string; password?: string; divisionIds?: string[]
  }
  if (!id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 })

  const admin = createAdminClient()

  if (password) {
    const { error } = await admin.auth.admin.updateUserById(id, { password })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const updates: Record<string, string> = {}
  if (name) updates.name = name
  if (role) updates.role = role
  if (Object.keys(updates).length > 0) {
    const { error } = await admin.from('users').update(updates).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (divisionIds !== undefined) {
    // 旧実装は「全削除→一括INSERT」だったが、INSERTが失敗（division_id重複・
    // 削除済み事業部への参照等）するとdeleteだけ確定してユーザーが無所属になり、
    // 全データにアクセス不能になる不具合があった。そこで
    // 「望ましい行をupsert → 不要になった行だけ削除」の順に変更し、
    // 途中で失敗しても既存の所属が消えない（無所属化しない）ようにする。
    const uniqueIds = [...new Set(divisionIds)]

    const { data: existing, error: exErr } = await admin
      .from('user_divisions').select('division_id').eq('user_id', id)
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })

    if (uniqueIds.length > 0) {
      // show_as_task_assignee: POSTと同じ理由で一律true（詳細はPOST側のコメント参照）
      const rows = uniqueIds.map((divId, i) => ({
        user_id: id, division_id: divId, is_primary: i === 0, show_as_task_assignee: true,
      }))
      const { error: upErr } = await admin
        .from('user_divisions').upsert(rows, { onConflict: 'user_id,division_id' })
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    }

    // 今回のリストに含まれなくなった事業部の行だけを削除する
    const toDelete = (existing ?? [])
      .map((r) => r.division_id as string)
      .filter((d) => !uniqueIds.includes(d))
    if (toDelete.length > 0) {
      const { error: delErr } = await admin
        .from('user_divisions').delete().eq('user_id', id).in('division_id', toDelete)
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}

// DELETE: ユーザー削除
export async function DELETE(req: NextRequest) {
  if (!await verifySuperAdmin(req)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 })

  const admin = createAdminClient()
  const { error: dbError } = await admin.from('users').delete().eq('id', id)
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  const { error: authError } = await admin.auth.admin.deleteUser(id)
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
