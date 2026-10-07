'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, CreditCard, Mail, Smartphone, Pencil, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Section, inputCls } from '@/components/sourcing/fields'
import { formatErrorDetail } from '@/lib/utils'
import { addTsrProspectContact, type TsrProspect } from '@/lib/db/tsrProspects'
import { upsertContactCustomValue } from '@/lib/db/contacts'
import type { Contact } from '@/types/database'
import type { DivisionCustomField } from '@/store/appStore'

interface CompanyContactsPanelProps {
  prospect: TsrProspect
  divisionId: string
  canEdit: boolean
  contacts: Contact[]
  otherDivisionCounts: { division_name: string; n: number }[]
  customFields: DivisionCustomField[]
  customValues: Record<string, Record<string, string>>   // contactId -> fieldId -> value
  onContactAdded: () => void
  onCustomValueChanged: (contactId: string, fieldId: string, value: string) => void
}

const EMPTY_FORM = { name: '', position: '', email: '', mobile: '', phone: '' }

// 企業詳細 ③名刺管理: その会社の担当者（contacts、自事業部分）。行内で M&A 項目を編集でき、
// 「＋担当者を追加」の簡易フォーム／名刺OCR画面（会社固定）へのリンクを持つ
export function CompanyContactsPanel({
  prospect, divisionId, canEdit, contacts, otherDivisionCounts, customFields, customValues, onContactAdded, onCustomValueChanged,
}: CompanyContactsPanelProps) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savingField, setSavingField] = useState<string | null>(null)

  const returnTo = `/sourcing/${encodeURIComponent(prospect.tsr_code)}`
  const ocrHref = prospect.company_id
    ? `/contacts/new?mode=card&company=${encodeURIComponent(prospect.company_id)}&companyName=${encodeURIComponent(prospect.name)}&return=${encodeURIComponent(returnTo)}`
    : null

  const handleAdd = async () => {
    if (!form.name.trim()) { toast.error('氏名を入力してください'); return }
    setSaving(true)
    try {
      await addTsrProspectContact(prospect.tsr_code, {
        name: form.name.trim(), position: form.position.trim() || undefined, email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined, mobile: form.mobile.trim() || undefined,
      }, Object.fromEntries(Object.entries(formValues).filter(([, v]) => v !== '')))
      toast.success(`${form.name.trim()} さんを担当者に追加しました`)
      setForm(EMPTY_FORM); setFormValues({}); setAdding(false)
      onContactAdded()
    } catch (e) {
      toast.error(`担当者の追加に失敗しました: ${formatErrorDetail(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const changeValue = async (contactId: string, field: DivisionCustomField, value: string) => {
    const prev = customValues[contactId]?.[field.id] ?? ''
    if (prev === value) return
    setSavingField(`${contactId}:${field.id}`)
    onCustomValueChanged(contactId, field.id, value)   // 楽観的更新
    try {
      await upsertContactCustomValue(contactId, field.id, value)
    } catch (e) {
      onCustomValueChanged(contactId, field.id, prev)  // 巻き戻し
      toast.error(`${field.label}の保存に失敗しました: ${formatErrorDetail(e)}`)
    } finally {
      setSavingField(null)
    }
  }

  const mobileOf = (c: Contact) => {
    const m = c.custom_attributes?.mobile
    return typeof m === 'string' && m ? m : null
  }

  return (
    <Section
      title="名刺管理"
      note={`${contacts.length}名${otherDivisionCounts.length > 0 ? `（他事業部: ${otherDivisionCounts.map((d) => `${d.division_name} ${d.n}名`).join('・')}）` : ''}`}
      action={canEdit && !adding ? (
        <div className="flex items-center gap-1.5">
          {ocrHref && (
            <Link href={ocrHref} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-orange-600 px-2 py-1 rounded-lg hover:bg-orange-50">
              <CreditCard size={12} />名刺から読み取る
            </Link>
          )}
          <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setAdding(true)}>担当者を追加</Button>
        </div>
      ) : undefined}
    >
      {contacts.length === 0 && !adding && (
        <p className="text-sm text-gray-400 py-3">担当者はまだ登録されていません。{canEdit && '「担当者を追加」から名刺情報を登録できます。'}</p>
      )}

      <div className="space-y-2">
        {contacts.map((c) => {
          const vals = customValues[c.id] ?? {}
          const editing = editingId === c.id
          return (
            <div key={c.id} className="border border-gray-100 rounded-xl p-3 bg-white">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/contacts/${c.id}`} className="font-medium text-gray-800 hover:text-orange-600">{c.name}</Link>
                    {c.position && <span className="text-xs text-gray-500">{c.position}</span>}
                    {c.users?.name && <span className="text-[11px] text-gray-400">担当: {c.users.name}</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                    {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-orange-600"><Mail size={11} />{c.email}</a>}
                    {(mobileOf(c) || c.phone) && <span className="inline-flex items-center gap-1"><Smartphone size={11} />{mobileOf(c) ?? c.phone}</span>}
                  </div>
                  {customFields.length > 0 && (
                    <div className="mt-2">
                      {editing ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {customFields.map((f) => (
                            <Field key={f.id} label={f.label}>
                              {f.fieldType === 'select' ? (
                                <select value={vals[f.id] ?? ''} disabled={savingField === `${c.id}:${f.id}`} onChange={(e) => void changeValue(c.id, f, e.target.value)} className={inputCls}>
                                  <option value="">未設定</option>
                                  {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                              ) : (
                                <input
                                  // 非制御 input のため、保存失敗の巻き戻しや再取得で値が変わったら key で再マウントして反映する
                                  key={`${c.id}-${f.id}-${vals[f.id] ?? ''}`}
                                  type="text" defaultValue={vals[f.id] ?? ''} className={inputCls}
                                  onBlur={(e) => void changeValue(c.id, f, e.target.value.trim())} />
                              )}
                            </Field>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {customFields.map((f) => vals[f.id] ? (
                            <Badge key={f.id} variant="orange">{f.label}: {vals[f.id]}</Badge>
                          ) : null)}
                          {customFields.every((f) => !vals[f.id]) && <span className="text-[11px] text-gray-300">M&A項目 未設定</span>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {canEdit && customFields.length > 0 && (
                  <button
                    onClick={() => setEditingId(editing ? null : c.id)}
                    className="text-gray-300 hover:text-orange-500 p-1 rounded"
                    aria-label={editing ? `${c.name} の編集を閉じる` : `${c.name} のM&A項目を編集`}
                  >
                    {editing ? <X size={14} /> : <Pencil size={14} />}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {adding && (
        <div className="border border-orange-200 bg-orange-50/40 rounded-xl p-3 mt-2 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label="氏名" required>
              <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="山田 太郎" autoFocus />
            </Field>
            <Field label="役職">
              <input type="text" value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} className={inputCls} placeholder="代表取締役" />
            </Field>
            <Field label="メールアドレス">
              <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={inputCls} placeholder="example@company.co.jp" />
            </Field>
            <Field label="携帯電話番号">
              <input type="tel" value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))} className={inputCls} placeholder="090-0000-0000" />
            </Field>
            {customFields.map((f) => (
              <Field key={f.id} label={f.label}>
                {f.fieldType === 'select' ? (
                  <select value={formValues[f.id] ?? ''} onChange={(e) => setFormValues((v) => ({ ...v, [f.id]: e.target.value }))} className={inputCls}>
                    <option value="">未設定</option>
                    {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type="text" value={formValues[f.id] ?? ''} onChange={(e) => setFormValues((v) => ({ ...v, [f.id]: e.target.value }))} className={inputCls} />
                )}
              </Field>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] text-gray-400">名刺画像から登録する場合は「名刺から読み取る」へ</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => { setAdding(false); setForm(EMPTY_FORM); setFormValues({}) }} disabled={saving}>キャンセル</Button>
              <Button size="sm" onClick={handleAdd} loading={saving}>追加</Button>
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}
