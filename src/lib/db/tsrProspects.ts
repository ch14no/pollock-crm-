import { getSupabase } from './client'

// TSRソーシングリスト（053〜062）。
// 一覧・件数は DB 関数 tsr_search / tsr_search_count（062、SECURITY DEFINER）で取る。
// 当初は PostgREST から tsr_prospects_view を直接読んでいたが、Postgres の LIKE が leakproof で
// ないため RLS が効く状態では商号の索引が使えず（46万行の全件走査＝8秒タイムアウト）、
// 関数の中で所属を検査してから RLS の外で検索する方式に変えた。
// 絞り込み条件の解釈（検索語の正規化・年齢→生年月日キー変換・優先度→rank）は DB 側
// tsr_search_where() に一本化されている。ここでは条件を JSON で渡すだけ。

export type TsrPriority = 'S' | 'A' | 'B' | '不明'

export const TSR_STATUSES = ['リスト投入', '未接触', 'DM送付済', '架電済', '反応あり', '面談設定', '対象外'] as const
export const TSR_APPROACH_TYPES = ['DM', '電話', '紹介', 'イベント', 'その他'] as const

export interface TsrProspect {
  tsr_code: string
  division_id: string
  listing_code: string | null
  listing_name: string | null
  name: string
  name_kana: string | null
  surveyed_on: string | null
  postal_code: string | null
  address: string | null
  prefecture: string | null
  phone: string | null
  phone_digits: string | null
  established_year: number | null
  established_month: number | null
  capital_thousand_yen: number | null
  employee_count: number | null
  industry1_code: string | null
  industry1_name: string | null
  industry2_code: string | null
  industry2_name: string | null
  industry3_code: string | null
  industry3_name: string | null
  business_description: string | null
  officers: string | null
  major_shareholders: string | null
  branches: string | null
  suppliers: string | null
  customers: string | null
  banks: string | null
  overview: string | null
  fy1_closing: string | null
  fy1_sales: number | null
  fy1_profit: number | null
  fy2_closing: string | null
  fy2_sales: number | null
  fy2_profit: number | null
  fy3_closing: string | null
  fy3_sales: number | null
  fy3_profit: number | null
  sales_cagr: number | null
  profit_margin: number | null
  approach_type: string | null
  owner_user_id: string | null
  last_contact_on: string | null
  status: string
  memo: string | null
  company_id: string | null
  source_files: string[]
  imported_at: string
  updated_at: string
  // 個人情報（tsr_prospect_personal。CSV出力で「含めない」を選んだときは NULL で返る）
  rep_name: string | null
  rep_name_kana: string | null
  rep_home_address: string | null
  rep_birth_year: number | null
  rep_birth_month: number | null
  rep_birth_day: number | null
  rep_birth_key: number | null   // YYYYMMDD（055、年齢順の並び替え用）
  rep_birthplace: string | null
  rep_school: string | null
  // ビューの算出列
  rep_age: number | null
  data_age_years: number | null
  priority_rank: number
  approach_priority: TsrPriority
}

// 個人情報を含めない出力で NULL になる列（CSV のヘッダ等で参照する）
export const TSR_PERSONAL_COLUMNS = ['rep_name', 'rep_name_kana', 'rep_home_address', 'rep_birth_year', 'rep_birth_month', 'rep_birth_day', 'rep_birth_key', 'rep_birthplace', 'rep_school'] as const
export type TsrProspectPublic = Omit<TsrProspect, (typeof TSR_PERSONAL_COLUMNS)[number]>

// 絞り込み条件。キー名は DB 側 tsr_search_where() と同じ（062）
export interface TsrFilters {
  query?: string
  prefecture?: string
  industryCode?: string          // 4桁または先頭1〜3桁（前方一致。業種1〜3のいずれか）
  employeesMin?: number; employeesMax?: number
  capitalMin?: number; capitalMax?: number        // 千円
  salesMin?: number; salesMax?: number            // 千円（直近期）
  ageMin?: number; ageMax?: number
  priority?: TsrPriority
  status?: string
  ownerUserId?: string
  surveyedYear?: number
  promoted?: 'yes' | 'no'
}

export type TsrSortKey = 'priority' | 'sales_desc' | 'age_desc' | 'surveyed_desc' | 'name'

export interface TsrSearchResult {
  rows: TsrProspect[]
  total: number        // 件数（通常は正確。正確な件数が取れなかったときは概算）
  totalIsExact: boolean
  hasMore: boolean     // 次のページが実在するか（pageSize+1件目の有無で判定した確定値）
}

