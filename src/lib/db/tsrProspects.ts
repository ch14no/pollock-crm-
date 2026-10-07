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
  company_linked_at: string | null   // companies と紐づけた日時（064）
  source: 'tsr' | 'manual'           // 'manual' = 手動登録の会社（TSR 由来の業績等は無い）（064）
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
  contact_count: number          // 同事業部の担当者数（067）
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
  source?: 'tsr' | 'manual'      // 出所（TSR / 手動登録）（064）
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

// ─── 会社ページ（/sourcing/[tsrCode]）用 ─────────────────────────
// 1件取得。主キー等値（tsr_code）なので RLS 下でも索引が効く（LIKE の leakproof 問題は無関係）
export async function fetchTsrProspect(tsrCode: string): Promise<TsrProspect | null> {
  const { data, error } = await getSupabase().from('tsr_prospects_view').select('*').eq('tsr_code', tsrCode).maybeSingle()
  if (error) throw error
  return (data as TsrProspect | null) ?? null
}

export interface TsrNewContactInput {
  name: string
  position?: string
  email?: string
  phone?: string
  mobile?: string
  department?: string
  notes?: string
  assignedUserId?: string
}

// 名刺管理「＋担当者を追加」。会社行がまだ companies に無ければ RPC 側で作り（promote_tsr_prospect）、
// 担当者と M&A 項目（contact_custom_values）を 1 トランザクションで登録する（066 tsr_add_contact）。
// customValues は { field_id: value }
export async function addTsrProspectContact(tsrCode: string, input: TsrNewContactInput, customValues: Record<string, string>): Promise<string> {
  const contact: Record<string, unknown> = {
    name: input.name, position: input.position, email: input.email, phone: input.phone,
    department: input.department, notes: input.notes, assignedUserId: input.assignedUserId,
    customAttributes: input.mobile ? { mobile: input.mobile } : {},
  }
  const { data, error } = await getSupabase().rpc('tsr_add_contact', { p_tsr_code: tsrCode, p_contact: contact, p_custom_values: customValues })
  if (error) throw error
  if (typeof data !== 'string' || !data) throw new Error('担当者の登録結果を受け取れませんでした')
  return data
}

export interface TsrManualCompanyInput {
  name: string
  nameKana?: string
  address?: string
  phone?: string
  prefecture?: string
  representative?: string
  representativeKana?: string
  note?: string
}

// 「＋会社を追加」（TSR に無い会社・個人事業主）。companies 行と手動登録の行を作り、企業コード（'M…'）を返す
export async function createManualTsrCompany(divisionId: string, input: TsrManualCompanyInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('tsr_create_manual_prospect', { p_division_id: divisionId, p_company_id: null, p_company: input, p_batch_id: null })
  if (error) throw error
  if (typeof data !== 'string' || !data) throw new Error('会社の登録結果を受け取れませんでした')
  return data
}

// 既存の会社（companies）を手動登録の行として一覧に載せる（既にあればそのコード）
export async function ensureManualProspectForCompany(divisionId: string, companyId: string): Promise<string> {
  const { data, error } = await getSupabase().rpc('tsr_create_manual_prospect', { p_division_id: divisionId, p_company_id: companyId, p_company: null, p_batch_id: null })
  if (error) throw error
  return data as string
}

// 手動登録の行のコード（会社IDから）。突合確認の「統合」で使う
export async function fetchManualProspectCode(divisionId: string, companyId: string): Promise<string | null> {
  const { data, error } = await getSupabase().from('tsr_prospects').select('tsr_code')
    .eq('division_id', divisionId).eq('company_id', companyId).eq('source', 'manual').maybeSingle()
  if (error) throw error
  return (data?.tsr_code as string | undefined) ?? null
}

export interface CompanyContactCountByDivision { division_id: string; division_name: string; n: number }
export async function fetchCompanyContactCountsByDivision(companyId: string): Promise<CompanyContactCountByDivision[]> {
  const { data, error } = await getSupabase().rpc('company_contact_counts_by_division', { p_company_id: companyId })
  if (error) throw error
  return (data ?? []) as CompanyContactCountByDivision[]
}

// ─── 突合（顧客→会社）の確認画面用（066） ─────────────────────────
export type TsrMergeStatus = 'pending' | 'linked' | 'rejected' | 'manual'
export type TsrMergeReason = 'phone' | 'phone_multi' | 'name_unique_addr' | 'name_unique_pref' | 'name_only' | 'name_multi' | 'manual_dup' | 'manual_pick' | 'none'

