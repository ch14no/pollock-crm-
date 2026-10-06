import { getSupabase } from './client'

// TSRソーシングリスト（053）。一覧・詳細は tsr_prospects_view（年齢・経過年数・優先度を
// 算出済み、基表のRLSがそのまま効く）を読む。46万件のため常にサーバー側で絞り込み、
// 全件をクライアントに持ってこない（既存の会社検索＝全件ロード方式は使わない）。

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
  // 個人情報（tsr_prospect_personal。権限が無いユーザーには行が見えないためnull）
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

// 個人情報を除いた列。CSV出力で「個人情報を含めない」を選んだときはこの列だけを取得し、
// 不要な個人情報をそもそもブラウザまで持ってこない
const TSR_PERSONAL_COLUMNS = ['rep_name', 'rep_name_kana', 'rep_home_address', 'rep_birth_year', 'rep_birth_month', 'rep_birth_day', 'rep_birth_key', 'rep_birthplace', 'rep_school'] as const
const TSR_PUBLIC_COLUMNS = [
  'tsr_code', 'division_id', 'listing_code', 'listing_name', 'name', 'name_kana', 'surveyed_on', 'postal_code', 'address', 'prefecture', 'phone', 'phone_digits',
  'established_year', 'established_month', 'capital_thousand_yen', 'employee_count',
  'industry1_code', 'industry1_name', 'industry2_code', 'industry2_name', 'industry3_code', 'industry3_name',
  'business_description', 'officers', 'major_shareholders', 'branches', 'suppliers', 'customers', 'banks', 'overview',
  'fy1_closing', 'fy1_sales', 'fy1_profit', 'fy2_closing', 'fy2_sales', 'fy2_profit', 'fy3_closing', 'fy3_sales', 'fy3_profit',
  'sales_cagr', 'profit_margin', 'approach_type', 'owner_user_id', 'last_contact_on', 'status', 'memo', 'company_id',
  'source_files', 'imported_at', 'updated_at', 'rep_age', 'data_age_years', 'priority_rank', 'approach_priority',
] as const
const TSR_SELECT_PUBLIC = TSR_PUBLIC_COLUMNS.join(',')
const TSR_SELECT_FULL = [...TSR_PUBLIC_COLUMNS, ...TSR_PERSONAL_COLUMNS].join(',')

export type TsrProspectPublic = Omit<TsrProspect, (typeof TSR_PERSONAL_COLUMNS)[number]>

export interface TsrFilters {
  query?: string
  prefecture?: string
  industryCode?: string          // 4桁または先頭2〜3桁（前方一致。業種1〜3のいずれか）
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
  total: number     // 概算を含む件数（ページ送りの表示用）
  hasMore: boolean  // 次のページが実在するか（pageSize+1件目の有無で判定した確定値）
}