// undefined / 空文字のキーを落として JSON にする（DB 側は「キーが無い＝条件なし」）
function toRpcFilters(f: TsrFilters): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === '') continue
    out[k] = v as string | number
  }
  return out
}

export async function searchTsrProspects(
  divisionId: string,
  filters: TsrFilters,
  opts: { page: number; pageSize?: number; sort?: TsrSortKey },
): Promise<TsrSearchResult> {
  const pageSize = opts.pageSize ?? 50
  const from = opts.page * pageSize
  const supabase = getSupabase()
  const f = toRpcFilters(filters)
  // 「次のページがあるか」は件数ではなく 1 件余分に取って判定する。件数は別の関数で並行して数える
  const [pageRes, countRes] = await Promise.all([
    supabase.rpc('tsr_search', { p_division_id: divisionId, p_filters: f, p_sort: opts.sort ?? 'priority', p_limit: pageSize + 1, p_offset: from, p_include_personal: true }),
    supabase.rpc('tsr_search_count', { p_division_id: divisionId, p_filters: f }),
  ])
  if (pageRes.error) throw pageRes.error
  const fetched = (pageRes.data ?? []) as unknown as TsrProspect[]
  const hasMore = fetched.length > pageSize
  const rows = hasMore ? fetched.slice(0, pageSize) : fetched

  const exact = countRes.error ? null : Number(countRes.data)
  if (exact != null && Number.isFinite(exact)) {
    return { rows, total: exact, totalIsExact: true, hasMore }
  }
  // 件数が取れなかった（タイムアウト等）: 最終ページなら実数で確定、途中なら「少なくとも次ページ1件目まで」
  if (countRes.error) console.warn('tsr count failed', countRes.error.message)
  return { rows, total: hasMore ? from + pageSize + 1 : from + rows.length, totalIsExact: !hasMore, hasMore }
}

// CSV出力用。絞り込み結果を1,000件ずつ取得し、上限（既定20,000件）で打ち切る。
// includePersonal=false のときは個人情報の列が NULL で返る（DB 側で落とす）
export async function fetchTsrProspectsForExport(
  divisionId: string,
  filters: TsrFilters,
  opts: { sort?: TsrSortKey; max?: number; includePersonal: boolean; onProgress?: (n: number) => void },
): Promise<{ rows: TsrProspectPublic[]; truncated: boolean }> {
  const max = opts.max ?? 20000
  const chunk = 1000
  const f = toRpcFilters(filters)
  const rows: TsrProspectPublic[] = []
  // 上限ちょうどの件数を「打ち切り」と誤報しないよう、max+1件目まで取りに行って判定する
  for (let from = 0; from <= max; from += chunk) {
    const limit = Math.min(chunk, max + 1 - from)
    const { data, error } = await getSupabase().rpc('tsr_search', {
      p_division_id: divisionId, p_filters: f, p_sort: opts.sort ?? 'priority', p_limit: limit, p_offset: from, p_include_personal: opts.includePersonal,
    })
    if (error) throw error
    const page = (data ?? []) as unknown as TsrProspectPublic[]
    rows.push(...page)
    opts.onProgress?.(Math.min(rows.length, max))
    if (page.length < limit) break
  }
  if (rows.length > max) return { rows: rows.slice(0, max), truncated: true }
  return { rows, truncated: false }
}

export interface TsrIndustryOption { code: string; name: string | null; company_count: number }

// 業種の選択肢はマテリアライズドビュー（取込スクリプトが REFRESH する）
export async function fetchTsrIndustryOptions(divisionId: string): Promise<TsrIndustryOption[]> {
  const { data, error } = await getSupabase()
    .from('tsr_industry_options').select('code,name,company_count').eq('division_id', divisionId)
    .order('company_count', { ascending: false }).limit(2000)
  if (error) throw error
  return (data ?? []) as TsrIndustryOption[]
}

export async function updateTsrProspectOps(tsrCode: string, updates: {
  approachType?: string | null; ownerUserId?: string | null; lastContactOn?: string | null; status?: string; memo?: string | null
}): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (updates.approachType !== undefined) patch.approach_type = updates.approachType
  if (updates.ownerUserId !== undefined) patch.owner_user_id = updates.ownerUserId
  if (updates.lastContactOn !== undefined) patch.last_contact_on = updates.lastContactOn
  if (updates.status !== undefined) patch.status = updates.status
  if (updates.memo !== undefined) patch.memo = updates.memo
  // .select()で更新件数を確認し、RLS拒否の0件更新を「保存できたように見える」状態にしない
  const { data, error } = await getSupabase().from('tsr_prospects').update(patch).eq('tsr_code', tsrCode).select('tsr_code')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('更新が保存されませんでした（編集権限がないか、対象が存在しません）')
}

