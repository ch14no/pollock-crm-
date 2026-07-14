'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ClipboardList } from 'lucide-react'
import {
  fetchSellerConditions, upsertSellerConditions,
  fetchBuyerConditions, upsertBuyerConditions,
} from '@/lib/db/conditions'
import type { DesiredArea, FundingMethod, LossDeficitOk } from '@/types/database'
import toast from 'react-hot-toast'

interface DealConditionsSectionProps {
  dealId: string
  divisionId: string
  party: 'seller' | 'buyer'
}

const DESIRED_AREA_OPTIONS: DesiredArea[] = ['全国', '1都3県', '関東', '関西', '中部', '九州', 'その他']
const LOSS_DEFICIT_OPTIONS: LossDeficitOk[] = ['可', '否']
const FUNDING_METHOD_OPTIONS: FundingMethod[] = ['手元資金', '借入', 'エクイティ']

interface SellerFormState {
  desiredTiming: string
  desiredScheme: string
  desiredPrice: string
  otherConditions: string
}
const EMPTY_SELLER: SellerFormState = { desiredTiming: '', desiredScheme: '', desiredPrice: '', otherConditions: '' }

interface BuyerFormState {
  desiredArea: DesiredArea | ''
  desiredIndustry: string
  desiredRevenueSize: string
  valuationMethod: string
  investmentBudgetMax: string
  lossDeficitOk: LossDeficitOk | ''
  fundingMethod: FundingMethod | ''
  fundingAmountMax: string
  keyManLockup: string
  auditByCompany: string
  auditBySpecialist: string
  reviewPeriod: string
  approvalFlow: string
}
const EMPTY_BUYER: BuyerFormState = {
  desiredArea: '', desiredIndustry: '', desiredRevenueSize: '', valuationMethod: '', investmentBudgetMax: '',
  lossDeficitOk: '', fundingMethod: '', fundingAmountMax: '',
  keyManLockup: '', auditByCompany: '', auditBySpecialist: '', reviewPeriod: '', approvalFlow: '',
}

const inputCls = 'w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

