'use client'

import { useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { CSVImporter } from '@/components/import/CSVImporter'
import { useAppStore } from '@/store/appStore'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchContactsByDivision } from '@/lib/db/contacts'
import toast from 'react-hot-toast'

function exportContactsCSV(contacts: { name: string; companies?: { name: string } | null; position?: string; email?: string; phone?: string; tags: string[]; updated_at: string }[], filename: string) {
  const headers = ['氏名', '会社名', '役職', 'メール', '電話番号', 'タグ', '最終更新']
  const rows = contacts.map((c) => [
    c.name,
    c.companies?.name ?? '',
    c.position ?? '',
    c.email ?? '',
    c.phone ?? '',
    c.tags.join('|'),
    c.updated_at,
  ])
  const csv = [headers, ...rows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function ImportExportPage() {
  const activeDivision = useAppStore((s) => s.activeDivision)
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    if (!activeDivisionId) return
    setExporting(true)
    try {
      const contacts = isSupabaseConfigured()
        ? await fetchContactsByDivision(activeDivisionId)
        : []
      const filename = `contacts_${activeDivision?.name ?? 'export'}_${new Date().toISOString().slice(0, 10)}.csv`
      exportContactsCSV(contacts, filename)
      toast.success(`${contacts.length}件をCSVエクスポートしました`)
    } catch {
      toast.error('エクスポートに失敗しました')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Export */}
      <div>
        <div className="mb-4">
          <h1 className="text-2xl font-black text-gray-800">インポート・エクスポート</h1>
          <p className="text-sm text-gray-500 mt-0.5">顧客データのインポートとCSVエクスポートができます</p>
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
              <Download size={20} className="text-green-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-800">CSVエクスポート</h2>
              <p className="text-xs text-gray-500">現在の事業部（{activeDivision?.name ?? '―'}）の顧客データをエクスポート</p>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 mb-4 text-sm text-gray-600">
            <p className="font-medium mb-1">出力項目</p>
            <p className="text-xs text-gray-500">氏名 / 会社名 / 役職 / メール / 電話番号 / タグ / 最終更新日</p>
          </div>

          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <FileText size={16} />
            {exporting ? 'エクスポート中...' : 'CSVをダウンロード'}
          </button>
        </div>
      </div>

      {/* Import */}
      <div>
        <div className="mb-4">
          <h2 className="text-lg font-bold text-gray-800">CSVインポート</h2>
          <p className="text-sm text-gray-500 mt-0.5">既存のExcel・CSVリストをそのままインポートできます</p>
        </div>
        <CSVImporter />
      </div>
    </div>
  )
}
