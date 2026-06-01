'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ContactPicker } from '@/components/ui/ContactPicker'
import { useAppStore } from '@/store/appStore'
import { DEFAULT_DIVISION_STAGES, DEFAULT_DIVISION_PRODUCTS } from '@/lib/mock-data'
import { isSupabaseConfigured } from '@/lib/db/client'
import { createDeal, updateDeal, updateDealStage, deleteDeal } from '@/lib/db/deals'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'

interface DealFormState {
  title: string
  contactId: string
  amount: string
  stageId: string
  closeDate: string
  description: string
}

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
  } = useAppStore()

  const [loading, setLoading] = useState(false)
  const [amountDisplay, setAmountDisplay] = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
  const isEdit     = !!dealModal.deal
  const isLostStage = dealModal.deal ? (divisionStages[dealModal.deal.division_id ?? activeDivisionId ?? ''] ?? FALLBACK_STAGES).some((s) => (s as {id:string;isLost?:boolean}).isLost && s.id === dealModal.deal!.stage_id) || dealModal.deal.stage_id === '失注' : false
  const isWonStage  = dealModal.deal ? (divisionStages[dealModal.deal.division_id ?? activeDivisionId ?? ''] ?? FALLBACK_STAGES).some((s) => s.isWon && s.id === dealModal.deal!.stage_id) || dealModal.deal.stage_id === '受注' : false

  const productList = activeDivisionId
    ? (divisionProducts[activeDivisionId] ?? DEFAULT_DIVISION_PRODUCTS[activeDivisionId] ?? [])
    : []

  const [form, setForm] = useState<DealFormState>({
    title: '', contactId: '', amount: '', stageId: 'リード', closeDate: '', description: '',
  })

  // ステージリスト（事業部別設定 or フォールバック、失注を除く）
  const activeStages = (() => {
    const divId = activeDivisionId ?? ''
    const raw = divisionStages[divId] ?? DEFAULT_DIVISION_STAGES[divId]
    if (!raw) return FALLBACK_STAGES
    return raw
      .filter((s) => !s.isLost)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({ id: s.id, name: s.isWon ? `${s.name} 🎉` : s.name, isWon: s.isWon }))
  })()

  useEffect(() => {
    if (!dealModal.isOpen) return
    if (dealModal.deal) {
      const d = dealModal.deal
      setForm({
        title: d.title,
        contactId: d.contact_id ?? '',
        amount: String(d.amount),
        stageId: d.stage_id,
        closeDate: d.close_date ? d.close_date.slice(0, 10) : '',
        description: d.description ?? '',
      })
      setAmountDisplay(d.amount > 0 ? d.amount.toLocaleString('ja-JP') : '')
      setSelectedProduct(dealProducts[d.id] ?? '')
    } else {
      setForm({
        title: '',
        contactId: dealModal.prefillContactId ?? '',
        amount: '',
        stageId: dealModal.prefillStageId ?? activeStages[0]?.id ?? 'リード',
        closeDate: '',
        description: '',
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
    const amount = parseInt(form.amount || '0', 10)
    if (isNaN(amount) || amount < 0) { toast.error('見込み額を正しく入力してください'); return }

    setLoading(true)
    const now = new Date().toISOString()
    try {
      if (isEdit && dealModal.deal) {
        // ── 編集 ──
        if (isSupabaseConfigured()) {
          await updateDeal(dealModal.deal.id, {
            title: form.title.trim(),
            amount,
            stageId: form.stageId,
            closeDate: form.closeDate || null,
            description: form.description.trim() || null,
          })
        }
        updateLocalDeal(dealModal.deal.id, {
          title: form.title.trim(),
          amount,
          stage_id: form.stageId,
          close_date: form.closeDate || undefined,
          description: form.description.trim() || undefined,
          updated_at: now,
        })
        if (selectedProduct) setDealProduct(dealModal.deal.id, selectedProduct)
        else clearDealProduct(dealModal.deal.id)
        toast.success(`「${form.title}」を更新しました`)
      } else {
        // ── 新規作成 ──
        let dealId = `deal-local-${Date.now()}`
        if (isSupabaseConfigured() && activeDivisionId) {
          dealId = await createDeal({
            divisionId: activeDivisionId,
            contactId: form.contactId || undefined,
            assignedUserId: currentUser?.id,
            title: form.title.trim(),
            amount,
            stageId: form.stageId,
            closeDate: form.closeDate || undefined,
            description: form.description.trim() || undefined,
          })
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
          created_at: now,
          updated_at: now,
          users: currentUser ?? undefined,
        })
        if (selectedProduct) setDealProduct(dealId, selectedProduct)
        toast.success(`商談「${form.title}」を作成しました`)
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
    setLoading(true)
    try {
      if (isSupabaseConfigured()) await updateDealStage(dealModal.deal.id, '失注')
      updateLocalDeal(dealModal.deal.id, { stage_id: '失注', updated_at: new Date().toISOString() })
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
    const firstActiveStage = activeStages[0]
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
              <p className="text-xs text-gray-400 mt-0.5">{amountInMan.toLocaleString()}万円</p>
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

        {/* ステージ選択 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">ステージ</label>
          <div className="flex flex-wrap gap-2">
            {activeStages.map((stage) => (
              <button
                key={stage.id}
                type="button"
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

        {/* メモ */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">メモ・備考</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={3}
            placeholder="商談の背景、課題、ネクストアクションなど..."
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
              focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50 resize-none"
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
    </Modal>
  )
}
