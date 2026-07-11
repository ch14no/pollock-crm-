'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { AutoGrowTextarea } from '@/components/ui/AutoGrowTextarea'
import { updateCompany } from '@/lib/db/companies'
import { isHttpUrl } from '@/lib/utils'
import type { Company } from '@/types/database'
import toast from 'react-hot-toast'

interface CompanyEditModalProps {
  onClose: () => void
  company: Company
  onSaved: (company: Company) => void
}

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500'

// 会社マスタの編集（M&A事業部要望⑳＋詳細項目の拡充）。
// 開くたびに親が条件付きマウントする前提の部品（フォーム初期値はマウント時に確定）。
// 019適用後はログイン済みの全ユーザーが編集できる（全社共有マスタのため変更は全事業部に反映）。
export function CompanyEditModal({ onClose, company, onSaved }: CompanyEditModalProps) {
  const [name, setName] = useState(company.name)
  const [corporateNumber, setCorporateNumber] = useState(company.corporate_number ?? '')
  const [industry, setIndustry] = useState(company.industry ?? '')
  const [representative, setRepresentative] = useState(company.representative ?? '')
  const [address, setAddress] = useState(company.address ?? '')
  const [phone, setPhone] = useState(company.phone ?? '')
  const [employeeCount, setEmployeeCount] = useState(company.employee_count?.toString() ?? '')
  const [capital, setCapital] = useState(company.capital?.toString() ?? '')
  const [establishedOn, setEstablishedOn] = useState(company.established_on ?? '')
  const [website, setWebsite] = useState(company.website ?? '')
  const [irUrl, setIrUrl] = useState(company.ir_url ?? '')
  const [note, setNote] = useState(company.note ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) { toast.error('会社名を入力してください'); return }
    const num = corporateNumber.trim()
    if (num && !/^\d{13}$/.test(num)) { toast.error('法人番号は13桁の数字で入力してください'); return }
    const site = website.trim()
    if (site && !isHttpUrl(site)) { toast.error('WebサイトのURLは http(s):// で始まる必要があります'); return }
    const ir = irUrl.trim()
    if (ir && !isHttpUrl(ir)) { toast.error('IRページのURLは http(s):// で始まる必要があります'); return }
    const emp = employeeCount.trim()
    if (emp && (!/^\d+$/.test(emp) || Number(emp) < 0)) { toast.error('従業員数は0以上の整数で入力してください'); return }
    const cap = capital.trim()
    if (cap && (!/^\d+$/.test(cap) || Number(cap) < 0)) { toast.error('資本金は0以上の整数（円）で入力してください'); return }

    // 変更されたフィールドだけ送る。019マイグレーション未適用の環境で
    // 存在しない列を送って編集全体が失敗するのを防ぐ
    const updates: Parameters<typeof updateCompany>[1] = {}
    if (name.trim() !== company.name) updates.name = name.trim()
    if (num !== (company.corporate_number ?? '')) updates.corporateNumber = num || null
    if (industry.trim() !== (company.industry ?? '')) updates.industry = industry.trim() || null
    if (representative.trim() !== (company.representative ?? '')) updates.representative = representative.trim() || null
    if (address.trim() !== (company.address ?? '')) updates.address = address.trim() || null
    if (phone.trim() !== (company.phone ?? '')) updates.phone = phone.trim() || null
    if (emp !== (company.employee_count?.toString() ?? '')) updates.employeeCount = emp ? Number(emp) : null
    if (cap !== (company.capital?.toString() ?? '')) updates.capital = cap ? Number(cap) : null
    if (establishedOn !== (company.established_on ?? '')) updates.establishedOn = establishedOn || null
    if (site !== (company.website ?? '')) updates.website = site || null
    if (ir !== (company.ir_url ?? '')) updates.irUrl = ir || null
    if (note.trim() !== (company.note ?? '')) updates.note = note.trim() || null

    if (Object.keys(updates).length === 0) { onClose(); return }

    setSaving(true)
    try {
      const updated = await updateCompany(company.id, updates)
      onSaved(updated)
      toast.success('会社情報を保存しました')
      onClose()
    } catch {
      toast.error('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="会社情報を編集" size="lg">
      <div className="space-y-4">
        <p className="text-xs text-gray-400 -mt-1">
          会社情報は全社共有です。変更内容はすべての事業部に反映されます。
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">会社名 <span className="text-red-500">*</span></label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">法人番号（13桁）</label>
            <input type="text" value={corporateNumber} onChange={(e) => setCorporateNumber(e.target.value)}
              placeholder="5030001129509" inputMode="numeric" maxLength={13} className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">業種</label>
            <input type="text" value={industry} onChange={(e) => setIndustry(e.target.value)}
              placeholder="例: 情報通信業" className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">代表者</label>
            <input type="text" value={representative} onChange={(e) => setRepresentative(e.target.value)}
              placeholder="例: 山田 太郎" className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">電話番号</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="03-1234-5678" className={inputCls} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">住所</label>
          <input type="text" value={address} onChange={(e) => setAddress(e.target.value)}
            placeholder="例: 大阪府大阪市淀川区西中島4-7-7" className={inputCls} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">従業員数</label>
            <input type="text" value={employeeCount} onChange={(e) => setEmployeeCount(e.target.value)}
              placeholder="例: 120" inputMode="numeric" className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">資本金（円）</label>
            <input type="text" value={capital} onChange={(e) => setCapital(e.target.value)}
              placeholder="例: 20000000" inputMode="numeric" className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">設立日</label>
            <input type="date" value={establishedOn} onChange={(e) => setEstablishedOn(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Webサイト</label>
            <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://example.co.jp" className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">IRページ</label>
            <input type="url" value={irUrl} onChange={(e) => setIrUrl(e.target.value)}
              placeholder="https://example.co.jp/ir/" className={inputCls} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">メモ</label>
          <AutoGrowTextarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
            placeholder="会社に関する補足情報（全社に公開されます）" className={inputCls} />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Button variant="ghost" onClick={onClose} disabled={saving}>キャンセル</Button>
          <Button loading={saving} onClick={handleSave}>保存</Button>
        </div>
      </div>
    </Modal>
  )
}
