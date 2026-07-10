import { getSupabase } from './client'
import type { DealPayment, PaymentBillingStatus, PaymentParty } from '@/types/database'

// 案件の金銭管理（deal_payments）。supabase/migrations/014_deal_payments.sql のテーブルを使用する。

// 種別入力のサジェスト（自由入力可。事業部を問わず使える一般的な名称）
export const PAYMENT_TYPE_SUGGESTIONS = ['着手金', '中間手数料', '成功報酬', '月額報酬', 'その他']

export const BILLING_STATUS_LABELS: Record<PaymentBillingStatus, string> = {
  unbilled: '未請求',
  billed: '請求済',
  paid: '入金済',
}

export const PARTY_LABELS: Record<PaymentParty, string> = {
  seller: '売手',
  buyer: '買手',
}

type RawPayment = {
  id: string; deal_id: string; division_id: string
  payment_type: string; party: string | null; amount: number
  billing_status: string; invoice_date: string | null; paid_date: string | null
  note: string | null; created_by: string | null; created_at: string; updated_at: string
}

function toPayment(r: RawPayment): DealPayment {
  return {
    id: r.id, deal_id: r.deal_id, division_id: r.division_id,
    payment_type: r.payment_type,
    party: (r.party as PaymentParty | null) ?? undefined,
    amount: r.amount,
    billing_status: r.billing_status as PaymentBillingStatus,
    invoice_date: r.invoice_date ?? undefined,
    paid_date: r.paid_date ?? undefined,
    note: r.note ?? undefined,
    created_by: r.created_by ?? undefined,
    created_at: r.created_at, updated_at: r.updated_at,
  }
}

export async function fetchDealPayments(dealId: string): Promise<DealPayment[]> {
  const { data, error } = await getSupabase()
    .from('deal_payments')
    .select('*')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(toPayment)
}

export async function createDealPayment(input: {
  dealId: string; divisionId: string; paymentType: string
  party?: PaymentParty; amount: number; billingStatus: PaymentBillingStatus
  invoiceDate?: string; paidDate?: string; note?: string; createdBy?: string
}): Promise<DealPayment> {
  const { data, error } = await getSupabase()
    .from('deal_payments')
    .insert({
      deal_id: input.dealId, division_id: input.divisionId,
      payment_type: input.paymentType, party: input.party ?? null,
      amount: input.amount, billing_status: input.billingStatus,
      invoice_date: input.invoiceDate ?? null, paid_date: input.paidDate ?? null,
      note: input.note ?? null, created_by: input.createdBy ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return toPayment(data)
}

export async function updateDealPayment(id: string, updates: {
  paymentType?: string; party?: PaymentParty | null; amount?: number
  billingStatus?: PaymentBillingStatus; invoiceDate?: string | null; paidDate?: string | null
  note?: string | null
}): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (updates.paymentType !== undefined) patch.payment_type = updates.paymentType
  if (updates.party !== undefined) patch.party = updates.party
  if (updates.amount !== undefined) patch.amount = updates.amount
  if (updates.billingStatus !== undefined) patch.billing_status = updates.billingStatus
  if (updates.invoiceDate !== undefined) patch.invoice_date = updates.invoiceDate
  if (updates.paidDate !== undefined) patch.paid_date = updates.paidDate
  if (updates.note !== undefined) patch.note = updates.note
  const { data, error } = await getSupabase()
    .from('deal_payments')
    .update(patch)
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('金銭情報の更新が保存されませんでした（権限がないか、対象が存在しません）')
}

export async function deleteDealPayment(id: string): Promise<void> {
  const { error } = await getSupabase().from('deal_payments').delete().eq('id', id)
  if (error) throw error
}
