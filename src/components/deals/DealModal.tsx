'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ContactPicker } from '@/components/ui/ContactPicker'
import { ReferrerPicker, type ReferrerValue } from '@/components/ui/ReferrerPicker'
import { AutoGrowTextarea } from '@/components/ui/AutoGrowTextarea'
import { DealDocumentsSection } from '@/components/deals/DealDocumentsSection'
import { DealPaymentsSection } from '@/components/deals/DealPaymentsSection'
import { DealMilestonesSection } from '@/components/deals/DealMilestonesSection'
import { DealConditionsSection } from '@/components/deals/DealConditionsSection'
import type { DealPriority } from '@/types/database'
import { useAppStore } from '@/store/appStore'
import { DEFAULT_DIVISION_STAGES, DEFAULT_DIVISION_PRODUCTS } from '@/lib/mock-data'
import { hasTabs, stagesForTab, tabIdForStage } from '@/lib/pipeline-tabs'
import { isSupabaseConfigured } from '@/lib/db/client'
import { createDeal, updateDeal, updateDealStage, deleteDeal } from '@/lib/db/deals'
import { cn, formatCurrencyJa } from '@/lib/utils'
import toast from 'react-hot-toast'

interface DealFormState {
  title: string
  contactId: string
  amount: string
  stageId: string
  closeDate: string
  description: string
  priority: DealPriority
  referrer: ReferrerValue
}

const PRIORITY_OPTIONS: { value: DealPriority; label: string; activeClass: string }[] = [
  { value: 'high',   label: '高', activeClass: 'bg-red-500 text-white border-red-500' },
  { value: 'medium', label: '中', activeClass: 'bg-orange-500 text-white border-orange-500' },
  { value: 'low',    label: '低', activeClass: 'bg-gray-400 text-white border-gray-400' },
]

// 021マイグレーション未適用の環境で紹介者関連カラムが黙って保存から外れたことを
// 検知するための対象カラム一覧（修正5）
const REFERRER_COLUMNS = ['referrer_type', 'referrer_user_id', 'referrer_contact_id']

const FALLBACK_STAGES = [
  { id: 'リード',       name: 'リード',       isWon: false },
  { id: '初回面談',     name: '初回面談',     isWon: false },
  { id: '提案中',       name: '提案中',       isWon: false },
  { id: 'クロージング', name: 'クロージング', isWon: false },
  { id: '受注',         name: '受注 🎉',      isWon: true  },
]

