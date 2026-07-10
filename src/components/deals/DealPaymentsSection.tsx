'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Banknote, Plus, Trash2 } from 'lucide-react'
import {
  fetchDealPayments, createDealPayment, updateDealPayment, deleteDealPayment,
  PAYMENT_TYPE_SUGGESTIONS, BILLING_STATUS_LABELS, PARTY_LABELS,
} from '@/lib/db/payments'
import type { DealPayment, PaymentBillingStatus, PaymentParty } from '@/types/database'
import { useAppStore } from '@/store/appStore'
import { formatCurrency, cn } from '@/lib/utils'
import toast from 'react-hot-toast'

interface DealPaymentsSectionProps {
  dealId: string
  divisionId: string
}

interface PaymentFormState {
  paymentType: string
  party: '' | PaymentParty
  amount: string
  billingStatus: PaymentBillingStatus
  invoiceDate: string
  paidDate: string
}

const EMPTY_FORM: PaymentFormState = {
  paymentType: '', party: '', amount: '', billingStatus: 'unbilled', invoiceDate: '', paidDate: '',
}

const STATUS_STYLE: Record<PaymentBillingStatus, string> = {
  unbilled: 'bg-gray-100 text-gray-600 border-gray-200',
  billed:   'bg-blue-50 text-blue-700 border-blue-200',
  paid:     'bg-green-50 text-green-700 border-green-200',
}

function todayISO(): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

