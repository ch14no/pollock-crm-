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

function checkServiceKey(): NextResponse | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey || serviceKey.length < 50) {
    return NextResponse.json({
      error: 'サーバー設定エラー: SUPABASE_SERVICE_ROLE_KEY がVercelに設定されていません。Vercel → Settings → Environment Variables で追加してください。'
    }, { status: 500 })
  }
  return null
}

// POST: 事業部作成
export async function POST(req: NextRequest) {
  if (!await verifySuperAdmin(req)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }
  const keyError = checkServiceKey()
  if (keyError) return keyError
  const { name, colorCode } = await req.json() as { name: string; colorCode?: string }
  if (!name) {
    return NextResponse.json({ error: '事業部名が必要です' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('divisions')
    .insert({ name, color_code: colorCode ?? null })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}

// PUT: 事業部更新（名前・カラー）
export async function PUT(req: NextRequest) {
  if (!await verifySuperAdmin(req)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }
  const { id, name, colorCode } = await req.json() as { id: string; name?: string; colorCode?: string }
  if (!id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 })

  const updates: Record<string, string> = {}
  if (name !== undefined) updates.name = name
  if (colorCode !== undefined) updates.color_code = colorCode

  if (Object.keys(updates).length > 0) {
    const keyError = checkServiceKey()
    if (keyError) return keyError
    const admin = createAdminClient()
    const { error } = await admin.from('divisions').update(updates).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// 参照件数カウント（service roleでRLSをバイパスし正確な件数を返す）
async function countReferences(admin: ReturnType<typeof createAdminClient>, id: string) {
  const [contactsRes, dealsRes, tossupsFromRes, tossupsToRes] = await Promise.all([
    admin.from('contacts').select('id', { count: 'exact', head: true }).eq('division_id', id),
    admin.from('deals').select('id', { count: 'exact', head: true }).eq('division_id', id),
    admin.from('tossups').select('id', { count: 'exact', head: true }).eq('from_division_id', id),
    admin.from('tossups').select('id', { count: 'exact', head: true }).eq('to_division_id', id),
  ])
  if (contactsRes.error) throw contactsRes.error
  if (dealsRes.error) throw dealsRes.error
  if (tossupsFromRes.error) throw tossupsFromRes.error
  if (tossupsToRes.error) throw tossupsToRes.error

  const contacts = contactsRes.count ?? 0
  const deals = dealsRes.count ?? 0
  const tossups = (tossupsFromRes.count ?? 0) + (tossupsToRes.count ?? 0)
  return { contacts, deals, tossups }
}

// GET: 削除前の参照件数チェック（確認ダイアログ表示のための事前チェック用）
export async function GET(req: NextRequest) {
  if (!await verifySuperAdmin(req)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }
  const keyError = checkServiceKey()
  if (keyError) return keyError
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 })

  try {
    const admin = createAdminClient()
    const { contacts, deals, tossups } = await countReferences(admin, id)
    return NextResponse.json({ contacts, deals, tossups, deletable: contacts === 0 && deals === 0 && tossups === 0 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

// DELETE: 事業部削除（参照チェック→削除を同一リクエスト内で実行。TOCTOU縮小のため最終判定はここで行う）
export async function DELETE(req: NextRequest) {
  if (!await verifySuperAdmin(req)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }
  const keyError = checkServiceKey()
  if (keyError) return keyError
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 })

  const admin = createAdminClient()

  let contacts: number, deals: number, tossups: number
  try {
    ;({ contacts, deals, tossups } = await countReferences(admin, id))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  if (contacts > 0 || deals > 0 || tossups > 0) {
    const parts: string[] = []
    if (contacts > 0) parts.push(`顧客${contacts}件`)
    if (deals > 0) parts.push(`商談${deals}件`)
    if (tossups > 0) parts.push(`トスアップ${tossups}件`)
    return NextResponse.json({
      error: `この事業部には${parts.join('・')}が紐づいているため削除できません`,
      details: { contacts, deals, tossups },
    }, { status: 400 })
  }

  const { error: deleteError } = await admin.from('divisions').delete().eq('id', id)
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