// PostgREST の or() フィルタはカンマ・括弧・引用符を構文として解釈するため、検索語からは除く。
// `%` `_` `*` は LIKE のワイルドカードなので同様に除く。NFKC 正規化（半角カナ→全角、全角英数→半角）
// と大文字化は DB側の検索用列 name_core / name_kana_core（057/058 の tsr_name_core）と同じ規則
function sanitizeQuery(q: string): string {
  return q.normalize('NFKC').toUpperCase().replace(/[,()"\\%_*]/g, ' ').trim()
}

// 検索語から法人格（株式会社・(株)・カブシキガイシャ 等）を取り除く。DB の検索用列
// name_core / name_kana_core は法人格を除いた商号なので、検索語側も同じ規則で揃えないと
// 「株式会社穴吹工務店」と貼り付けたときに 0 件になる。正規表現は tsr_name_core() と同じ
const CORP_LEAD = /^\s*(株式会社|有限会社|合同会社|合資会社|合名会社|医療法人社団|医療法人財団|医療法人|社会福祉法人|社会医療法人|学校法人|宗教法人|一般社団法人|公益社団法人|一般財団法人|公益財団法人|特定非営利活動法人|NPO法人|農事組合法人|企業組合|協同組合|生活協同組合|\(株\)|㈱|\(有\)|㈲|\(同\)|カブシキガイシャ|カブシキカイシャ|ユウゲンガイシャ|ユウゲンカイシャ|ゴウドウガイシャ|ゴウドウカイシャ|イリョウホウジン|シャカイフクシホウジン|ガッコウホウジン|イッパンシャダンホウジン|イッパンザイダンホウジン)\s*/
const CORP_TAIL = /\s*(株式会社|有限会社|合同会社|合資会社|合名会社|\(株\)|㈱|\(有\)|㈲|\(同\)|カブシキガイシャ|カブシキカイシャ|ユウゲンガイシャ|ユウゲンカイシャ|ゴウドウガイシャ|ゴウドウカイシャ)\s*$/
function stripCorporateType(text: string): string {
  return text.replace(CORP_LEAD, '').replace(CORP_TAIL, '').trim()
}

// 優先度（S/A/B/不明）→ 保存列 priority_rank の値。絞り込みは文字列ではなく数値列で行う
// （ビューの approach_priority は式のためインデックスが使えない）
const PRIORITY_RANK: Record<TsrPriority, number> = { S: 0, A: 1, B: 2, '不明': 3 }

// 生年月日キー（YYYYMMDD、055）。年齢 N 歳以上 ⇔ 生年月日 ≦ 今日のN年前。
// 「今日」は DB の CURRENT_DATE（Supabase は UTC）に合わせて UTC で取る（表示年齢・保存済み
// priority_rank と同じ基準にするため）。2/29 の N 年前が平年なら 2/28 に丸める
// （Date.setFullYear は 3/1 に繰り上がってしまい境界が1日ずれる）
function birthKeyYearsAgo(years: number): number {
  const now = new Date()
  const y = now.getUTCFullYear() - years
  const m = now.getUTCMonth() + 1
  let d = now.getUTCDate()
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  if (m === 2 && d === 29 && !isLeap) d = 28
  return y * 10000 + m * 100 + d
}

// 電話番号の表記ゆれ（全角・ハイフン・括弧・空白）を吸収して数字だけにする。
// DB側の tsr_phone_digits() と同じ規則（9桁未満はnull）
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.normalize('NFKC').replace(/\D/g, '')
  return digits.length >= 9 ? digits : null
}

// 検索語が「数字・ハイフン・括弧・空白だけ」なら電話番号／企業コードとして扱う
function isNumericQuery(text: string): boolean {
  return /^[\d\-－‐ー()（）\s+＋]+$/.test(text.normalize('NFKC')) && /\d/.test(text)
}

// supabase-js のフィルタビルダーは select 文字列ごとに別の型になるため、絞り込み・並び替えは
// 共通で使う最小限のメソッドだけを持つ構造的な型で受ける（any を使わない）
interface TsrQueryBuilder<T> {
  eq(column: string, value: unknown): T
  gt(column: string, value: unknown): T
  gte(column: string, value: unknown): T
  lte(column: string, value: unknown): T
  is(column: string, value: null): T
  not(column: string, operator: string, value: unknown): T
  or(filters: string): T
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): T
}

