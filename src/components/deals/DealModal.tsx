'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ContactPicker } from '@/components/ui/ContactPicker'
import { useAppStore } from '@/store/appStore'
import { MOCK_CONTACTS, MOCK_STAGES } from '@/lib/mock-data'
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


export function DealModal() {
  const { dealModal, closeDealModal, activeDivisionId, addDeal, currentUser } = useAppStore()
  const [loading, setLoading] = useState(false)
  const [amountDisplay, setAmountDisplay] = useState('')

  const isEdit = !!dealModal.deal

  const [form, setForm] = useState<DealFormState>({
    title: '',
    contactId: '',
    amount: '',
    stageId: 'リード',
    closeDate: '',
    description: '',
  })

  useEffect(() => {
    if (dealModal.isOpen) {
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
      } else {
        setForm({
          title: '',
          contactId: dealModal.prefillContactId ?? '',
          amount: '',
          stageId: dealModal.prefillStageId ?? 'リード',
          closeDate: '',
          description: '',
        })
        setAmountDisplay('')
      }
    }
  }, [dealModal.isOpen, dealModal.deal, dealModal.prefillContactId, dealModal.prefillStageId])

  const selectedContact = MOCK_CONTACTS.find((c) => c.id === form.contactId)

  const handleAmountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '')
    setForm((f) => ({ ...f, amount: raw }))
    setAmountDisplay(raw ? parseInt(raw, 10).toLocaleString('ja-JP') : '')
  }, [])

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!form.title.trim()) {
      toast.error('商談名を入力してください')
      return
    }
    if (!form.contactId) {
      toast.error('対象顧客を選択してください')
      return
    }
    const amount = parseInt(form.amount, 10)
    if (isNaN(amount) || amount < 0) {
      toast.error('見込み額を正しく入力してください')
      return
    }
    setLoading(true)
    await new Promise((r) => setTimeout(r, 400))

    if (!isEdit) {
      const newDeal = {
        id: `deal-local-${Date.now()}`,
        contact_id: form.contactId || undefined,
        division_id: activeDivisionId ?? '',
        assigned_user_id: currentUser?.id,
        title: form.title.trim(),
        amount,
        stage_id: form.stageId,
        close_date: form.closeDate || undefined,
        description: form.description.trim() || undefined,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        contacts: selectedContact,
        users: currentUser ?? undefined,
      }
      addDeal(newDeal)
    }

    setLoading(false)
    closeDealModal()
    toast.success(isEdit ? `「${form.title}」を更新しました` : `商談「${form.title}」を作成しました`)
  }

  const handleClose = () => {
    closeDealModal()
  }

  const activeStages = MOCK_STAGES.filter((s) => !s.id.includes('失注'))

  return (
    <Modal
      isOpen={dealModal.isOpen}
      onClose={handleClose}
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

        {/* 見込み額 + ステージ */}
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
            {amountDisplay && (
              <p className="text-xs text-gray-400 mt-0.5">
                {(parseInt(form.amount, 10) / 10000).toFixed(0)}万円
              </p>
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
                    ? stage.id === '受注'
                      ? 'bg-green-500 text-white border-green-500'
                      : 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300'
                )}
              >
                {stage.name}
                {stage.id === '受注' && ' 🎉'}
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

        {/* 失注ボタン（編集時のみ） */}
        {isEdit && dealModal.deal?.stage_id !== '受注' && dealModal.deal?.stage_id !== '失注' && (
          <div className="flex items-center justify-between pt-1 border-t border-gray-100">
            <span className="text-xs text-gray-400">この商談を失注として処理する場合</span>
            <button
              type="button"
              onClick={() => {
                closeDealModal()
                toast.success('商談を失注として記録しました', { icon: '📋' })
              }}
              className="text-xs text-red-500 hover:text-red-700 font-medium px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
            >
              失注にする
            </button>
          </div>
        )}

        <Button type="submit" loading={loading} className="w-full" size="lg">
          {loading ? '保存中...' : isEdit ? '更新する' : '商談を登録する'}
        </Button>
      </form>
    </Modal>
  )
}
