// ソーシング画面（一覧・詳細・突合確認）で共有する小さなフォーム部品

export const inputCls = 'w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-orange-500'

interface FieldProps { label: string; children: React.ReactNode; required?: boolean }
export function Field({ label, children, required }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-500 mb-1">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</span>
      {children}
    </label>
  )
}

interface SectionProps { title: string; note?: string; children: React.ReactNode; action?: React.ReactNode }
export function Section({ title, note, children, action }: SectionProps) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide">{title}</h3>
        {note && <span className="text-[11px] text-gray-400">{note}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

interface RowProps { label: string; value: string | null | undefined }
export function Row({ label, value }: RowProps) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-2">
      <span className="text-xs text-gray-400 pt-0.5">{label}</span>
      <span className="text-sm text-gray-700 whitespace-pre-wrap break-words">{value || <span className="text-gray-300">—</span>}</span>
    </div>
  )
}
