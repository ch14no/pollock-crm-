'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, inputCls } from '@/components/sourcing/fields'
import { PREFECTURES, formatErrorDetail } from '@/lib/utils'
import { createManualTsrCompany } from '@/lib/db/tsrProspects'

interface ManualCompanyModalProps {
  isOpen: boolean
  divisionId: string
  onClose: () => void
  onCreated: (tsrCode: string) => void
}

const EMPTY = { name: '', nameKana: '', prefecture: '', address: '', phone: '', representative: '', note: '' }

// 「＋会社を追加」: TSR に無い会社・個人事業主を手動登録の行として一覧に載せる
export function ManualCompanyModal({ isOpen, divisionId, onClose, onCreated }: ManualCompanyModalProps) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('商号を入力してください'); return }
    setSaving(true)
    try {
      const code = await createManualTsrCompany(divisionId, {
        name: form.name.trim(), nameKana: form.nameKana.trim() || undefined, prefecture: form.prefecture || undefined,
        address: form.address.trim() || undefined, phone: form.phone.trim() || undefined,
        representative: form.representative.trim() || undefined, note: form.note.trim() || undefined,
      })
      toast.success('会社を追加しました')
      setForm(EMPTY)
      onCreated(code)
    } catch (e) {
      toast.error(`会社の追加に失敗しました: ${formatErrorDetail(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="会社を追加（手動登録）" size="md">
      <div className="space-y-3">
        <p className="text-xs text-gray-500">TSRリストに無い会社・個人事業主を登録します。登録後は他の会社と同じように担当者・活動・案件を管理できます。</p>
        <Field label="商号" required>
          <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="株式会社〇〇" autoFocus />
        </Field>
        <Field label="商号カナ">
          <input type="text" value={form.nameKana} onChange={(e) => setForm((f) => ({ ...f, nameKana: e.target.value }))} className={inputCls} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="都道府県">
            <select value={form.prefecture} onChange={(e) => setForm((f) => ({ ...f, prefecture: e.target.value }))} className={inputCls}>
              <option value="">未設定</option>
              {PREFECTURES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="電話番号">
            <input type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={inputCls} placeholder="03-0000-0000" />
          </Field>
        </div>
        <Field label="所在地">
          <input type="text" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className={inputCls} placeholder="東京都渋谷区..." />
        </Field>
        <Field label="代表者">
          <input type="text" value={form.representative} onChange={(e) => setForm((f) => ({ ...f, representative: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="備考">
          <textarea value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} rows={2} className={inputCls} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={saving}>キャンセル</Button>
          <Button onClick={handleSave} loading={saving}>追加する</Button>
        </div>
      </div>
    </Modal>
  )
}
