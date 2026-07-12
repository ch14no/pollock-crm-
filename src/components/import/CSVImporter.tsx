'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import Papa from 'papaparse'
import { Upload, ArrowRight, Check, Download, AlertCircle, Info, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { isSupabaseConfigured } from '@/lib/db/client'
import { createContact, upsertContactCustomValue, fetchContactsByDivision, updateContact } from '@/lib/db/contacts'
import { findOrCreateCompany } from '@/lib/db/companies'
import { fetchDivisionCustomFields } from '@/lib/db/divisions'
import { useAppStore } from '@/store/appStore'
import type { DivisionCustomField } from '@/store/appStore'
import { escapeCsvCell, isValidEmail } from '@/lib/utils'
import toast from 'react-hot-toast'

const SYSTEM_FIELDS = [
  { key: 'name',       label: '担当者名',         required: true  },
  { key: 'company',    label: '会社名',            required: false },
  { key: 'email',      label: 'メールアドレス',    required: false },
  { key: 'phone',      label: '電話番号',           required: false },
  { key: 'position',   label: '役職',               required: false },
  { key: 'department', label: '部署名',             required: false },
  { key: 'address',    label: '住所',               required: false },
  { key: 'notes',      label: 'メモ・備考',         required: false },
  { key: 'tags',       label: 'タグ（|区切り）',    required: false },
  { key: 'skip',       label: '取り込まない',       required: false },
]

const mappingKey = (divisionId: string) => `pollock-import-mapping-${divisionId}`

function guessFieldKey(header: string): string {
  const h = header.toLowerCase()
  if (h.includes('名前') || h.includes('氏名') || h === 'name' || (h.includes('担当') && (h.includes('者名') || h.includes('名')))) return 'name'
  if (h.includes('会社') || h.includes('企業') || h === 'company') return 'company'
  if (h.includes('mail') || h.includes('メール')) return 'email'
  if (h.includes('tell') || h.includes('tel') || h.includes('電話') || h.includes('phone')) return 'phone'
  if (h.includes('役職') || h.includes('position') || h.includes('肩書')) return 'position'
  if (h.includes('部署') || h.includes('department') || h.includes('section')) return 'department'
  if (h.includes('住所') || h.includes('address') || h.includes('所在地')) return 'address'
  if (h.includes('メモ') || h.includes('備考') || h.includes('note') || h.includes('remark')) return 'notes'
  if (h.includes('タグ') || h === 'tag') return 'tags'
  return 'skip'
}

type Step = 'upload' | 'mapping' | 'preview' | 'importing' | 'done'

interface ImportError {
  row: number
  name: string
  message: string
}

interface CompanyOnlyEntry {
  row: number
  company: string
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
  const storeCustomFields = useAppStore((s) => s.divisionCustomFields)
  const targetDivisionId = divisionId ?? activeDivisionId

  const [step, setStep]         = useState<Step>('upload')
  const [file, setFile]         = useState<File | null>(null)
  const [headers, setHeaders]   = useState<string[]>([])
  const [rows, setRows]         = useState<string[][]>([])
  const [mapping, setMapping]   = useState<Record<string, string>>({})
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [importResult, setImportResult] = useState<{ success: number; updated: number; skipped: number; companyOnly: number; companyOnlyList: CompanyOnlyEntry[]; errors: ImportError[] } | null>(null)
  const [duplicateMode, setDuplicateMode] = useState<'skip' | 'update'>('skip')
  const [customFields, setCustomFields] = useState<DivisionCustomField[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // インポート中の離脱を防ぐ
  useEffect(() => {
    if (step !== 'importing') return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [step])

  // 事業部のカスタムフィールドを取得
  useEffect(() => {
    if (!targetDivisionId) return
    if (isSupabaseConfigured()) {
      fetchDivisionCustomFields(targetDivisionId).then((fields) => {
        setCustomFields(fields.length > 0 ? fields : (storeCustomFields[targetDivisionId] ?? []))
      }).catch(() => {
        setCustomFields(storeCustomFields[targetDivisionId] ?? [])
      })
    } else {
      setCustomFields(storeCustomFields[targetDivisionId] ?? [])
    }
  }, [targetDivisionId]) // eslint-disable-line

  // システムフィールド + カスタムフィールド の全マッピング選択肢
  const allMappingFields = useMemo(() => [
    ...SYSTEM_FIELDS,
    ...customFields.map((f) => ({ key: `custom_${f.id}`, label: f.label, required: false })),
  ], [customFields])

  const getLabelForKey = (key: string): string =>
    allMappingFields.find((f) => f.key === key)?.label ?? key

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

        // 保存済みマッピングを読み込む（事業部別）
        const saved: Record<string, string> = targetDivisionId
          ? JSON.parse(localStorage.getItem(mappingKey(targetDivisionId)) ?? '{}')
          : {}

        // 自動マッピング（ヘッダー名から推測）
        const autoMap: Record<string, string> = {}
        hdrs.forEach((h) => { autoMap[h] = guessFieldKey(h) })

        // 保存済み > 自動推測の優先度でマージ（保存済みに存在するヘッダーのみ適用）
        const savedForHeaders: Record<string, string> = {}
        hdrs.forEach((h) => {
          if (saved[h]) savedForHeaders[h] = saved[h]
        })
        setMapping({ ...autoMap, ...savedForHeaders })
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

  const handleProceedToPreview = () => {
    // マッピングをlocalStorageに保存（事業部別）
    if (targetDivisionId) {
      localStorage.setItem(mappingKey(targetDivisionId), JSON.stringify(mapping))
    }
    setStep('preview')
  }

  const handleResetMapping = () => {
    if (!targetDivisionId) return
    localStorage.removeItem(mappingKey(targetDivisionId))
    toast.success('保存済みマッピングをリセットしました')
    const autoMap: Record<string, string> = {}
    headers.forEach((h) => { autoMap[h] = guessFieldKey(h) })
    setMapping(autoMap)
  }

  const getField = (row: string[], key: string): string => {
    const header = Object.keys(mapping).find((h) => mapping[h] === key)
    if (!header) return ''
    return row[headers.indexOf(header)]?.trim() ?? ''
  }

  const handleImport = async () => {
    if (!targetDivisionId) { toast.error('事業部が選択されていません'); return }
    setStep('importing')
    setProgress(0)

    const errors: ImportError[] = []
    const companyOnlyList: CompanyOnlyEntry[] = []
    let success = 0
    let skipped = 0
    let companyOnly = 0

    // 既存データを取得。email+name → contactId のマップを構築
    // ※メールのみ一致でも名前が違う場合は別人として取り込む（共通メール対応）
    const existingMap = new Map<string, string>() // `${email}|${name}` → contactId
    if (isSupabaseConfigured()) {
      setProgressMsg('既存データを確認中...')
      const existingContacts = await fetchContactsByDivision(targetDivisionId).catch(() => [])
      for (const c of existingContacts) {
        if (c.email) {
          existingMap.set(`${c.email.toLowerCase()}|${c.name.toLowerCase().trim()}`, c.id)
        }
      }
    }

    // カスタムフィールドのマッピングを事前抽出
    const customMappings = Object.entries(mapping)
      .filter(([, v]) => v.startsWith('custom_'))
      .map(([header, key]) => ({ header, fieldId: key.replace('custom_', '') }))

    let updated = 0

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2
      const name       = getField(row, 'name')
      const company    = getField(row, 'company')
      const email      = getField(row, 'email')
      const phone      = getField(row, 'phone')
      const position   = getField(row, 'position')
      const department = getField(row, 'department')
      const address    = getField(row, 'address')
      const notes      = getField(row, 'notes')
      const tagsRaw    = getField(row, 'tags')

      setProgressMsg(`${i + 1}/${rows.length} 件処理中: ${name || `行${rowNum}`}`)
      setProgress(Math.round(((i + 1) / rows.length) * 100))

      if (!name) {
        // 担当者名は必須（contactsテーブルのNOT NULL制約）だが、会社名だけは
        // companiesテーブルが担当者に依存しない独立マスタのため先行登録できる
        if (company) {
          if (isSupabaseConfigured()) {
            try {
              await findOrCreateCompany(company)
            } catch (err) {
              errors.push({ row: rowNum, name: '(空)', message: err instanceof Error ? err.message : '企業の登録に失敗しました' })
              continue
            }
          } else {
            await new Promise((r) => setTimeout(r, 30))
          }
          companyOnly++
          companyOnlyList.push({ row: rowNum, company })
        } else {
          errors.push({ row: rowNum, name: '(空)', message: '担当者名が空です（会社名もありません）' })
        }
        continue
      }
      if (email && !isValidEmail(email)) {
        errors.push({ row: rowNum, name, message: `メールアドレスの形式が正しくありません: ${email}` }); continue
      }

      // 名前＋メール両方一致で既存チェック
      const existingId = email ? existingMap.get(`${email.toLowerCase()}|${name.toLowerCase().trim()}`) : undefined

      if (existingId) {
        if (duplicateMode === 'skip') {
          skipped++
          continue
        }
        // 更新モード: 非空の項目だけ上書き
        if (!isSupabaseConfigured()) { updated++; await new Promise((r) => setTimeout(r, 30)); continue }
        try {
          const tags = tagsRaw ? tagsRaw.split(/[|,、]/).map((t) => t.trim()).filter(Boolean) : []
          await updateContact(existingId, {
            ...(phone      && { phone }),
            ...(position   && { position }),
            ...(department && { department }),
            ...(address    && { address }),
            ...(notes      && { notes }),
            ...(tags.length > 0 && { tags }),
          })
          for (const { header, fieldId } of customMappings) {
            const value = row[headers.indexOf(header)]?.trim()
            if (value) await upsertContactCustomValue(existingId, fieldId, value)
          }
          updated++
        } catch (err) {
          errors.push({ row: rowNum, name, message: err instanceof Error ? err.message : '更新に失敗しました' })
        }
        continue
      }

      if (!isSupabaseConfigured()) { success++; await new Promise((r) => setTimeout(r, 30)); continue }

      try {
        const companyId = company ? (await findOrCreateCompany(company)) ?? undefined : undefined
        const tags = tagsRaw ? tagsRaw.split(/[|,、]/).map((t) => t.trim()).filter(Boolean) : []

        const contact = await createContact({
          divisionId: targetDivisionId, name,
          email: email || undefined, phone: phone || undefined,
          position: position || undefined, department: department || undefined,
          address: address || undefined, notes: notes || undefined,
          companyId, tags,
        })

        if (email) existingMap.set(`${email.toLowerCase()}|${name.toLowerCase().trim()}`, contact.id)

        for (const { header, fieldId } of customMappings) {
          const value = row[headers.indexOf(header)]?.trim()
          if (value) await upsertContactCustomValue(contact.id, fieldId, value)
        }

        success++
      } catch (err) {
        errors.push({ row: rowNum, name, message: err instanceof Error ? err.message : '登録に失敗しました' })
      }
    }

    setImportResult({ success, updated, skipped, companyOnly, companyOnlyList, errors })
    setStep('done')
    const parts = [
      success  > 0 ? `${success}件登録`  : '',
      updated  > 0 ? `${updated}件更新`  : '',
      companyOnly > 0 ? `${companyOnly}件は会社のみ登録` : '',
      skipped  > 0 ? `${skipped}件スキップ` : '',
      errors.length > 0 ? `${errors.length}件エラー` : '',
    ].filter(Boolean).join('、')
    if (errors.length === 0) toast.success(`${parts}しました`)
    else toast(parts, { icon: '⚠️' })
  }

  const handleDownloadErrorReport = () => {
    if (!importResult?.errors.length) return
    const lines = ['行番号,担当者名,エラー内容', ...importResult.errors.map(
      (e) => `${e.row},${escapeCsvCell(e.name)},${escapeCsvCell(e.message)}`
    )]
    downloadCSV(lines.join('\n'), `import_errors_${new Date().toISOString().slice(0, 10)}.csv`)
  }

  const handleReset = () => {
    setStep('upload'); setFile(null); setRows([]); setHeaders([])
    setMapping({}); setProgress(0); setProgressMsg(''); setImportResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ─── 完了画面 ───────────────────────────────────────────────────
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
          {(importResult?.success ?? 0) > 0 && (
            <p>新規登録: <strong className="text-green-600">{importResult?.success}件</strong></p>
          )}
          {(importResult?.updated ?? 0) > 0 && (
            <p>更新: <strong className="text-blue-600">{importResult?.updated}件</strong></p>
          )}
          {(importResult?.companyOnly ?? 0) > 0 && (
            <p>会社のみ登録（担当者名なし）: <strong className="text-blue-600">{importResult?.companyOnly}件</strong></p>
          )}
          {(importResult?.skipped ?? 0) > 0 && (
            <p>スキップ（重複）: <strong className="text-yellow-600">{importResult?.skipped}件</strong></p>
          )}
          {(importResult?.errors.length ?? 0) > 0 && (
            <p>エラー: <strong className="text-red-500">{importResult?.errors.length}件</strong></p>
          )}
        </div>
        {(importResult?.companyOnlyList.length ?? 0) > 0 && (
          <div className="mb-4 text-left bg-blue-50 border border-blue-100 rounded-xl p-3 max-h-40 overflow-y-auto">
            <p className="text-xs text-blue-700 font-medium mb-1">担当者未登録のまま会社のみ登録した行（後日、担当者情報を追記してください）</p>
            {importResult!.companyOnlyList.slice(0, 10).map((e, i) => (
              <p key={i} className="text-xs text-blue-600">行{e.row} <strong>{e.company}</strong></p>
            ))}
            {importResult!.companyOnlyList.length > 10 && (
              <p className="text-xs text-blue-400">... 他{importResult!.companyOnlyList.length - 10}件</p>
            )}
          </div>
        )}
        {(importResult?.errors.length ?? 0) > 0 && (
          <div className="mb-4 text-left bg-red-50 border border-red-100 rounded-xl p-3 max-h-40 overflow-y-auto">
            {importResult!.errors.slice(0, 10).map((e, i) => (
              <p key={i} className="text-xs text-red-600 mb-1">行{e.row} <strong>{e.name}</strong>: {e.message}</p>
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
          <Button onClick={handleReset}>続けてインポート</Button>
        </div>
      </Card>
    )
  }

  if (step === 'importing') {
    return (
      <Card className="p-8 text-center max-w-md mx-auto">
        <div className="flex items-center gap-2 justify-center px-4 py-2 mb-6 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800 text-sm">
          <AlertCircle size={15} className="flex-shrink-0" />
          インポート中はこのページから離れないでください
        </div>
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

      {/* ─── ファイル選択 ─── */}
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
            <input ref={fileRef} type="file" accept=".csv" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
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

      {/* ─── 列のマッピング ─── */}
      {step === 'mapping' && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-gray-800">列のマッピング</h2>
              <p className="text-xs text-gray-400 mt-0.5">{rows.length}行のデータを検出しました</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleResetMapping}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-orange-500 transition-colors px-2 py-1.5 rounded-lg hover:bg-orange-50"
                title="保存済みマッピングをリセット"
              >
                <RotateCcw size={12} />
                リセット
              </button>
              <span className="text-sm text-gray-500 truncate max-w-36">{file?.name}</span>
            </div>
          </div>
          {!canProceed && (
            <div className="px-5 py-2.5 bg-yellow-50 border-b border-yellow-100 text-xs text-yellow-700 flex items-center gap-1.5">
              <AlertCircle size={13} />
              「担当者名」は必須です。対応する列を選択してください。
            </div>
          )}
          {targetDivisionId && localStorage.getItem(mappingKey(targetDivisionId)) && (
            <div className="px-5 py-2 bg-green-50 border-b border-green-100 text-xs text-green-700 flex items-center gap-1.5">
              <Check size={12} />
              この事業部の保存済みマッピングを適用しました
            </div>
          )}
          <div className="p-5 space-y-3">
            {/* カスタムフィールドがある場合の説明 */}
            {customFields.length > 0 && (
              <p className="text-xs text-gray-400">
                選択肢には基本項目のほか、この事業部のカスタムフィールド（{customFields.map((f) => f.label).join('・')}）も含まれています。
              </p>
            )}
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
                  {/* システムフィールド */}
                  <optgroup label="基本項目">
                    {SYSTEM_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}{f.required ? ' *' : ''}
                      </option>
                    ))}
                  </optgroup>
                  {/* カスタムフィールド */}
                  {customFields.length > 0 && (
                    <optgroup label="カスタム項目">
                      {customFields.map((f) => (
                        <option key={f.id} value={`custom_${f.id}`}>{f.label}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <div className="w-28 text-xs text-gray-400 truncate flex-shrink-0" title={rows[0]?.[headers.indexOf(header)]}>
                  例: {rows[0]?.[headers.indexOf(header)] || '—'}
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 pb-5 flex justify-between">
            <Button variant="secondary" onClick={() => setStep('upload')}>戻る</Button>
            <Button onClick={handleProceedToPreview} disabled={!canProceed}>
              プレビューへ（マッピングを保存）
            </Button>
          </div>
        </Card>
      )}

      {/* ─── プレビュー ─── */}
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
                        {getLabelForKey(v)}
                        <span className="text-gray-300 ml-1 font-normal">({h})</span>
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.slice(0, 5).map((row, i) => {
                  const name = getField(row, 'name')
                  return (
                    <tr key={i} className={!name ? 'bg-red-50' : 'hover:bg-gray-50'}>
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
          <div className="px-5 py-4 border-t border-gray-100 space-y-3">
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">重複（名前＋メール一致）時の処理</p>
              <div className="flex gap-4">
                {([
                  { value: 'skip'   as const, label: 'スキップ',         desc: '既存データを変更しない' },
                  { value: 'update' as const, label: '更新する',          desc: '住所・電話番号など空欄を補完・上書き' },
                ] as const).map(({ value, label, desc }) => (
                  <label key={value} className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="duplicateMode"
                      value={value}
                      checked={duplicateMode === value}
                      onChange={() => setDuplicateMode(value)}
                      className="mt-0.5 accent-orange-500"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-700">{label}</p>
                      <p className="text-xs text-gray-400">{desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep('mapping')}>マッピングに戻る</Button>
              <Button onClick={handleImport}>{rows.length}件をインポート</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
