import { getSupabase } from './client'
import type { ContractSignStatus, DealBuyerConditions, DealSellerConditions, DesiredArea, FundingMethod, LossDeficitOk } from '@/types/database'

// 売主・買主の希望条件（M&A事業部要望㉒）。
// supabase/migrations/023_deal_conditions.sql のテーブルを使用する。
// 023未適用の環境では呼び出し側（DealConditionsSection等）がエラーを捕捉してセクションごと隠す。

type RawSellerConditions = {
  deal_id: string; division_id: string
  desired_timing: string | null; desired_scheme: string | null
  desired_price: string | null; desired_price_thousand_yen: number | null
  other_conditions: string | null
  ad_contract_status: string | null; ad_contract_date: string | null
  nda_status: string | null; nda_date: string | null
  updated_at: string
}

export async function fetchSellerConditions(dealId: string): Promise<DealSellerConditions | null> {
  const { data, error } = await getSupabase()
    .from('deal_seller_conditions')
    .select('*')
    .eq('deal_id', dealId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const r = data as RawSellerConditions
  return {
    deal_id: r.deal_id, division_id: r.division_id,
    desired_timing: r.desired_timing ?? undefined,
    desired_scheme: r.desired_scheme ?? undefined,
    desired_price: r.desired_price ?? undefined,
    desired_price_thousand_yen: r.desired_price_thousand_yen ?? undefined,
    other_conditions: r.other_conditions ?? undefined,
    ad_contract_status: (r.ad_contract_status as ContractSignStatus | null) ?? undefined,
    ad_contract_date: r.ad_contract_date ?? undefined,
    nda_status: (r.nda_status as ContractSignStatus | null) ?? undefined,
    nda_date: r.nda_date ?? undefined,
    updated_at: r.updated_at,
  }
}

// 048（AD契・NDA）未適用の環境で、当該カラムが存在しないことに起因するエラーかどうか。
// deals.tsのisMissingColumnError/OPTIONAL_DEAL_COLUMNSと同じ判定基準
// （列不在を示す文言もあわせて要求し、CHECK制約違反等の別エラーとの誤検知を防ぐ）
function isMissingColumnError(error: { message?: string } | null, column: string): boolean {
  const msg = error?.message ?? ''
  return msg.includes(column) && (msg.includes('column') || msg.includes('schema cache'))
}
const OPTIONAL_SELLER_CONDITION_COLUMNS = [
  'ad_contract_status', 'ad_contract_date', 'nda_status', 'nda_date', 'desired_price_thousand_yen',
] as const

export async function upsertSellerConditions(dealId: string, divisionId: string, input: {
  desiredTiming?: string; desiredScheme?: string
  // desired_price（自由記述）は050でdesired_price_thousand_yenに一本化したため、
  // 新規保存では使わない（既存データの読み取り専用表示にのみ残す）
  desiredPriceThousandYen?: number | null
  otherConditions?: string
  adContractStatus?: ContractSignStatus | ''; adContractDate?: string
  ndaStatus?: ContractSignStatus | ''; ndaDate?: string
}): Promise<{ strippedFields: string[] }> {
  const payload: Record<string, unknown> = {
    deal_id: dealId,
    division_id: divisionId,
    desired_timing: input.desiredTiming || null,
    desired_scheme: input.desiredScheme || null,
    other_conditions: input.otherConditions || null,
    ad_contract_status: input.adContractStatus || null,
    ad_contract_date: input.adContractDate || null,
    nda_status: input.ndaStatus || null,
    nda_date: input.ndaDate || null,
  }
  if (input.desiredPriceThousandYen !== undefined) payload.desired_price_thousand_yen = input.desiredPriceThousandYen
  const upsert = (p: Record<string, unknown>) =>
    getSupabase().from('deal_seller_conditions').upsert(p, { onConflict: 'deal_id' }).select('deal_id')

  // .select() を付けないと、RLSに拒否された0件更新でもエラーにならず「保存できたように見えて
  // 実際は保存されていない」状態になるため、更新行を必ず検証する（修正4。updateContactと同じパターン）
  let { data, error } = await upsert(payload)
  // 048（AD契・NDA列）・050（希望価額の数値列）未適用の環境では、その列だけ落として
  // 既存項目の保存を通す（このバンドルupsertは1文のため、未知列が1つでも混ざると
  // 希望譲渡時期等の保存まで巻き添えで失敗する。deals.tsのOPTIONAL_DEAL_COLUMNSと同じ
  // フォールバック方式。複数列同時欠落に対応するためwhileで取りこぼしなく回す）
  const strippedFields: string[] = []
  const remaining = new Set(OPTIONAL_SELLER_CONDITION_COLUMNS)
  while (error && remaining.size > 0) {
    const hit = [...remaining].find((col) => col in payload && isMissingColumnError(error, col))
    if (!hit) break
    delete payload[hit]
    remaining.delete(hit)
    strippedFields.push(hit)
    ;({ data, error } = await upsert(payload))
  }
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('条件が保存されませんでした（編集権限がないか、対象が存在しません）')
  }
  return { strippedFields }
}