export const TSR_MERGE_REASON_LABEL: Record<TsrMergeReason, string> = {
  phone: '電話番号が一致', phone_multi: '電話番号が一致（複数社）',
  name_unique_addr: '商号が一意に一致＋住所一致', name_unique_pref: '商号が一意に一致＋都道府県一致',
  name_only: '商号のみ一致（裏取りなし）', name_multi: '同名の会社が複数',
  manual_dup: '手動登録とTSRの重複', manual_pick: '手動で紐づけ', none: 'TSRに一致なし',
}

export interface TsrMergeCandidate {
  id: string
  division_id: string
  company_id: string
  tsr_code: string | null
  match_reason: TsrMergeReason
  score: number
  status: TsrMergeStatus
  contact_count: number
  applied_batch_id: string | null
  decided_at: string | null
  created_at: string
  companies: { id: string; name: string; address: string | null; phone: string | null; prefecture: string | null } | null
  tsr_prospects: { tsr_code: string; name: string; address: string | null; phone: string | null; prefecture: string | null; source: string } | null
}

export async function fetchTsrMergeCandidates(divisionId: string, status?: TsrMergeStatus): Promise<TsrMergeCandidate[]> {
  let q = getSupabase().from('tsr_merge_candidates')
    .select('id,division_id,company_id,tsr_code,match_reason,score,status,contact_count,applied_batch_id,decided_at,created_at,companies(id,name,address,phone,prefecture),tsr_prospects(tsr_code,name,address,phone,prefecture,source)')
    .eq('division_id', divisionId)
    .order('score', { ascending: false }).order('created_at', { ascending: true })
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as unknown as TsrMergeCandidate[]
}

export interface TsrMergeScanResult { batch_id: string; companies_scanned: number; auto_linkable: number; needs_review: number; unmatched: number; manual_dups: number }
export interface TsrMergeApplyResult { batch_id: string; linked: number; manualized: number; skipped: number }

function firstRow<T>(data: unknown): T {
  return (Array.isArray(data) ? data[0] : data) as T
}

export async function scanTsrMerge(divisionId: string): Promise<TsrMergeScanResult> {
  const { data, error } = await getSupabase().rpc('tsr_merge_scan', { p_division_id: divisionId })
  if (error) throw error
  return firstRow<TsrMergeScanResult>(data)
}
export async function applyTsrMergeAuto(divisionId: string, dryRun: boolean): Promise<TsrMergeApplyResult> {
  const { data, error } = await getSupabase().rpc('tsr_merge_apply_auto', { p_division_id: divisionId, p_dry_run: dryRun })
  if (error) throw error
  return firstRow<TsrMergeApplyResult>(data)
}
export async function linkTsrMerge(divisionId: string, companyId: string, tsrCode: string): Promise<void> {
  const { error } = await getSupabase().rpc('tsr_merge_link', { p_division_id: divisionId, p_company_id: companyId, p_tsr_code: tsrCode, p_batch_id: null })
  if (error) throw error
}
export async function unlinkTsrMerge(divisionId: string, tsrCode: string): Promise<void> {
  const { error } = await getSupabase().rpc('tsr_merge_unlink', { p_division_id: divisionId, p_tsr_code: tsrCode })
  if (error) throw error
}
export async function rejectTsrMerge(candidateId: string): Promise<void> {
  const { error } = await getSupabase().rpc('tsr_merge_reject', { p_candidate_id: candidateId })
  if (error) throw error
}
export async function markTsrMergeManual(divisionId: string, companyId: string): Promise<string> {
  const { data, error } = await getSupabase().rpc('tsr_merge_mark_manual', { p_division_id: divisionId, p_company_id: companyId, p_batch_id: null })
  if (error) throw error
  return data as string
}
export async function mergeManualIntoTsr(divisionId: string, manualCode: string, tsrCode: string): Promise<void> {
  const { error } = await getSupabase().rpc('tsr_merge_manual_into_tsr', { p_division_id: divisionId, p_manual_code: manualCode, p_tsr_code: tsrCode })
  if (error) throw error
}
export async function rollbackTsrMerge(divisionId: string, batchId: string): Promise<{ unlinked: number; manual_deleted: number }> {
  const { data, error } = await getSupabase().rpc('tsr_merge_rollback', { p_division_id: divisionId, p_batch_id: batchId })
  if (error) throw error
  return firstRow<{ unlinked: number; manual_deleted: number }>(data)
}