// 売主の譲渡希望条件／買主の買収意向（M&A事業部要望㉒）
export function DealConditionsSection({ dealId, divisionId, party }: DealConditionsSectionProps) {
  const [visible, setVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sellerForm, setSellerForm] = useState<SellerFormState>(EMPTY_SELLER)
  const [buyerForm, setBuyerForm] = useState<BuyerFormState>(EMPTY_BUYER)

  const loadSeq = useRef(0)
  const loadData = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      if (party === 'seller') {
        const data = await fetchSellerConditions(dealId)
        if (loadSeq.current !== seq) return
        setSellerForm(data ? {
          desiredTiming: data.desired_timing ?? '',
          desiredScheme: data.desired_scheme ?? '',
          desiredPrice: data.desired_price ?? '',
          otherConditions: data.other_conditions ?? '',
        } : EMPTY_SELLER)
      } else {
        const data = await fetchBuyerConditions(dealId)
        if (loadSeq.current !== seq) return
        setBuyerForm(data ? {
          desiredArea: data.desired_area ?? '',
          desiredIndustry: data.desired_industry ?? '',
          desiredRevenueSize: data.desired_revenue_size ?? '',
          valuationMethod: data.valuation_method ?? '',
          investmentBudgetMax: data.investment_budget_max ?? '',
          lossDeficitOk: data.loss_deficit_ok ?? '',
          fundingMethod: data.funding_method ?? '',
          fundingAmountMax: data.funding_amount_max ?? '',
          keyManLockup: data.key_man_lockup ?? '',
          auditByCompany: data.audit_by_company ?? '',
          auditBySpecialist: data.audit_by_specialist ?? '',
          reviewPeriod: data.review_period ?? '',
          approvalFlow: data.approval_flow ?? '',
        } : EMPTY_BUYER)
      }
      setVisible(true)
    } catch {
      // 023マイグレーション未適用など。エラーは画面に出さずセクション自体を隠す
      if (loadSeq.current === seq) setVisible(false)
    } finally {
      if (loadSeq.current === seq) setLoaded(true)
    }
  }, [dealId, party])

  useEffect(() => {
    setLoaded(false)
    void loadData()
  }, [loadData])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      if (party === 'seller') {
        await upsertSellerConditions(dealId, divisionId, sellerForm)
      } else {
        await upsertBuyerConditions(dealId, divisionId, buyerForm)
      }
      toast.success('条件を保存しました')
    } catch {
      toast.error('条件の保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }, [dealId, divisionId, party, sellerForm, buyerForm])

  if (!loaded || !visible) return null

  return (
    <div className="pt-2 border-t border-gray-100">
      <div className="flex items-center gap-1.5 mb-2">
        <ClipboardList className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
        <h3 className="text-sm font-medium text-gray-700">
          {party === 'seller' ? '譲渡希望条件（売主）' : '買収意向（買主）'}
        </h3>
      </div>

      {party === 'seller' ? (
        <div className="grid grid-cols-2 gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div>
            <label className={labelCls}>希望譲渡時期</label>
            <input type="text" value={sellerForm.desiredTiming}
              onChange={(e) => setSellerForm((f) => ({ ...f, desiredTiming: e.target.value }))}
              placeholder="例: 2026年内" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>希望譲渡スキーム</label>
            <input type="text" value={sellerForm.desiredScheme}
              onChange={(e) => setSellerForm((f) => ({ ...f, desiredScheme: e.target.value }))}
              placeholder="例: 株式譲渡" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>希望譲渡対価</label>
            <input type="text" value={sellerForm.desiredPrice}
              onChange={(e) => setSellerForm((f) => ({ ...f, desiredPrice: e.target.value }))}
              placeholder="例: 1億円以上" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>その他条件</label>
            <input type="text" value={sellerForm.otherConditions}
              onChange={(e) => setSellerForm((f) => ({ ...f, otherConditions: e.target.value }))}
              placeholder="自由記述" className={inputCls} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div>
            <label className={labelCls}>希望エリア</label>
            <select value={buyerForm.desiredArea}
              onChange={(e) => setBuyerForm((f) => ({ ...f, desiredArea: e.target.value as DesiredArea | '' }))}
              className={inputCls}>
              <option value="">未選択</option>
              {DESIRED_AREA_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>希望業種</label>
            <input type="text" value={buyerForm.desiredIndustry}
              onChange={(e) => setBuyerForm((f) => ({ ...f, desiredIndustry: e.target.value }))}
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>希望買収先の売上規模</label>
            <input type="text" value={buyerForm.desiredRevenueSize}
              onChange={(e) => setBuyerForm((f) => ({ ...f, desiredRevenueSize: e.target.value }))}
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>株価算定方法</label>
            <input type="text" value={buyerForm.valuationMethod}
              onChange={(e) => setBuyerForm((f) => ({ ...f, valuationMethod: e.target.value }))}
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>投資予算（上限）</label>
            <input type="text" value={buyerForm.investmentBudgetMax}
              onChange={(e) => setBuyerForm((f) => ({ ...f, investmentBudgetMax: e.target.value }))}
              placeholder="例: 3億円" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>赤字・債務超過企業の検討可否</label>
            <select value={buyerForm.lossDeficitOk}
              onChange={(e) => setBuyerForm((f) => ({ ...f, lossDeficitOk: e.target.value as LossDeficitOk | '' }))}
              className={inputCls}>
              <option value="">未選択</option>
              {LOSS_DEFICIT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>資金調達方法</label>
            <select value={buyerForm.fundingMethod}
              onChange={(e) => {
                const fundingMethod = e.target.value as FundingMethod | ''
                // 資金調達方法をクリアしたら、隣接して表示される上限金額欄も一緒にクリアする（修正8）。
                // クリアしないと、非表示になった上限金額が古い値のままフォーム内に残り、
                // 資金調達方法なしのまま保存されてしまう
                setBuyerForm((f) => ({ ...f, fundingMethod, fundingAmountMax: fundingMethod ? f.fundingAmountMax : '' }))
              }}
              className={inputCls}>
              <option value="">未選択</option>
              {FUNDING_METHOD_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          {/* 資金調達方法を選択したときだけ上限金額の記載欄を隣接表示する */}
          {buyerForm.fundingMethod && (
            <div>
              <label className={labelCls}>資金調達の上限金額</label>
              <input type="text" value={buyerForm.fundingAmountMax}
                onChange={(e) => setBuyerForm((f) => ({ ...f, fundingAmountMax: e.target.value }))}
                placeholder="例: 2億円" className={inputCls} />
            </div>
          )}
          <div>
            <label className={labelCls}>キーマンのロックアップ</label>
            <input type="text" value={buyerForm.keyManLockup}
              onChange={(e) => setBuyerForm((f) => ({ ...f, keyManLockup: e.target.value }))}
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>買収監査対応（自社）</label>
            <input type="text" value={buyerForm.auditByCompany}
              onChange={(e) => setBuyerForm((f) => ({ ...f, auditByCompany: e.target.value }))}
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>買収監査対応（専門業者）</label>
            <input type="text" value={buyerForm.auditBySpecialist}
              onChange={(e) => setBuyerForm((f) => ({ ...f, auditBySpecialist: e.target.value }))}
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>検討期間</label>
            <input type="text" value={buyerForm.reviewPeriod}
              onChange={(e) => setBuyerForm((f) => ({ ...f, reviewPeriod: e.target.value }))}
              placeholder="例: 提案から3ヶ月" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>社内決裁フロー</label>
            <input type="text" value={buyerForm.approvalFlow}
              onChange={(e) => setBuyerForm((f) => ({ ...f, approvalFlow: e.target.value }))}
              className={inputCls} />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-2 px-3 py-1.5 text-xs font-medium text-white bg-orange-500 hover:bg-orange-600
          rounded-lg transition-colors disabled:opacity-50"
      >
        {saving ? '保存中...' : '条件を保存する'}
      </button>
    </div>
  )
}
