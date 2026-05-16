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
  const { name, email, password, role } = await req.json() as {
    name: string; email: string; password: string; role: string
  }
  if (!name || !email || !password || !role) {
    return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 })
  }

  // サービスロールキーの診断
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
  // トリガーが自動挿入する場合があるため upsert で対応
  const { error: dbError } = await admin
    .from('users')
    .upsert({ id: userId, name, email, role }, { onConflict: 'id' })
  if (dbError) {
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  return NextResponse.json({ id: userId, name, email, role }, { status: 201 })
}

// PUT: ユーザー更新（名前・ロール・パスワード）
export async function PUT(req: NextRequest) {
  if (!await verifySuperAdmin(req)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }
  const { id, name, role, password } = await req.json() as {
    id: string; name?: string; role?: string; password?: string
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