// 案件の金銭管理（手数料・報酬の請求/入金状況）。M&A事業部要望⑮⑯。
export function DealPaymentsSection({ dealId, divisionId }: DealPaymentsSectionProps) {
  const currentUser = useAppStore((s) => s.currentUser)

  const [visible, setVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [payments, setPayments] = useState<DealPayment[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<PaymentFormState>(EMPTY_FORM)

  const loadData = useCallback(async () => {
    try {
      setPayments(await fetchDealPayments(dealId))
      setVisible(true)
    } catch {
      // 014マイグレーション未適用など。セクション自体を隠す
      setVisible(false)
    } finally {
      setLoaded(true)
    }
  }, [dealId])

  useEffect(() => {
    setLoaded(false)
    void loadData()
  }, [loadData])

  const totals = useMemo(() => {
    const sum = (filter: (p: DealPayment) => boolean) =>
      payments.filter(filter).reduce((acc, p) => acc + p.amount, 0)
    return {
      seller: sum((p) => p.party === 'seller'),
      buyer: sum((p) => p.party === 'buyer'),
      all: sum(() => true),
      paid: sum((p) => p.billing_status === 'paid'),
    }
  }, [payments])

  const handleSave = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!form.paymentType.trim()) { toast.error('種別を入力してください'); return }
    const amount = parseInt(form.amount.replace(/[^0-9]/g, '') || '0', 10)
    if (isNaN(amount) || amount <= 0) { toast.error('金額を正しく入力してください'); return }

    setSaving(true)
    try {
      await createDealPayment({
        dealId, divisionId,
        paymentType: form.paymentType.trim(),
        party: form.party || undefined,
        amount,
        billingStatus: form.billingStatus,
        invoiceDate: form.invoiceDate || undefined,
        paidDate: form.paidDate || undefined,
        createdBy: currentUser?.id,
      })
      await loadData()
      setForm(EMPTY_FORM)
      setFormOpen(false)
      toast.success('金銭情報を登録しました')
    } catch {
      toast.error('登録に失敗しました')
    } finally {
      setSaving(false)
    }
  }, [form, dealId, divisionId, currentUser, loadData])

  // 請求状況をインラインで変更。請求済/入金済にした際、日付が未設定なら今日を自動記録
  const handleStatusChange = useCallback(async (payment: DealPayment, status: PaymentBillingStatus) => {
    const updates: Parameters<typeof updateDealPayment>[1] = { billingStatus: status }
    if (status === 'billed' && !payment.invoice_date) updates.invoiceDate = todayISO()
    if (status === 'paid') {
      if (!payment.invoice_date) updates.invoiceDate = todayISO()
      if (!payment.paid_date) updates.paidDate = todayISO()
    }
    try {
      await updateDealPayment(payment.id, updates)
      await loadData()
    } catch {
      toast.error('請求状況の更新に失敗しました')
    }
  }, [loadData])

  const handleDelete = useCallback(async (payment: DealPayment) => {
    if (!window.confirm(`「${payment.payment_type}」（${formatCurrency(payment.amount)}）を削除しますか？`)) return
    try {
      await deleteDealPayment(payment.id)
      await loadData()
      toast.success('削除しました')
    } catch {
      toast.error('削除に失敗しました')
    }
  }, [loadData])

  if (!loaded || !visible) return null

  return (
    <div className="pt-2 border-t border-gray-100">
      <div className="flex items-center gap-1.5 mb-2">
        <Banknote className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
        <h3 className="text-sm font-medium text-gray-700">金銭管理（手数料・報酬）</h3>
      </div>

      {payments.length > 0 && (
        <>
          <ul className="space-y-1.5 mb-2">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2 border border-gray-100 rounded-lg text-sm">
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  {p.party && (
                    <span className={cn(
                      'shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded border',
                      p.party === 'seller' ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-purple-50 text-purple-700 border-purple-200'
                    )}>
                      {PARTY_LABELS[p.party]}
                    </span>
                  )}
                  <span className="truncate text-gray-700">{p.payment_type}</span>
                  <span className="shrink-0 font-bold text-gray-800">{formatCurrency(p.amount)}</span>
                </div>
                <select
                  value={p.billing_status}
                  onChange={(e) => handleStatusChange(p, e.target.value as PaymentBillingStatus)}
                  aria-label={`${p.payment_type}の請求状況`}
                  className={cn('shrink-0 text-xs border rounded-lg px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-orange-500', STATUS_STYLE[p.billing_status])}
                >
                  {(Object.keys(BILLING_STATUS_LABELS) as PaymentBillingStatus[]).map((s) => (
                    <option key={s} value={s}>{BILLING_STATUS_LABELS[s]}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleDelete(p)}
                  aria-label={`${p.payment_type}を削除`}
                  className="shrink-0 p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>

          {/* 合計（⑯: 売手報酬・買手報酬・合計） */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 mb-2 bg-gray-50 rounded-lg text-xs text-gray-600">
            <span>売手計 <strong className="text-gray-800">{formatCurrency(totals.seller)}</strong></span>
            <span>買手計 <strong className="text-gray-800">{formatCurrency(totals.buyer)}</strong></span>
            <span>合計 <strong className="text-gray-800">{formatCurrency(totals.all)}</strong></span>
            <span className="text-green-700">入金済 <strong>{formatCurrency(totals.paid)}</strong></span>
          </div>
        </>
      )}

      {formOpen ? (
        <form onSubmit={handleSave} className="space-y-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="deal-pay-type" className="block text-xs font-medium text-gray-600 mb-1">
                種別 <span className="text-red-500">*</span>
              </label>
              <input
                id="deal-pay-type"
                type="text"
                list="deal-pay-type-suggestions"
                value={form.paymentType}
                onChange={(e) => setForm((f) => ({ ...f, paymentType: e.target.value }))}
                placeholder="例: 中間手数料"
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
              />
              <datalist id="deal-pay-type-suggestions">
                {PAYMENT_TYPE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div>
              <label htmlFor="deal-pay-party" className="block text-xs font-medium text-gray-600 mb-1">対象</label>
              <select
                id="deal-pay-party"
                value={form.party}
                onChange={(e) => setForm((f) => ({ ...f, party: e.target.value as PaymentFormState['party'] }))}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
              >
                <option value="">共通</option>
                <option value="seller">売手</option>
                <option value="buyer">買手</option>
              </select>
            </div>
            <div>
              <label htmlFor="deal-pay-amount" className="block text-xs font-medium text-gray-600 mb-1">
                金額（円） <span className="text-red-500">*</span>
              </label>
              <input
                id="deal-pay-amount"
                type="text"
                inputMode="numeric"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^0-9]/g, '') }))}
                placeholder="1000000"
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
              />
            </div>
            <div>
              <label htmlFor="deal-pay-status" className="block text-xs font-medium text-gray-600 mb-1">請求状況</label>
              <select
                id="deal-pay-status"
                value={form.billingStatus}
                onChange={(e) => setForm((f) => ({ ...f, billingStatus: e.target.value as PaymentBillingStatus }))}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
              >
                {(Object.keys(BILLING_STATUS_LABELS) as PaymentBillingStatus[]).map((s) => (
                  <option key={s} value={s}>{BILLING_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="deal-pay-invoice" className="block text-xs font-medium text-gray-600 mb-1">請求日</label>
              <input
                id="deal-pay-invoice"
                type="date"
                value={form.invoiceDate}
                onChange={(e) => setForm((f) => ({ ...f, invoiceDate: e.target.value }))}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
              />
            </div>
            <div>
              <label htmlFor="deal-pay-paid" className="block text-xs font-medium text-gray-600 mb-1">入金日</label>
              <input
                id="deal-pay-paid"
                type="date"
                value={form.paidDate}
                onChange={(e) => setForm((f) => ({ ...f, paidDate: e.target.value }))}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存する'}
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={saving}
              aria-label="金銭情報の追加フォームを閉じる"
              className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => { setForm(EMPTY_FORM); setFormOpen(true) }}
          className="flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 px-2 py-1.5 rounded-lg hover:bg-orange-50 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          手数料・報酬を追加
        </button>
      )}
    </div>
  )
}