function applyFilters<T extends TsrQueryBuilder<T>>(query: T, f: TsrFilters): T {
  let q = query
  const text = f.query ? sanitizeQuery(f.query) : ''
  if (text) {
    if (isNumericQuery(text)) {
      // 数字だけの検索語: 企業コード（9桁以下。先頭ゼロ落ちも許容）と電話番号（数字化した
      // phone_digits への部分一致）の両方を見る。桁数で決め打ちしない
      const digits = text.normalize('NFKC').replace(/\D/g, '')
      const conds: string[] = []
      if (digits.length >= 1 && digits.length <= 9) conds.push(`tsr_code.eq.${digits.padStart(9, '0')}`)
      if (digits.length >= 4) conds.push(`phone_digits.like.*${digits}*`)
      q = q.or(conds.join(','))
    } else {
      // 商号検索は法人格を除き NFKC・大文字化した列（name_core / name_kana_core、057/058）に対して行う。
      // 検索語も同じ規則で揃える（上の sanitizeQuery と stripCorporateType）。
      // PostgREST の like では `*` がワイルドカード（`%` は URL で問題を起こしやすい）
      const core = stripCorporateType(text) || text
      if ([...core.replace(/\s/g, '')].length <= 2) {
        // 2文字以下は trgm インデックスが原理的に効かない（3文字の塊が取れない）ため前方一致にする
        const prefix = `${core.replace(/\s/g, '')}*`
        q = q.or(`name_core.like.${prefix},name_kana_core.like.${prefix}`)
      } else {
        // 3文字以上は trgm の部分一致（大文字化済みなので like でよい＝索引が使える）
        const like = `*${core}*`
        q = q.or(`name_core.like.${like},name_kana_core.like.${like}`)
      }
    }
  }
  if (f.prefecture) q = q.eq('prefecture', f.prefecture)
  if (f.industryCode) {
    // 4桁（画面の選択肢）は完全一致でbtreeインデックスを使う。2〜3桁の前方一致は将来の拡張用
    const c = f.industryCode
    q = /^\d{4}$/.test(c)
      ? q.or(`industry1_code.eq.${c},industry2_code.eq.${c},industry3_code.eq.${c}`)
      : q.or(`industry1_code.like.${c}*,industry2_code.like.${c}*,industry3_code.like.${c}*`)
  }
  if (f.employeesMin != null) q = q.gte('employee_count', f.employeesMin)
  if (f.employeesMax != null) q = q.lte('employee_count', f.employeesMax)
  if (f.capitalMin != null) q = q.gte('capital_thousand_yen', f.capitalMin)
  if (f.capitalMax != null) q = q.lte('capital_thousand_yen', f.capitalMax)
  if (f.salesMin != null) q = q.gte('fy1_sales', f.salesMin)
  if (f.salesMax != null) q = q.lte('fy1_sales', f.salesMax)
  // 年齢は算出列 rep_age（1行ずつ関数評価で遅い）ではなく、生年月日キーの範囲に変換して絞る。
  // N歳以上 ⇔ キー ≦ 今日のN年前、M歳以下 ⇔ キー ＞ 今日の(M+1)年前。生年月日なしは対象外
  if (f.ageMin != null) q = q.lte('rep_birth_key', birthKeyYearsAgo(f.ageMin))
  if (f.ageMax != null) q = q.gt('rep_birth_key', birthKeyYearsAgo(f.ageMax + 1))
  if (f.priority) q = q.eq('priority_rank', PRIORITY_RANK[f.priority])
  if (f.status) q = q.eq('status', f.status)
  if (f.ownerUserId) q = q.eq('owner_user_id', f.ownerUserId)
  if (f.surveyedYear) q = q.gte('surveyed_on', `${f.surveyedYear}-01-01`).lte('surveyed_on', `${f.surveyedYear}-12-31`)
  if (f.promoted === 'yes') q = q.not('company_id', 'is', null)
  if (f.promoted === 'no') q = q.is('company_id', null)
  return q
}

