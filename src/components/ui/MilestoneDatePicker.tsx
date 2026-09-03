'use client'

import { useState, useRef, useEffect, type CSSProperties } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MilestoneDatePickerProps {
  value: string // 'YYYY-MM-DD' or ''
  onChange: (value: string) => void
  disabled?: boolean
  // 同じ見た目のボタンが複数並ぶ画面（対応期日一覧等）でどの項目の日付欄か
  // 読み上げソフトが区別できるようにする
  milestoneLabel?: string
}

function toDateOnly(value: string): Date | undefined {
  if (!value) return undefined
  // 'YYYY-MM-DD'をローカルタイムゾーンの日付として解釈する（new Date('YYYY-MM-DD')は
  // UTC 0時と解釈されるため、西経のタイムゾーンでは前日にずれることがある）
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ネイティブの<input type="date">は月・年を連続でクリック遡行できない
// （1クリックごとにピッカーが閉じたような挙動になる）という報告への対応（酒田さん依頼）。
// captionLayout="dropdown"でプルダウンから直接月・年を選べるようにし、
// 連続クリックでの遡行そのものを不要にする
export function MilestoneDatePicker({ value, onChange, disabled, milestoneLabel }: MilestoneDatePickerProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const selected = toDateOnly(value)
  const label = selected
    ? selected.toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' })
    : '未設定'

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-label={milestoneLabel ? `${milestoneLabel}の対応期日` : undefined}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 text-sm border border-gray-200 rounded-lg bg-white',
          'focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50',
          !selected && 'text-gray-400'
        )}
      >
        <Calendar size={13} className="flex-shrink-0 text-gray-400" />
        {label}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl p-2"
          style={{ '--rdp-accent-color': '#f97316', '--rdp-accent-background-color': '#fff7ed' } as CSSProperties}
        >
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={(date) => { onChange(date ? toDateString(date) : ''); setOpen(false) }}
            captionLayout="dropdown"
            startMonth={new Date(new Date().getFullYear() - 5, 0)}
            endMonth={new Date(new Date().getFullYear() + 10, 11)}
          />
          <div className="flex items-center justify-between px-2 pb-1">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false) }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              クリア
            </button>
            <button
              type="button"
              onClick={() => { onChange(toDateString(new Date())); setOpen(false) }}
              className="text-xs text-orange-500 hover:text-orange-700 font-medium"
            >
              今日
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