export function DealModal() {
  const {
    dealModal, closeDealModal, activeDivisionId,
    addDeal, updateLocalDeal, removeLocalDeal, currentUser, divisionStages,
    divisionProducts, divisionProductsEnabled, dealProducts, setDealProduct, clearDealProduct,
    divisionTabs, activeTabId,
  } = useAppStore()

  const [loading, setLoading] = useState(false)
  const [amountDisplay, setAmountDisplay] = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null)
  const isEdit     = !!dealModal.deal
  // タブ機能を持つ事業部かどうかの判定に使う事業部ID（新規作成時は現在の事業部、編集時は商談自身の事業部）
  const tabsDivisionId = activeDivisionId ?? dealModal.deal?.division_id ?? null
  const tabs = tabsDivisionId ? (divisionTabs[tabsDivisionId] ?? []) : []
  const isLostStage = dealModal.deal ? (divisionStages[dealModal.deal.division_id ?? activeDivisionId ?? ''] ?? FALLBACK_STAGES).some((s) => (s as {id:string;isLost?:boolean}).isLost && s.id === dealModal.deal!.stage_id) || dealModal.deal.stage_id === '失注' : false
  const isWonStage  = dealModal.deal ? (divisionStages[dealModal.deal.division_id ?? activeDivisionId ?? ''] ?? FALLBACK_STAGES).some((s) => s.isWon && s.id === dealModal.deal!.stage_id) || dealModal.deal.stage_id === '受注' : false

  const productList = activeDivisionId
    ? (divisionProducts[activeDivisionId] ?? DEFAULT_DIVISION_PRODUCTS[activeDivisionId] ?? [])
    : []

  const [form, setForm] = useState<DealFormState>({
    title: '', contactId: '', amount: '', stageId: 'リード', closeDate: '', description: '', priority: 'medium',
    referrer: {},
  })

  // 売主/買主タブの判定はパイプラインタブの実装同様、タブ名の文字列マッチで行う
  // （専用のboolean列はなく、タブ名は事業部管理者が自由入力で設定する運用のため）
  const currentTabName = tabs.find((t) => t.id === selectedTabId)?.name ?? ''
  const isBuyerTab = currentTabName.includes('買主')
  const isSellerTab = currentTabName.includes('売主')

  // 指定した事業部・タブに紐づく「進行中」ステージ一覧（失注除く、受注絵文字付与、sortOrder順）。
  // タブを持たない事業部では tabId を無視して事業部の全ステージを対象にする。
  const computeActiveStages = (divId: string, tabId: string | null) => {
    const raw = divisionStages[divId] ?? DEFAULT_DIVISION_STAGES[divId]
    if (!raw) return FALLBACK_STAGES
    const scoped = hasTabs(divisionTabs, divId) ? stagesForTab(raw, tabId) : raw
    return scoped
      .filter((s) => !s.isLost)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({ id: s.id, name: s.isWon ? `${s.name} 🎉` : s.name, isWon: s.isWon }))
  }

  // ステージリスト（事業部別設定 or フォールバック、失注を除く、タブがあれば選択中タブに限定）
  const activeStages = computeActiveStages(activeDivisionId ?? '', selectedTabId)

  useEffect(() => {
    if (!dealModal.isOpen) return
    if (dealModal.deal) {
      const d = dealModal.deal
      // 編集時：タブは「現在ボードで選択中のタブ」ではなく「商談自身が属するタブ」から求める
      const dealTabId = hasTabs(divisionTabs, d.division_id)
        ? tabIdForStage(divisionStages[d.division_id] ?? [], d.stage_id)
        : null
      setSelectedTabId(dealTabId)
      setForm({
        title: d.title,
        contactId: d.contact_id ?? '',
        amount: String(d.amount),
        stageId: d.stage_id,
        closeDate: d.close_date ? d.close_date.slice(0, 10) : '',
        description: d.description ?? '',
        priority: d.priority ?? 'medium',
        referrer: { type: d.referrer_type, userId: d.referrer_user_id, contactId: d.referrer_contact_id },
      })
      setAmountDisplay(d.amount > 0 ? d.amount.toLocaleString('ja-JP') : '')
      // 本番はDBのproduct_nameが真実源（nullは「未選択」の意味なので旧localStorage値で復活させない）。
      // デモモードのみ旧localStorage保存分（dealProducts）を使う
      setSelectedProduct(isSupabaseConfigured() ? (d.product_name ?? '') : (dealProducts[d.id] ?? ''))
    } else {
      // 新規作成時：ボードで現在表示中のタブをデフォルトにする
      const initialTabId = hasTabs(divisionTabs, activeDivisionId)
        ? (activeTabId[activeDivisionId ?? ''] ?? tabs[0]?.id ?? null)
        : null
      setSelectedTabId(initialTabId)
      const initialStages = computeActiveStages(activeDivisionId ?? '', initialTabId)
      setForm({
        title: '',
        contactId: dealModal.prefillContactId ?? '',
        amount: '',
        stageId: dealModal.prefillStageId ?? initialStages[0]?.id ?? 'リード',
        closeDate: '',
        description: '',
        priority: 'medium',
        referrer: {},
      })
      setAmountDisplay('')
      setSelectedProduct('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealModal.isOpen, dealModal.deal, dealModal.prefillContactId, dealModal.prefillStageId])

  const handleAmountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '')
    setForm((f) => ({ ...f, amount: raw }))
    setAmountDisplay(raw ? parseInt(raw, 10).toLocaleString('ja-JP') : '')
  }, [])

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!form.title.trim()) { toast.error('商談名を入力してください'); return }
    if (!form.contactId)    { toast.error('対象顧客を選択してください'); return }
    if (hasTabs(divisionTabs, activeDivisionId ?? dealModal.deal?.division_id) && !selectedTabId) {
      toast.error('タブを選択してください'); return
    }
    const amount = parseInt(form.amount || '0', 10)
    if (isNaN(amount) || amount < 0) { toast.error('見込み額を正しく入力してください'); return }

    setLoading(true)
    const now = new Date().toISOString()
    // 紹介者：選択中のタイプに応じて片方だけをセットし、CHECK制約（021）に合わせて
    // 使わない側は毎回明示的にnullへ揃える（type切替時に古いIDが残らないように）
    const referrerType = form.referrer.type ?? null
    const referrerUserId = form.referrer.type === 'internal' ? (form.referrer.userId ?? null) : null
    const referrerContactId = form.referrer.type === 'external' ? (form.referrer.contactId ?? null) : null
    let strippedFields: string[] = []
    try {
      if (isEdit && dealModal.deal) {
        // ── 編集 ──
        if (isSupabaseConfigured()) {
          const result = await updateDeal(dealModal.deal.id, {
            title: form.title.trim(),
            amount,
            stageId: form.stageId,
            closeDate: form.closeDate || null,
            description: form.description.trim() || null,
            productName: selectedProduct || null,
            priority: form.priority,
            referrerType,
            referrerUserId,
            referrerContactId,
          })
          strippedFields = result.strippedFields
        }
        updateLocalDeal(dealModal.deal.id, {
          title: form.title.trim(),
          amount,
          stage_id: form.stageId,
          close_date: form.closeDate || undefined,
          description: form.description.trim() || undefined,
          product_name: selectedProduct || undefined,
          priority: form.priority,
          referrer_type: referrerType ?? undefined,
          referrer_user_id: referrerUserId ?? undefined,
          referrer_contact_id: referrerContactId ?? undefined,
          updated_at: now,
        })
        // デモモードのみ旧localStorage保存を維持（本番はdeals.product_nameが真実源）
        if (!isSupabaseConfigured()) {
          if (selectedProduct) setDealProduct(dealModal.deal.id, selectedProduct)
          else clearDealProduct(dealModal.deal.id)
        }
        if (strippedFields.some((f) => REFERRER_COLUMNS.includes(f))) {
          toast(`「${form.title}」を更新しました（紹介者欄は未適用のため保存されていません。管理者にご確認ください）`, { icon: '⚠️' })
        } else {
          toast.success(`「${form.title}」を更新しました`)
        }
      } else {
        // ── 新規作成 ──
        let dealId = `deal-local-${Date.now()}`
        if (isSupabaseConfigured() && activeDivisionId) {
          const result = await createDeal({
            divisionId: activeDivisionId,
            contactId: form.contactId || undefined,
            assignedUserId: currentUser?.id,
            title: form.title.trim(),
            amount,
            stageId: form.stageId,
            closeDate: form.closeDate || undefined,
            description: form.description.trim() || undefined,
            productName: selectedProduct || undefined,
            priority: form.priority,
            referrerType: referrerType ?? undefined,
            referrerUserId: referrerUserId ?? undefined,
            referrerContactId: referrerContactId ?? undefined,
          })
          dealId = result.id
          strippedFields = result.strippedFields
        }
        addDeal({
          id: dealId,
          contact_id: form.contactId || undefined,
          division_id: activeDivisionId ?? '',
          assigned_user_id: currentUser?.id,
          title: form.title.trim(),
          amount,
          stage_id: form.stageId,
          close_date: form.closeDate || undefined,
          description: form.description.trim() || undefined,
          product_name: selectedProduct || undefined,
          priority: form.priority,
          referrer_type: referrerType ?? undefined,
          referrer_user_id: referrerUserId ?? undefined,
          referrer_contact_id: referrerContactId ?? undefined,
          created_at: now,
          updated_at: now,
          users: currentUser ?? undefined,
        })
        if (!isSupabaseConfigured() && selectedProduct) setDealProduct(dealId, selectedProduct)
        if (strippedFields.some((f) => REFERRER_COLUMNS.includes(f))) {
          toast(`商談「${form.title}」を作成しました（紹介者欄は未適用のため保存されていません。管理者にご確認ください）`, { icon: '⚠️' })
        } else {
          toast.success(`商談「${form.title}」を作成しました`)
        }
      }
      closeDealModal()
    } catch {
      toast.error('保存に失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  const handleLoseDeal = async () => {
    if (!dealModal.deal) return
    if (!window.confirm(`「${form.title}」を失注として記録しますか？`)) return
    // 事業部の失注ステージの実IDへ移す。リテラル'失注'を書くと、ステージ定義がID管理の事業部では
    // どの定義にも一致しない「迷子商談」を新たに生み続けてしまう。
    // タブを持つ事業部（M&Aの売主/買主等）では商談自身のタブの失注ステージを優先する
    const dealDivId = dealModal.deal.division_id ?? activeDivisionId ?? ''
    const divStagesAll = divisionStages[dealDivId] ?? []
    const dealTabId = tabIdForStage(divStagesAll, dealModal.deal.stage_id)
    const lostStage = divStagesAll.find((s) => s.isLost && s.tabId === dealTabId)
      ?? divStagesAll.find((s) => s.isLost)
    const lostStageId = lostStage?.id ?? '失注'
    setLoading(true)
    try {
      if (isSupabaseConfigured()) await updateDealStage(dealModal.deal.id, lostStageId)
      updateLocalDeal(dealModal.deal.id, { stage_id: lostStageId, updated_at: new Date().toISOString() })
      closeDealModal()
      toast.success(`「${form.title}」を失注として記録しました`)
    } catch {
      toast.error('失敗しました。もう一度お試しください。')
    } finally { setLoading(false) }
  }

  const handleDeleteDeal = async () => {
    if (!dealModal.deal) return
    if (!window.confirm(`「${form.title}」を完全に削除しますか？\nこの操作は取り消せません。`)) return
    setLoading(true)
    try {
      if (isSupabaseConfigured() && !dealModal.deal.id.startsWith('deal-local-')) {
        await deleteDeal(dealModal.deal.id)
      }
      removeLocalDeal(dealModal.deal.id)
      closeDealModal()
      toast.success(`「${form.title}」を削除しました`)
    } catch {
      toast.error('削除に失敗しました')
    } finally { setLoading(false) }
  }

  const handleRestoreDeal = async () => {
    if (!dealModal.deal) return
    // モーダル上で選択中のタブではなく、商談自身が属するタブの先頭ステージへ復活させる
    const dealDivId = dealModal.deal.division_id ?? activeDivisionId ?? ''
    const dealTabId = hasTabs(divisionTabs, dealDivId)
      ? tabIdForStage(divisionStages[dealDivId] ?? [], dealModal.deal.stage_id)
      : null
    const firstActiveStage = computeActiveStages(dealDivId, dealTabId)[0]
    if (!firstActiveStage) return
    setLoading(true)
    try {
      if (isSupabaseConfigured()) await updateDealStage(dealModal.deal.id, firstActiveStage.id)
      updateLocalDeal(dealModal.deal.id, { stage_id: firstActiveStage.id, updated_at: new Date().toISOString() })
      closeDealModal()
      toast.success(`「${form.title}」を復活させました`)
    } catch {
      toast.error('失敗しました。もう一度お試しください。')
    } finally { setLoading(false) }
  }

  const amountInMan = form.amount ? Math.floor(parseInt(form.amount, 10) / 10000) : 0

  return (
    <Modal
      isOpen={dealModal.isOpen}
      onClose={closeDealModal}
      title={isEdit ? '商談を編集' : '商談を登録'}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* 件名 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            商談名 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="例: 基幹システム刷新プロジェクト"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
              focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50"
          />
        </div>

        {/* 対象顧客 */}
        <ContactPicker
          label="対象顧客"
          required
          selectedContactId={form.contactId || undefined}
          filterDivisionId={activeDivisionId ?? undefined}
          onSelect={(contactId) => setForm((f) => ({ ...f, contactId }))}
          onClear={() => setForm((f) => ({ ...f, contactId: '' }))}
          disabled={isEdit}
        />

        {/* 紹介者（M&A事業部要望④）。021マイグレーション未適用でも保存はfallbackされるため常に表示する */}
        <ReferrerPicker
          label="紹介者"
          value={form.referrer}
          onChange={(referrer) => setForm((f) => ({ ...f, referrer }))}
          filterDivisionId={activeDivisionId ?? undefined}
        />

        {/* 見込み額 + クロージング予定日 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              見込み額（円）<span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">¥</span>
              <input
                type="text"
                inputMode="numeric"
                value={amountDisplay}
                onChange={handleAmountChange}
                placeholder="1,000,000"
                className="w-full pl-7 pr-3 py-2 text-sm border border-gray-200 rounded-lg
                  focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50"
              />
            </div>
            {amountDisplay && amountInMan > 0 && (
              <p className="text-xs text-gray-400 mt-0.5">{formatCurrencyJa(parseInt(form.amount, 10))}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">クロージング予定日</label>
            <input
              type="date"
              value={form.closeDate}
              onChange={(e) => setForm((f) => ({ ...f, closeDate: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50"
            />
          </div>
        </div>

        {/* 提案商品 */}
        {productList.length > 0 && divisionProductsEnabled[activeDivisionId ?? ''] && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">提案商品・サービス</label>
            <div className="flex flex-wrap gap-2">
              {productList.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSelectedProduct(selectedProduct === p ? '' : p)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all',
                    selectedProduct === p
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* タブ選択（タブを持つ事業部のみ表示） */}
        {hasTabs(divisionTabs, activeDivisionId ?? dealModal.deal?.division_id) && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              タブ <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={selectedTabId === tab.id}
                  onClick={() => {
                    if (tab.id === selectedTabId) return
                    const divId = activeDivisionId ?? dealModal.deal?.division_id ?? ''
                    const newStages = computeActiveStages(divId, tab.id)
                    if (newStages.length === 0) {
                      toast.error(`「${tab.name}」タブにはステージが設定されていません。設定画面でステージを追加してください`)
                      return
                    }
                    // 切替先タブに属するステージへ復元する（誤ってタブを往復してもステージが失われないように）。
                    // フォームで選択中の未保存ステージを最優先、次に商談の保存済みステージ
                    const formStageInTab = newStages.some((s) => s.id === form.stageId) ? form.stageId : null
                    const savedStageId = dealModal.deal?.stage_id
                    const savedStageInTab = savedStageId && newStages.some((s) => s.id === savedStageId) ? savedStageId : null
                    const restoreStageId = formStageInTab ?? savedStageInTab
                    // 既存商談のタブを本当に変える操作は、ステージが先頭にリセットされる破壊的変更なので確認を挟む
                    if (isEdit && !restoreStageId) {
                      const ok = window.confirm(
                        `タブを「${tab.name}」に変更すると、ステージが「${newStages[0].name}」（先頭）に変わります。よろしいですか？`
                      )
                      if (!ok) return
                    }
                    setSelectedTabId(tab.id)
                    setForm((f) => ({ ...f, stageId: restoreStageId ?? newStages[0].id }))
                  }}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all',
                    selectedTabId === tab.id
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300'
                  )}
                >
                  {tab.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ステージ選択 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            ステージ
            {/* ステージ数が多い事業部（M&A等）では選択中がどれか一目で分かるように現在値も併記する */}
            {(() => {
              const current = activeStages.find((s) => s.id === form.stageId)
              return current ? <span className="ml-2 text-xs font-normal text-gray-400">現在: {current.name}</span> : null
            })()}
          </label>
          <div className="flex flex-wrap gap-2">
            {activeStages.map((stage) => (
              <button
                key={stage.id}
                type="button"
                aria-pressed={form.stageId === stage.id}
                onClick={() => setForm((f) => ({ ...f, stageId: stage.id }))}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all',
                  form.stageId === stage.id
                    ? stage.isWon
                      ? 'bg-green-500 text-white border-green-500'
                      : 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300'
                )}
              >
                {stage.name}
              </button>
            ))}
          </div>
        </div>

        {/* 優先度 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">優先度</label>
          <div className="flex gap-2">
            {PRIORITY_OPTIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, priority: p.value }))}
                className={cn(
                  'px-4 py-1.5 rounded-lg text-xs font-medium border-2 transition-all',
                  form.priority === p.value
                    ? p.activeClass
                    : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* メモ */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">メモ・備考</label>
          <AutoGrowTextarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={3}
            placeholder="商談の背景、課題、ネクストアクションなど..."
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
              focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50"
          />
        </div>

        {/* 編集時のアクションボタン */}
        {isEdit && dealModal.deal && (
          <div className="pt-2 border-t border-gray-100 space-y-2">
            {/* 失注ボタン（進行中の商談のみ） */}
            {!isLostStage && !isWonStage && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">失注として処理する</span>
                <button type="button" onClick={handleLoseDeal} disabled={loading}
                  className="text-xs text-red-500 hover:text-red-700 font-medium px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50">
                  失注にする
                </button>
              </div>
            )}
            {/* 失注からの復活 */}
            {isLostStage && (
              <div className="flex items-center justify-between bg-yellow-50 rounded-lg px-3 py-2">
                <span className="text-xs text-yellow-700">失注した商談を再活性化する</span>
                <button type="button" onClick={handleRestoreDeal} disabled={loading}
                  className="text-xs font-medium text-yellow-700 hover:text-yellow-900 px-3 py-1.5 rounded-lg hover:bg-yellow-100 transition-colors disabled:opacity-50">
                  復活させる
                </button>
              </div>
            )}
            {/* 削除ボタン */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">商談を完全に削除する</span>
              <button type="button" onClick={handleDeleteDeal} disabled={loading}
                className="text-xs text-gray-400 hover:text-red-500 font-medium px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50">
                削除する
              </button>
            </div>
          </div>
        )}

        <Button type="submit" loading={loading} className="w-full" size="lg">
          {loading ? '保存中...' : isEdit ? '更新する' : '商談を登録する'}
        </Button>
      </form>

      {/* 資料・金銭管理・対応期日・条件（登録済み商談の編集時のみ。各マイグレーション未適用時は自動的に非表示）
          ※ それぞれ内部に独自のformを持つため、上の商談フォームの外に配置する（ネストフォーム防止） */}
      {isEdit && dealModal.deal && isSupabaseConfigured() && !dealModal.deal.id.startsWith('deal-local-') && (
        <div className="mt-4 space-y-3">
          <DealDocumentsSection dealId={dealModal.deal.id} divisionId={dealModal.deal.division_id} />
          <DealPaymentsSection dealId={dealModal.deal.id} divisionId={dealModal.deal.division_id} />
          <DealMilestonesSection dealId={dealModal.deal.id} divisionId={dealModal.deal.division_id} />
          {(isSellerTab || isBuyerTab) && (
            <DealConditionsSection dealId={dealModal.deal.id} divisionId={dealModal.deal.division_id} party={isBuyerTab ? 'buyer' : 'seller'} />
          )}
        </div>
      )}
      {/* 新規作成時はセクション自体が出ないため、機能の存在と手順を案内する */}
      {!isEdit && isSupabaseConfigured() && (
        <p className="mt-3 text-xs text-gray-400 text-center">
          資料（Driveリンク）と手数料・入金の管理は、商談を登録した後に編集画面から追加できます
        </p>
      )}
    </Modal>
  )
}
