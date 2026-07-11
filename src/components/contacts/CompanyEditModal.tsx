'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { updateCompany } from '@/lib/db/companies'
import { isHttpUrl } from '@/lib/utils'
import type { Company } from '@/types/database'
import toast from 'react-hot-toast'

interface CompanyEditModalProps {
  onClose: () => void
  company: Company
  onSaved: (company: Company) => void
}

// 会社マスタの編集（M&A事業部要望⑳: IRリンク欄の追加にあわせて新設）。
// 開くたびに親が条件付きマウントする前提の部品（フォーム初期値はマウント時に確定）。
// 会社は全社共有マスタのため、編集権限はDB側ポリシーどおり manager / super_admin のみ。
// 呼び出し側でロールを確認してから開くこと。
export function CompanyEditModal({ onClose, company, onSaved }: CompanyEditModalProps) {
  const [name, setName] = useState(company.name)
  const [corporateNumber, setCorporateNumber] = useState(company.corporate_number ?? '')
  const [website, setWebsite] = useState(company.website ?? '')
  const [irUrl, setIrUrl] = useState(company.ir_url ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) { toast.error('会社名を入力してください'); return }
    const num = corporateNumber.trim()
    if (num && !/^\d{13}$/.test(num)) { toast.error('法人番号は13桁の数字で入力してください'); return }
    const site = website.trim()
    if (site && !isHttpUrl(site)) { toast.error('WebサイトのURLは http(s):// で始まる必要があります'); return }
    const ir = irUrl.trim()
    if (ir && !isHttpUrl(ir)) { toast.error('IRページのURLは http(s):// で始まる必要があります'); return }

    // 変更されたフィールドだけ送る。特にir_urlは018マイグレーション未適用の環境で
    // 列が存在しないため、未変更なのに常に送ると会社編集全体が失敗してしまう
    const updates: Parameters<typeof updateCompany>[1] = {}
    if (name.trim() !== company.name) updates.name = name.trim()
    if (num !== (company.corporate_number ?? '')) updates.corporateNumber = num || null
    if (site !== (company.website ?? '')) updates.website = site || null
    if (ir !== (company.ir_url ?? '')) updates.irUrl = ir || null

    if (Object.keys(updates).length === 0) { onClose(); return }

    setSaving(true)
    try {
      const updated = await updateCompany(company.id, updates)
      onSaved(updated)
      toast.success('会社情報を保存しました')
      onClose()
    } catch {
      toast.error('保存に失敗しました（編集権限がない可能性があります）')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="会社情報を編集">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">会社名 <span className="text-red-500">*</span></label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">法人番号（13桁）</label>
          <input type="text" value={corporateNumber} onChange={(e) => setCorporateNumber(e.target.value)}
            placeholder="5030001129509" inputMode="numeric" maxLength={13}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Webサイト</label>
          <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://example.co.jp"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">IRページ</label>
          <input type="url" value={irUrl} onChange={(e) => setIrUrl(e.target.value)}
            placeholder="https://example.co.jp/ir/"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <p className="text-xs text-gray-400 mt-1">上場企業のIR情報・決算資料ページ等のURL（M&Aニュース共有の起点になります）</p>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Button variant="ghost" onClick={onClose} disabled={saving}>キャンセル</Button>
          <Button loading={saving} onClick={handleSave}>保存</Button>
        </div>
      </div>
    </Modal>
  )
}
