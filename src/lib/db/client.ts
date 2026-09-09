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

// PostgRESTの1リクエストあたり返却件数の上限（db-max-rows、プロジェクト設定）。
// 2026-09-09本番実測で1000件だったが、将来サーバー側の設定が変わることがあるため、
// 「要求件数未満のページ＝最後」とは判定しない（下記2関数のコメント参照）。
// ここは各クエリの.limit()に渡す既定値としてのみ使う
export const DEFAULT_PAGE_SIZE = 1000

// PostgRESTは1リクエストあたりの返却件数がプロジェクト設定（db-max-rows）でサーバー側に
// ハードキャップされており、クライアント側の.limit()を大きくしても超えられない
// （2026-09-09本番実測：上限1000件。ORDER BYの並び順でちょうどページの切れ目より後ろに
// 来た行が、エラーも出さずに検索候補から消える形で発覚した）。ハードコードした閾値に
// 依存せず、ページが規定サイズ未満になるまで.range()で全件をたぐる。
// 「実際に何件返ってきたか」でfromを進め、要求サイズ未満のページが来ても最後とは
// 決め打たず、真に0件のページが返るまで続ける（サーバー側の上限がpageSizeより
// 小さい値に変わっても、途中の行を静かに読み飛ばさないようにするため）
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = DEFAULT_PAGE_SIZE
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const page = await fetchPage(from, from + pageSize - 1)
    if (page.length === 0) break
    all.push(...page)
    from += page.length
  }
  return all
}

// OFFSET(.range())方式は、ページ取得の合間に対象データが増減すると、既に読んだ
// 範囲がズレて行を取りこぼす・重複させることがある。不変列（通常はid）へのカーソル
// 方式なら、実際に見た最後の値を基準に次を取りに行くため、その種のズレは起きない
// （※完全に無敵ではない: 取得中にカーソルより手前の値でinsertされた行までは
// 拾えない。UUIDはランダムなので稀にしか起きず、次に開いたときには反映される
// 実害の小さいギャップとして許容している）。
// fetchAllPagesと同じ理由（サーバー側のdb-max-rowsが将来pageSizeより小さくなる
// 可能性）から、要求件数未満のページが来ても最後とは決め打たず、真に0件のページが
// 返るまで続ける
export async function fetchAllByCursor<T>(
  fetchPage: (afterId: string | null) => Promise<T[]>,
  getId: (row: T) => string
): Promise<T[]> {
  const all: T[] = []
  let afterId: string | null = null
  for (;;) {
    const page = await fetchPage(afterId)
    if (page.length === 0) break
    all.push(...page)
    afterId = getId(page[page.length - 1])
  }
  return all
}
