import { CSVImporter } from '@/components/import/CSVImporter'

export default function ImportPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-gray-800">CSVインポート</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          既存のExcel・CSVリストをそのままインポートできます
        </p>
      </div>
      <CSVImporter />
    </div>
  )
}