type RawBuyerConditions = {
  deal_id: string; division_id: string
  desired_area: string | null; desired_industry: string | null; desired_revenue_size: string | null
  valuation_method: string | null; investment_budget_max: string | null
  loss_deficit_ok: string | null; funding_method: string | null; funding_amount_max: string | null
  key_man_lockup: string | null; audit_by_company: string | null; audit_by_specialist: string | null
  review_period: string | null; approval_flow: string | null
  updated_at: string
}

export async function fetchBuyerConditions(dealId: string): Promise<DealBuyerConditions | null> {
  const { data, error } = await getSupabase()
    .from('deal_buyer_conditions')
    .select('*')
    .eq('deal_id', dealId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const r = data as RawBuyerConditions
  return {
    deal_id: r.deal_id, division_id: r.division_id,
    desired_area: (r.desired_area as DesiredArea | null) ?? undefined,
    desired_industry: r.desired_industry ?? undefined,
    desired_revenue_size: r.desired_revenue_size ?? undefined,
    valuation_method: r.valuation_method ?? undefined,
    investment_budget_max: r.investment_budget_max ?? undefined,
    loss_deficit_ok: (r.loss_deficit_ok as LossDeficitOk | null) ?? undefined,
    funding_method: (r.funding_method as FundingMethod | null) ?? undefined,
    funding_amount_max: r.funding_amount_max ?? undefined,
    key_man_lockup: r.key_man_lockup ?? undefined,
    audit_by_company: r.audit_by_company ?? undefined,
    audit_by_specialist: r.audit_by_specialist ?? undefined,
    review_period: r.review_period ?? undefined,
    approval_flow: r.approval_flow ?? undefined,
    updated_at: r.updated_at,
  }
}

export async function upsertBuyerConditions(dealId: string, divisionId: string, input: {
  desiredArea?: DesiredArea | ''; desiredIndustry?: string; desiredRevenueSize?: string
  valuationMethod?: string; investmentBudgetMax?: string
  lossDeficitOk?: LossDeficitOk | ''; fundingMethod?: FundingMethod | ''; fundingAmountMax?: string
  keyManLockup?: string; auditByCompany?: string; auditBySpecialist?: string
  reviewPeriod?: string; approvalFlow?: string
}): Promise<void> {
  // .select() を付けないと、RLSに拒否された0件更新でもエラーにならず「保存できたように見えて
  // 実際は保存されていない」状態になるため、更新行を必ず検証する（修正4。updateContactと同じパターン）
  const { data, error } = await getSupabase()
    .from('deal_buyer_conditions')
    .upsert({
      deal_id: dealId,
      division_id: divisionId,
      desired_area: input.desiredArea || null,
      desired_industry: input.desiredIndustry || null,
      desired_revenue_size: input.desiredRevenueSize || null,
      valuation_method: input.valuationMethod || null,
      investment_budget_max: input.investmentBudgetMax || null,
      loss_deficit_ok: input.lossDeficitOk || null,
      funding_method: input.fundingMethod || null,
      funding_amount_max: input.fundingAmountMax || null,
      key_man_lockup: input.keyManLockup || null,
      audit_by_company: input.auditByCompany || null,
      audit_by_specialist: input.auditBySpecialist || null,
      review_period: input.reviewPeriod || null,
      approval_flow: input.approvalFlow || null,
    }, { onConflict: 'deal_id' })
    .select('deal_id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('条件が保存されませんでした（編集権限がないか、対象が存在しません）')
  }
}
