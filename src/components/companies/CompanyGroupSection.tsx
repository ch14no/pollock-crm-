'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Network, Building2, X, Plus } from 'lucide-react'
import {
  fetchCompanyGroupLinks,
  addCompanyGroupLink,
  deleteCompanyGroupLink,
} from '@/lib/db/companyGroups'
import { CompanyPicker } from '@/components/ui/CompanyPicker'
import type { CompanyGroupLink } from '@/types/database'
import toast from 'react-hot-toast'

interface CompanyGroupSectionProps {
  companyId: string
}

// 046未適用の環境ではfetchCompanyGroupLinksが例外を投げるため、
// DealDocumentsSectionと同じくセクション自体を隠すフォールバックにする
export function CompanyGroupSection({ companyId }: CompanyGroupSectionProps) {
  const [visible, setVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [links, setLinks] = useState<CompanyGroupLink[]>([])
  const [adding, setAdding] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const data = await fetchCompanyGroupLinks(companyId)
      setLinks(data)
      setVisible(true)
    } catch {
      setVisible(false)
    } finally {
      setLoaded(true)
    }
  }, [companyId])

  useEffect(() => {
    setLoaded(false)
    void loadData()
  }, [loadData])

  const handleAdd = useCallback(async (relatedCompanyId: string) => {
    try {
      await addCompanyGroupLink(companyId, relatedCompanyId)
      await loadData()
      setAdding(false)
      toast.success('グループ会社を追加しました')
    } catch {
      toast.error('グループ会社の追加に失敗しました')
    }
  }, [companyId, loadData])

  const handleRemove = useCallback(async (link: CompanyGroupLink) => {
    if (!window.confirm(`「${link.relatedCompany.name}」との紐づけを解除しますか？`)) return
    try {
      await deleteCompanyGroupLink(link.id)
      await loadData()
      toast.success('紐づけを解除しました')
    } catch {
      // 既に他ユーザー/別操作で解除済みの場合もここに来る（deleteCompanyGroupLinkの
      // 0件チェック）。DBは正しい状態なのに画面だけ古いリンクが残る「幽霊」を防ぐため
      // 失敗時も再読込して実態に合わせる（DealModal等の削除失敗時ロールバックと同じ考え方）
      await loadData()
      toast.error('紐づけの解除に失敗しました')
    }
  }, [loadData])

  if (!loaded || !visible) return null

  const excludeIds = [companyId, ...links.map((l) => l.relatedCompany.id)]

  return (
    <div className="pt-2 border-t border-gray-100">
      <div className="flex items-center gap-1.5 mb-2">
        <Network className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
        <h3 className="text-sm font-medium text-gray-700">グループ会社</h3>
      </div>

      {links.length > 0 && (
        <ul className="space-y-1.5 mb-2">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-center justify-between gap-2 px-3 py-2 border border-gray-100 rounded-lg text-sm"
            >
              <Link
                href={`/contacts/company/${link.relatedCompany.id}`}
                className="flex items-center gap-2 min-w-0 text-gray-700 hover:text-orange-600"
              >
                <Building2 className="w-3.5 h-3.5 shrink-0 text-gray-300" aria-hidden="true" />
                <span className="truncate">{link.relatedCompany.name}</span>
              </Link>
              <button
                type="button"
                onClick={() => handleRemove(link)}
                aria-label={`${link.relatedCompany.name}との紐づけを解除`}
                className="shrink-0 p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
          <CompanyPicker
            onSelect={(id) => handleAdd(id)}
            excludeIds={excludeIds}
            placeholder="紐づける会社を検索..."
          />
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
          >
            キャンセル
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700
            px-2 py-1.5 rounded-lg hover:bg-orange-50 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          グループ会社を追加
        </button>
      )}
    </div>
  )
}