// 並び順はすべてサーバー側で確定させる（ページ分割・CSV出力でも同じ順になる）。
// 優先度は保存列 priority_rank（S=0 … 不明=3、054）で並べ、同順位は売上の大きい順。
// 年齢順は算出列 rep_age ではなく生年月日キー rep_birth_key（055）で並べる（高い順＝キー昇順）。
//
// textSearch=true（商号・カナ・電話の部分一致あり）のときは、同じ値を持つ「式の列」（*_s）で
// 並べる。インデックス順に全件を舐めながら LIKE で絞る計画（該当が少ないと実質全件走査で
// 10秒超）を避け、先に trgm インデックスで絞ってから少数を並べ替える計画に誘導するため（055）
function applySort<T extends TsrQueryBuilder<T>>(query: T, sort: TsrSortKey, textSearch: boolean): T {
  const s = textSearch ? '_s' : ''
  switch (sort) {
    case 'sales_desc': return query.order(`fy1_sales${s}`, { ascending: false, nullsFirst: false }).order('tsr_code')
    case 'age_desc': return query.order(`rep_birth_key${s}`, { ascending: true, nullsFirst: false }).order('tsr_code')
    case 'surveyed_desc': return query.order(`surveyed_on${s}`, { ascending: false, nullsFirst: false }).order('tsr_code')
    case 'name': return query.order(`name_kana${s}`, { ascending: true, nullsFirst: false }).order('tsr_code')
    case 'priority':
    default:
      return query.order(`priority_rank${s}`, { ascending: true }).order(`fy1_sales${s}`, { ascending: false, nullsFirst: false }).order('tsr_code')
  }
}

function hasTextSearch(f: TsrFilters): boolean {
  return !!(f.query && sanitizeQuery(f.query))
}

export async function searchTsrProspects(
  divisionId: string,
  filters: TsrFilters,
  opts: { page: number; pageSize?: number; sort?: TsrSortKey },
): Promise<TsrSearchResult> {
  const pageSize = opts.pageSize ?? 50
  const from = opts.page * pageSize
  // 件数は estimated（1,000件までは正確、それ以上は統計ベースの概算）で取る。exact は
  // 46万行の全件カウントになり絞り込みのたびに数百msを失う。概算は実際とずれることがある
  // ので「次のページがあるか」は件数ではなく、1件余分に取って判定する
  let q = getSupabase().from('tsr_prospects_view').select(TSR_SELECT_FULL, { count: 'estimated' }).eq('division_id', divisionId)
  q = applyFilters(q, filters)
  q = applySort(q, opts.sort ?? 'priority', hasTextSearch(filters)).range(from, from + pageSize)
  const { data, error, count } = await q
  if (error) throw error
  const fetched = (data ?? []) as unknown as TsrProspect[]
  const hasMore = fetched.length > pageSize
  const rows = hasMore ? fetched.slice(0, pageSize) : fetched
  // 最終ページに達したら実数で確定。途中なら概算と「少なくとも次ページ1件目まで」の大きい方
  const total = hasMore ? Math.max(count ?? 0, from + pageSize + 1) : from + rows.length
  return { rows, total, hasMore }
}

// CSV出力用。絞り込み結果を1,000件ずつ取得し、上限（既定20,000件）で打ち切る。
// includePersonal=false のときは個人情報の列をそもそも要求しない
export async function fetchTsrProspectsForExport(
  divisionId: string,
  filters: TsrFilters,
  opts: { sort?: TsrSortKey; max?: number; includePersonal: boolean; onProgress?: (n: number) => void },
): Promise<{ rows: TsrProspectPublic[]; truncated: boolean }> {
  const max = opts.max ?? 20000
  const chunk = 1000
  const rows: TsrProspectPublic[] = []
  // 上限ちょうどの件数を「打ち切り」と誤報しないよう、max+1件目まで取りに行って判定する
  for (let from = 0; from <= max; from += chunk) {
    const to = Math.min(from + chunk, max + 1) - 1
    let q = getSupabase().from('tsr_prospects_view').select(opts.includePersonal ? TSR_SELECT_FULL : TSR_SELECT_PUBLIC).eq('division_id', divisionId)
    q = applyFilters(q, filters)
    q = applySort(q, opts.sort ?? 'priority', hasTextSearch(filters)).range(from, to)
    const { data, error } = await q
    if (error) throw error
    const page = (data ?? []) as unknown as TsrProspectPublic[]
    rows.push(...page)
    opts.onProgress?.(Math.min(rows.length, max))
    if (page.length < to - from + 1) break
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
    .insert({ tsr_code: null, user_id: userId, action: 'export', row_count: rowCount, detail: { filters } })
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