'use client'

import { useState, useRef } from 'react'
import Papa from 'papaparse'
import { Upload, ArrowRight, Check, Download, AlertCircle, Info } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { isSupabaseConfigured } from '@/lib/db/client'
import { createContact } from '@/lib/db/contacts'
import { findOrCreateCompany } from '@/lib/db/companies'
import { useAppStore } from '@/store/appStore'
import toast from 'react-hot-toast'

const SYSTEM_FIELDS = [
  { key: 'name',     label: '担当者名',    required: true  },
  { key: 'company',  label: '会社名',      required: false },
  { key: 'email',    label: 'メールアドレス', required: false },
  { key: 'phone',    label: '電話番号',    required: false },
  { key: 'position', label: '役職',        required: false },
  { key: 'tags',     label: 'タグ（|区切り）', required: false },
  { key: 'skip',     label: '取り込まない', required: false },
]

type Step = 'upload' | 'mapping' | 'preview' | 'importing' | 'done'

interface ImportError {
  row: number
  name: string
  message: string
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

interface CSVImporterProps {
  divisionId?: string
}

export function CSVImporter({ divisionId }: CSVImporterProps) {
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const targetDivisionId = divisionId ?? activeDivisionId

  const [step, setStep]         = useState<Step>('upload')
  const [file, setFile]         = useState<File | null>(null)
  const [headers, setHeaders]   = useState<string[]>([])
  const [rows, setRows]         = useState<string[][]>([])
  const [mapping, setMapping]   = useState<Record<string, string>>({})
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [importResult, setImportResult] = useState<{
    success: number; errors: ImportError[]
  } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File) => {
    setFile(f)
    Papa.parse(f, {
      encoding: 'UTF-8',
      complete: (result) => {
        const data = result.data as string[][]
        if (data.length < 2) { toast.error('CSVにデータがありません'); return }
        const hdrs = data[0].map((h) => h.trim())
        const validRows = data.slice(1).filter((r) => r.some((c) => c?.trim()))
        setHeaders(hdrs)
        setRows(validRows)

        // 自動マッピング
        const autoMap: Record<string, string> = {}
        hdrs.forEach((h) => {
          const lower = h.toLowerCase()
          if (lower.includes('名前') || lower.includes('氏名') || lower === 'name' || lower.includes('担当')) autoMap[h] = 'name'
          else if (lower.includes('会社') || lower.includes('企業') || lower === 'company') autoMap[h] = 'company'
          else if (lower.includes('mail') || lower.includes('メール')) autoMap[h] = 'email'
          else if (lower.includes('tel') || lower.includes('電話') || lower.includes('phone')) autoMap[h] = 'phone'
          else if (lower.includes('役職') || lower.includes('position') || lower.includes('肩書')) autoMap[h] = 'position'
          else if (lower.includes('タグ') || lower === 'tag') autoMap[h] = 'tags'
          else autoMap[h] = 'skip'
        })
        setMapping(autoMap)
        setStep('mapping')
      },
      error: () => toast.error('CSVの読み込みに失敗しました。UTF-8形式で保存されているか確認してください。'),
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

  const getField = (row: string[], key: string): string => {
    const header = Object.keys(mapping).find((h) => mapping[h] === key)
    if (!header) return ''
    return row[headers.indexOf(header)]?.trim() ?? ''
  }

  const handleImport = async () => {
    if (!targetDivisionId) {
      toast.error('事業部が選択されていません')
      return
    }
    setStep('importing')
    setProgress(0)

    const errors: ImportError[] = []
    let success = 0

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2
      const name    = getField(row, 'name')
      const company = getField(row, 'company')
      const email   = getField(row, 'email')
      const phone   = getField(row, 'phone')
      const position = getField(row, 'position')
      const tagsRaw  = getField(row, 'tags')

      setProgressMsg(`${i + 1}/${rows.length} 件処理中: ${name || `行${rowNum}`}`)
      setProgress(Math.round(((i + 1) / rows.length) * 100))

      // バリデーション
      if (!name) {
        errors.push({ row: rowNum, name: '(空)', message: '担当者名が空です' })
        continue
      }
      if (email && !validateEmail(email)) {
        errors.push({ row: rowNum, name, message: `メールアドレスの形式が正しくありません: ${email}` })
        continue
      }

      if (!isSupabaseConfigured()) {
        // デモモード：バリデーションのみ
        success++
        await new Promise((r) => setTimeout(r, 30))
        continue
      }

      try {
        const companyId = company
          ? (await findOrCreateCompany(company)) ?? undefined
          : undefined

        const tags = tagsRaw
          ? tagsRaw.split('|').map((t) => t.trim()).filter(Boolean)
          : []

        await createContact({
          divisionId: targetDivisionId,
          name,
          email: email || undefined,
          phone: phone || undefined,
          position: position || undefined,
          companyId,
          tags,
        })
        success++
      } catch (err) {
        const msg = err instanceof Error ? err.message : '登録に失敗しました'
        errors.push({ row: rowNum, name, message: msg })
      }
    }

    setImportResult({ success, errors })
    setStep('done')
    if (errors.length === 0) {
      toast.success(`${success}件のインポートが完了しました`)
    } else {
      toast(`${success}件成功、${errors.length}件エラー`, { icon: '⚠️' })
    }
  }

  const handleDownloadErrorReport = () => {
    if (!importResult?.errors.length) return
    const lines = ['行番号,担当者名,エラー内容', ...importResult.errors.map(
      (e) => `${e.row},"${e.name}","${e.message}"`
    )]
    downloadCSV(lines.join('\n'), `import_errors_${new Date().toISOString().slice(0, 10)}.csv`)
  }

  const handleReset = () => {
    setStep('upload')
    setFile(null)
    setRows([])
    setHeaders([])
    setMapping({})
    setProgress(0)
    setProgressMsg('')
    setImportResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  if (step === 'done') {
    return (
      <Card className="p-8 text-center max-w-md mx-auto">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
          (importResult?.errors.length ?? 0) > 0 ? 'bg-yellow-100' : 'bg-green-100'
        }`}>
          {(importResult?.errors.length ?? 0) > 0
            ? <AlertCircle size={32} className="text-yellow-500" />
            : <Check size={32} className="text-green-500" />}
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">インポート完了</h2>
        <div className="text-sm text-gray-600 space-y-1 mb-6">
          <p>成功: <strong className="text-green-600">{importResult?.success}件</strong></p>
          {(importResult?.errors.length ?? 0) > 0 && (
            <p>エラー: <strong className="text-red-500">{importResult?.errors.length}件</strong></p>
          )}
        </div>
        {(importResult?.errors.length ?? 0) > 0 && (
          <div className="mb-4 text-left bg-red-50 border border-red-100 rounded-xl p-3 max-h-40 overflow-y-auto">
            {importResult!.errors.slice(0, 10).map((e, i) => (
              <p key={i} className="text-xs text-red-600 mb-1">
                行{e.row} <strong>{e.name}</strong>: {e.message}
              </p>
            ))}
            {importResult!.errors.length > 10 && (
              <p className="text-xs text-red-400">... 他{importResult!.errors.length - 10}件</p>
            )}
          </div>
        )}
        <div className="flex gap-2 justify-center flex-wrap">
          {(importResult?.errors.length ?? 0) > 0 && (
            <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={handleDownloadErrorReport}>
              エラーレポートDL
            </Button>
          )}
          <Button onClick={handleReset}>
            続けてインポート
          </Button>
        </div>
      </Card>
    )
  }

  if (step === 'importing') {
    return (
      <Card className="p-8 text-center max-w-md mx-auto">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <h2 className="text-lg font-bold text-gray-800 mb-2">インポート中...</h2>
        <p className="text-sm text-gray-500 mb-4 min-h-5">{progressMsg}</p>
        <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden mb-2">
          <div className="h-full bg-orange-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-xs text-gray-400">{progress}%</p>
      </Card>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* ステップインジケーター */}
      <div className="flex items-center gap-2 text-sm">
        {(['upload', 'mapping', 'preview'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <ArrowRight size={14} className="text-gray-300" />}
            <div className={`flex items-center gap-1.5 ${step === s ? 'text-orange-600 font-medium' : 'text-gray-400'}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                step === s ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-500'
              }`}>{i + 1}</div>
              {['ファイル選択', '列のマッピング', '確認・実行'][i]}
            </div>
          </div>
        ))}
      </div>

      {step === 'upload' && (
        <div className="space-y-3">
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
            <p className="text-xs text-gray-300 mt-2">.csv 形式・UTF-8 エンコード</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </div>
          <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
            <Info size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              Excelで作成したCSVは「UTF-8（BOM付き）」で保存してください。<br />
              ファイル → 名前を付けて保存 → ファイルの種類「CSV UTF-8（コンマ区切り）」を選択。
            </span>
          </div>
        </div>
      )}

      {step === 'mapping' && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-gray-800">列のマッピング</h2>
              <p className="text-xs text-gray-400 mt-0.5">{rows.length}行のデータを検出しました</p>
            </div>
            <span className="text-sm text-gray-500 truncate max-w-36">{file?.name}</span>
          </div>
          {!canProceed && (
            <div className="px-5 py-2.5 bg-yellow-50 border-b border-yellow-100 text-xs text-yellow-700 flex items-center gap-1.5">
              <AlertCircle size={13} />
              「担当者名」は必須です。対応する列を選択してください。
            </div>
          )}
          <div className="p-5 space-y-3">
            {headers.map((header) => (
              <div key={header} className="flex items-center gap-3">
                <div className="w-36 text-sm font-medium text-gray-700 truncate flex-shrink-0" title={header}>{header}</div>
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
                <div className="w-28 text-xs text-gray-400 truncate flex-shrink-0" title={rows[0]?.[headers.indexOf(header)]}>
                  例: {rows[0]?.[headers.indexOf(header)] || '—'}
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 pb-5 flex justify-between">
            <Button variant="secondary" onClick={() => setStep('upload')}>戻る</Button>
            <Button onClick={() => setStep('preview')} disabled={!canProceed}>プレビューへ</Button>
          </div>
        </Card>
      )}

      {step === 'preview' && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-800">インポートのプレビュー</h2>
            <p className="text-sm text-gray-500">{rows.length}件のデータをインポートします（先頭5件を表示）</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-400 w-10">#</th>
                  {Object.entries(mapping)
                    .filter(([, v]) => v !== 'skip')
                    .map(([h, v]) => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">
                        {SYSTEM_FIELDS.find((f) => f.key === v)?.label}
                        <span className="text-gray-300 ml-1 font-normal">({h})</span>
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.slice(0, 5).map((row, i) => {
                  const name = getField(row, 'name')
                  const hasError = !name
                  return (
                    <tr key={i} className={hasError ? 'bg-red-50' : 'hover:bg-gray-50'}>
                      <td className="px-3 py-2.5 text-xs text-gray-300">{i + 2}</td>
                      {Object.entries(mapping)
                        .filter(([, v]) => v !== 'skip')
                        .map(([h]) => (
                          <td key={h} className="px-4 py-2.5 text-gray-700 truncate max-w-36">
                            {row[headers.indexOf(h)] || <span className="text-gray-300">—</span>}
                          </td>
                        ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rows.length > 5 && (
              <p className="text-center text-xs text-gray-400 py-2">... 他 {rows.length - 5}件</p>
            )}
          </div>
          <div className="px-5 py-4 border-t border-gray-100 flex justify-between items-center">
            <Button variant="secondary" onClick={() => setStep('mapping')}>戻る</Button>
            <Button onClick={handleImport} icon={<Upload size={14} />}>
              {rows.length}件をインポート
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
