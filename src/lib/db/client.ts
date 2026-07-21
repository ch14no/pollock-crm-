import { createBrowserClient } from '@supabase/ssr'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSupabase(): ReturnType<typeof createBrowserClient<any>> {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// デモモード判定（URLがplaceholderなら mock データを使う）
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('placeholder')
}

// .in() フィルタに渡すIDリストの分割単位。
// PostgRESTのGETはIDをURLに埋め込むため、UUID約650件（URL約24KB）を超えると
// ゲートウェイが 400 Bad Request で弾く（2026-07-21 本番実測。エラー画面は出ず
// 一覧が静かに空になるため、事業部の顧客数が増えると気づけない）。
// 余裕を持って200件ずつに分割して取得する。
export const IN_FILTER_CHUNK = 200

export function chunkIdList(ids: string[], size: number = IN_FILTER_CHUNK): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size))
  return chunks
}