// 個人情報の閲覧記録（Pマーク要件）。画面で代表者情報を表示したときに1社ずつ残す。
// 失敗しても画面操作は止めない
export function logTsrProspectView(tsrCode: string, userId: string): void {
  void getSupabase().from('tsr_prospect_view_logs').insert({ tsr_code: tsrCode, user_id: userId, action: 'view' }).then(({ error }) => {
    if (error) console.warn('tsr view log failed', error.message)
  })
}

// 個人情報を含むCSV出力の記録。何件・どの絞り込み条件で出したかを残す。
// 出力自体はこの記録が書けた後にだけ行う（記録なしで個人情報が外に出ないようにする）
export async function logTsrProspectExport(userId: string, rowCount: number, filters: TsrFilters): Promise<void> {
  const { error } = await getSupabase().from('tsr_prospect_view_logs')
    .insert({ tsr_code: null, user_id: userId, action: 'export', row_count: rowCount, detail: { filters: toRpcFilters(filters) } })
  if (error) throw new Error(`出力記録の保存に失敗したため出力を中止しました: ${error.message}`)
}

export interface TsrPrioritySettings {
  s_min_age: number
  s_min_sales_thousand_yen: number
  a_min_age: number
  a2_min_age: number
  a2_min_sales_thousand_yen: number
}

export const TSR_PRIORITY_DEFAULTS: TsrPrioritySettings = {
  s_min_age: 65, s_min_sales_thousand_yen: 100000, a_min_age: 65, a2_min_age: 60, a2_min_sales_thousand_yen: 300000,
}

export async function fetchTsrPrioritySettings(divisionId: string): Promise<TsrPrioritySettings | null> {
  const { data, error } = await getSupabase().from('tsr_priority_settings')
    .select('s_min_age,s_min_sales_thousand_yen,a_min_age,a2_min_age,a2_min_sales_thousand_yen')
    .eq('division_id', divisionId).maybeSingle()
  if (error) throw error
  return (data as TsrPrioritySettings) ?? null
}

export async function upsertTsrPrioritySettings(divisionId: string, values: TsrPrioritySettings, userId: string | undefined): Promise<void> {
  const { error } = await getSupabase().from('tsr_priority_settings')
    .upsert({ division_id: divisionId, ...values, updated_by: userId ?? null, updated_at: new Date().toISOString() })
  if (error) throw error
}

// 優先度は tsr_prospects.priority_rank に保存されている（054）。判定条件を変えたら再計算する。
// 46万社を1回の呼び出しで処理すると PostgREST の 8 秒タイムアウトに掛かるため、企業コード順に
// 区切って呼ぶ（058 の tsr_recompute_priority_chunk）。本番実測（Nano・キャッシュ冷え）で
// 1万社 10.8 秒だったため 2,000 社（約2秒）にしている。戻り値は更新件数の合計
export async function recomputeTsrPriority(
  divisionId: string,
  onProgress?: (processed: number, updated: number) => void,
): Promise<number> {
  const CHUNK = 2000
  let after = ''
  let processed = 0
  let updated = 0
  for (let i = 0; i < 1000; i++) {
    const { data, error } = await getSupabase().rpc('tsr_recompute_priority_chunk', { p_division_id: divisionId, p_after: after, p_limit: CHUNK })
    if (error) throw error
    const row = (Array.isArray(data) ? data[0] : data) as { next_code: string | null; processed: number; updated: number } | null
    if (!row) break
    processed += row.processed
    updated += row.updated
    onProgress?.(processed, updated)
    if (!row.next_code || row.processed === 0) break
    after = row.next_code
  }
  return updated
}

// 「CRMに登録」: 会社マスタに昇格させ、リスト側と相互に紐づける。昇格済みなら既存IDを返す。
// 「既存会社との突き合わせ→会社の作成または空欄補完→リスト側の紐づけ」は1つのトランザクション
// でないと、同時操作で会社が二重にできたり、途中失敗で宙に浮いた会社が残ったりする
// （035 replace_pipeline_stages・039 create_task_kanban_tab と同じくRPCに閉じ込める）。
// 突き合わせの規則・RLSとの関係は 053 の promote_tsr_prospect() を参照
export async function promoteTsrProspectToCompany(p: TsrProspect): Promise<string> {
  if (p.company_id) return p.company_id
  const { data, error } = await getSupabase().rpc('promote_tsr_prospect', { p_tsr_code: p.tsr_code })
  if (error) throw error
  if (typeof data !== 'string' || !data) throw new Error('会社の登録結果を受け取れませんでした')
  return data
}
