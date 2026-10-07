'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Field, Section, inputCls } from '@/components/sourcing/fields'
import { formatErrorDetail } from '@/lib/utils'
import { updateTsrProspectOps, TSR_STATUSES, TSR_APPROACH_TYPES, type TsrProspect } from '@/lib/db/tsrProspects'
import type { User } from '@/types/database'

interface ProspectOpsPanelProps {
  prospect: TsrProspect
  members: User[]
  canEdit: boolean
  onUpdated: (p: TsrProspect) => void
}

// 企業詳細 ②アプローチ管理（ステータス・区分・担当者・最終接触日・メモ）。項目は後日変更予定（酒田さん）
export function ProspectOpsPanel({ prospect: p, members, canEdit, onUpdated }: ProspectOpsPanelProps) {
  const [ops, setOps] = useState({
    approachType: p.approach_type ?? '', ownerUserId: p.owner_user_id ?? '', lastContactOn: p.last_contact_on ?? '', status: p.status, memo: p.memo ?? '',
  })
  const [saving, setSaving] = useState(false)

  const dirty = ops.approachType !== (p.approach_type ?? '') || ops.ownerUserId !== (p.owner_user_id ?? '') ||
    ops.lastContactOn !== (p.last_contact_on ?? '') || ops.status !== p.status || ops.memo !== (p.memo ?? '')

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateTsrProspectOps(p.tsr_code, {
        approachType: ops.approachType || null, ownerUserId: ops.ownerUserId || null,
        lastContactOn: ops.lastContactOn || null, status: ops.status, memo: ops.memo.trim() || null,
      })
      onUpdated({ ...p, approach_type: ops.approachType || null, owner_user_id: ops.ownerUserId || null, last_contact_on: ops.lastContactOn || null, status: ops.status, memo: ops.memo.trim() || null })
      toast.success('保存しました')
    } catch (e) {
      toast.error(`保存に失敗しました: ${formatErrorDetail(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="アプローチ管理">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="ステータス">
          <select value={ops.status} disabled={!canEdit} onChange={(e) => setOps((o) => ({ ...o, status: e.target.value }))} className={inputCls}>
            {TSR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="アプローチ区分">
          <select value={ops.approachType} disabled={!canEdit} onChange={(e) => setOps((o) => ({ ...o, approachType: e.target.value }))} className={inputCls}>
            <option value="">未設定</option>
            {TSR_APPROACH_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="担当者">
          <select value={ops.ownerUserId} disabled={!canEdit} onChange={(e) => setOps((o) => ({ ...o, ownerUserId: e.target.value }))} className={inputCls}>
            <option value="">未担当</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <Field label="最終接触日">
          <input type="date" value={ops.lastContactOn} disabled={!canEdit} onChange={(e) => setOps((o) => ({ ...o, lastContactOn: e.target.value }))} className={inputCls} />
        </Field>
      </div>
      <Field label="メモ">
        <textarea value={ops.memo} disabled={!canEdit} onChange={(e) => setOps((o) => ({ ...o, memo: e.target.value }))} rows={3} className={inputCls} placeholder="接触の記録、所感など" />
      </Field>
      {canEdit && (
        <div className="flex justify-end mt-2">
          <Button size="sm" onClick={handleSave} loading={saving} disabled={!dirty}>保存</Button>
        </div>
      )}
    </Section>
  )
}
