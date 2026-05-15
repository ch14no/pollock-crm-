'use client'

import { useState, useEffect } from 'react'
import { Rocket } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ContactPicker } from '@/components/ui/ContactPicker'
import { useAppStore } from '@/store/appStore'
import { isSupabaseConfigured } from '@/lib/db/client'
import { createTossup } from '@/lib/db/tossups'
import toast from 'react-hot-toast'
import type { Tossup } from '@/types/database'

export function TossupModal() {
  const {
    tossupModal, closeTossupModal, activeDivision, currentUser,
    addTossup, divisions, activeDivisionId,
  } = useAppStore()

  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ toDivisionId: '', contactId: '', message: '' })

  useEffect(() => {
    if (tossupModal.isOpen) {
      setForm({
        toDivisionId: '',
        contactId: tossupModal.prefillContactId ?? '',
        message: '',
      })
    }
  }, [tossupModal.isOpen, tossupModal.prefillContactId])

  // 自事業部以外の事業部一覧
  const targetDivisions = divisions.filter((d) => d.id !== activeDivisionId)

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!form.toDivisionId)     { toast.error('紹介先事業部を選択してください'); return }
    if (!form.message.trim())   { toast.error('ニーズ・申し送り事項を入力してください'); return }

    setLoading(true)
    try {
      let tossupId = `toss-local-${Date.now()}`
      if (isSupabaseConfigured() && activeDivision) {
        tossupId = await createTossup({
          fromUserId:     currentUser?.id,
          fromDivisionId: activeDivision.id,
          toDivisionId:   form.toDivisionId,
          contactId:      form.contactId || undefined,
          message:        form.message.trim(),
        })
      }

      const toDivision = divisions.find((d) => d.id === form.toDivisionId)
      const now = new Date().toISOString()
      const newTossup: Tossup = {
        id: tossupId,
        from_user_id:    currentUser?.id,
        from_division_id: activeDivision?.id ?? '',
        to_division_id:  form.toDivisionId,
        contact_id:      form.contactId || undefined,
        message:         form.message.trim(),
        status:          'unread',
        created_at:      now,
        updated_at:      now,
        from_user:       currentUser ?? undefined,
        from_division:   activeDivision ?? undefined,
        to_division:     toDivision,
      }
      addTossup(newTossup)
      closeTossupModal()
      toast.success(`${toDivision?.name ?? ''}へトスアップを送信しました！`, { icon: '🚀', duration: 3000 })
    } catch {
      toast.error('送信に失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={tossupModal.isOpen} onClose={closeTossupModal} title="🚀 トスアップ送信" headerColor="orange">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 紹介先事業部 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            紹介先事業部 <span className="text-red-500">*</span>
          </label>
          {targetDivisions.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">紹介先の事業部がありません</p>
          ) : (
            <select
              value={form.toDivisionId}
              onChange={(e) => setForm((f) => ({ ...f, toDivisionId: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50"
            >
              <option value="">選択してください</option>
              {targetDivisions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* 対象顧客 */}
        <ContactPicker
          label="対象顧客 / 企業（任意）"
          selectedContactId={form.contactId || undefined}
          filterDivisionId={activeDivisionId ?? undefined}
          onSelect={(contactId) => setForm((f) => ({ ...f, contactId }))}
          onClear={() => setForm((f) => ({ ...f, contactId: '' }))}
          placeholder="名前・企業名で検索..."
        />

        {/* ニーズ・申し送り */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            ニーズ・申し送り事項 <span className="text-red-500">*</span>
          </label>
          <textarea
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            rows={4}
            placeholder="相手のニーズや背景、対応の注意点などを記載してください...&#10;（例：IT人材の採用ニーズ、5月末まで、5名規模）"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
              focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50 resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">
            具体的に書くほど受信側が動きやすくなります
          </p>
        </div>

        <Button type="submit" variant="primary" size="lg" loading={loading} icon={<Rocket size={16} />} className="w-full">
          {loading ? '送信中...' : 'トスアップを送信'}
        </Button>
      </form>
    </Modal>
  )
}
