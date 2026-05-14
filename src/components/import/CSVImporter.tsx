'use client'

import { useState, useRef } from 'react'
import Papa from 'papaparse'
import { Upload, X, ArrowRight, Check, Download } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import toast from 'react-hot-toast'

const SYSTEM_FIELDS = [
  { key: 'name',     label: '担当者名',  required: true },
  { key: 'company',  label: '会社名',    required: true },
  { key: 'email',    label: 'メールアドレス' },
  { key: 'phone',    label: '電話番号' },
  { key: 'position', label: '役職' },
  { key: 'skip',     label: '取り込まない' },
]

type Step = 'upload' | 'mapping' | 'preview' | 'done'

export function CSVImporter() {
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [importResult, setImportResult] = useState<{ success: number; errors: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File) => {
    setFile(f)
    Papa.parse(f, {
      complete: (result) => {
        const data = result.data as string[][]
        if (data.length < 2) {
          toast.error('CSVにデータがありません')
          return
        }
        const hdrs = data[0]
        setHeaders(hdrs)
        setRows(data.slice(1).filter((r) => r.some((c) => c.trim())))

        // Auto-detect mapping
        const autoMap: Record<string, string> = {}
        hdrs.forEach((h) => {
          const lower = h.toLowerCase()
          if (lower.includes('名前') || lower.includes('氏名') || lower === 'name') autoMap[h] = 'name'
          else if (lower.includes('会社') || lower.includes('企業') || lower === 'company') autoMap[h] = 'company'
          else if (lower.includes('mail') || lower.includes('メール')) autoMap[h] = 'email'
          else if (lower.includes('tel') || lower.includes('電話')) autoMap[h] = 'phone'
          else if (lower.includes('役職') || lower.includes('position')) autoMap[h] = 'position'
          else autoMap[h] = 'skip'
        })
        setMapping(autoMap)
        setStep('mapping')
      },
      error: () => toast.error('CSVの読み込みに失敗しました'),
    })
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f?.type === 'text/csv' || f?.name.endsWith('.csv')) handleFile(f)
    else toast.error('CSVファイルを選択してください')
  }

  const canProceed = SYSTEM_FIELDS.filter((f) => f.required).every((f) =>
    Object.values(mapping).includes(f.key)
  )

  const handleImport = async () => {
    setLoading(true)
    toast.loading('インポート処理中です...', { id: 'import' })
    await new Promise((r) => setTimeout(r, 1500))
    setLoading(false)
    const success = rows.length - Math.floor(rows.length * 0.05)
    const errors = rows.length - success
    setImportResult({ success, errors })
    setStep('done')
    toast.success(`インポートが完了しました（${success}件成功）`, { id: 'import' })
  }

  if (step === 'done') {
    return (
      <Card className="p-8 text-center max-w-md mx-auto">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Check size={32} className="text-green-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">インポート完了</h2>
        <div className="text-sm text-gray-600 space-y-1 mb-6">
          <p>成功: <strong className="text-green-600">{importResult?.success}件</strong></p>
          {(importResult?.errors ?? 0) > 0 && (
            <p>エラー: <strong className="text-red-500">{importResult?.errors}件</strong></p>
          )}
        </div>
        <div className="flex gap-2 justify-center flex-wrap">
          {(importResult?.errors ?? 0) > 0 && (
            <Button variant="secondary" size="sm" icon={<Download size={14} />}>
              エラーレポートDL
            </Button>
          )}
          <Button onClick={() => { setStep('upload'); setFile(null); setRows([]); setHeaders([]) }}>
            続けてインポート
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(['upload', 'mapping', 'preview'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <ArrowRight size={14} className="text-gray-300" />}
            <div className={`flex items-center gap-1.5 ${step === s ? 'text-orange-600 font-medium' : 'text-gray-400'}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                step === s ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-500'
              }`}>{i + 1}</div>
              {['ファイル選択', '項目マッピング', '確認・実行'][i]}
            </div>
          </div>
        ))}
      </div>

      {step === 'upload' && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-200 rounded-2xl p-12 text-center cursor-pointer
            hover:border-orange-400 hover:bg-orange-50/30 transition-all"
        >
          <Upload size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-600 font-medium mb-1">CSVファイルをドラッグ＆ドロップ</p>
          <p className="text-sm text-gray-400">またはクリックしてファイルを選択</p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>
      )}

      {step === 'mapping' && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-bold text-gray-800">項目のマッピング</h2>
            <span className="text-sm text-gray-500">{file?.name}</span>
          </div>
          {!canProceed && (
            <div className="px-5 py-2 bg-yellow-50 border-b border-yellow-100 text-xs text-yellow-700">
              「担当者名」と「会社名」は必須項目です。対応する列を選択してください。
            </div>
          )}
          <div className="p-5 space-y-3">
            {headers.map((header) => (
              <div key={header} className="flex items-center gap-3">
                <div className="w-40 text-sm font-medium text-gray-700 truncate">{header}</div>
                <ArrowRight size={14} className="text-gray-300 flex-shrink-0" />
                <select
                  value={mapping[header] ?? 'skip'}
                  onChange={(e) => setMapping((m) => ({ ...m, [header]: e.target.value }))}
                  className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50"
                >
                  {SYSTEM_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}{f.required ? ' *' : ''}
                    </option>
                  ))}
                </select>
                <div className="w-24 text-xs text-gray-400 truncate">
                  例: {rows[0]?.[headers.indexOf(header)] ?? '—'}
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 pb-5 flex justify-between">
            <Button variant="secondary" onClick={() => setStep('upload')}>戻る</Button>
            <Button onClick={() => setStep('preview')} disabled={!canProceed}>
              プレビューへ
            </Button>
          </div>
        </Card>
      )}

      {step === 'preview' && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-800">インポートのプレビュー</h2>
            <p className="text-sm text-gray-500">{rows.length}件のデータをインポートします</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {Object.entries(mapping)
                    .filter(([, v]) => v !== 'skip')
                    .map(([h]) => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">
                        {SYSTEM_FIELDS.find((f) => f.key === mapping[h])?.label} ({h})
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.slice(0, 5).map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {Object.entries(mapping)
                      .filter(([, v]) => v !== 'skip')
                      .map(([h]) => (
                        <td key={h} className="px-4 py-2.5 text-gray-700 truncate max-w-32">
                          {row[headers.indexOf(h)]}
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 5 && (
              <p className="text-center text-xs text-gray-400 py-2">... 他 {rows.length - 5}件</p>
            )}
          </div>
          <div className="px-5 pb-5 flex justify-between mt-4">
            <Button variant="secondary" onClick={() => setStep('mapping')}>戻る</Button>
            <Button loading={loading} onClick={handleImport} icon={<Upload size={14} />}>
              {loading ? 'インポート中...' : `${rows.length}件をインポート`}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
