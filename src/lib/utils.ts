import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// モバイルの自動大文字化（HTTPS://...）も有効なURLとして受け付ける
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

// 検索用の正規化（全角/半角・大文字小文字を吸収）
export function normalizeForSearch(str: string): string {
  return str.toLowerCase().normalize('NFKC')
}

export function matchSearch(value: string | undefined, query: string): boolean {
  if (!value) return false
  return normalizeForSearch(value).includes(normalizeForSearch(query))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(amount)
}

// 金額を「2億3,000万円」のような日本語単位で表す（億単位が普通のM&A案件でも桁が直感的に読めるように）。
// 1万円未満は「8,500円」のように円表記のまま。万未満の端数がある場合は「約」を付ける。
export function formatCurrencyJa(amount: number): string {
  if (!Number.isFinite(amount)) return ''
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (abs < 10_000) return `${sign}${abs.toLocaleString('ja-JP')}円`
  const oku = Math.floor(abs / 100_000_000)
  const man = Math.floor((abs % 100_000_000) / 10_000)
  const hasRest = abs % 10_000 > 0
  let out = ''
  if (oku > 0) out += `${oku.toLocaleString('ja-JP')}億`
  if (man > 0 || oku === 0) out += `${man.toLocaleString('ja-JP')}万`
  return `${hasRest ? '約' : ''}${sign}${out}円`
}

// CSVセル値のエスケープ。ダブルクオートの二重化に加え、Excelで数式として実行され得る
// 先頭文字（= @ タブ CR）には数式インジェクション対策としてシングルクオートを前置する。
// 「+」「-」は国際電話番号（+81-…）や箇条書きメモに正当に現れ、エクスポート→再インポートで
// アポストロフィがDBへ混入してしまうため対象外とする（=で始まる数式が主要な攻撃経路）
export function escapeCsvCell(value: unknown): string {
  const s = String(value ?? '')
  const guarded = /^[=@\t\r]/.test(s) ? `'${s}` : s
  return `"${guarded.replace(/"/g, '""')}"`
}

// メールアドレスの形式チェック（新規登録・詳細編集・CSVインポートで共通）
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// 中間省略。M&Aのステージ名のような「共通接頭辞＋末尾に識別情報」の文字列を、
// 末尾切り（CSS truncate）ではなく前後を残して省略する
export function truncateMiddle(name: string, max = 12): string {
  if (name.length <= max) return name
  const head = Math.max(2, Math.floor((max - 1) / 3))
  const tail = max - 1 - head
  return `${name.slice(0, head)}…${name.slice(name.length - tail)}`
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatRelativeTime(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return '今日'
  if (diffDays === 1) return '昨日'
  if (diffDays < 7) return `${diffDays}日前`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}週間前`
  return `${Math.floor(diffDays / 30)}ヶ月前`
}

export function getStaleDays(updatedAt: string): number {
  const now = new Date()
  const updated = new Date(updatedAt)
  return Math.floor((now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24))
}

export function getInitials(name: string): string {
  const parts = name.split(/[\s　]+/)
  if (parts.length >= 2) return parts[0].charAt(0) + parts[1].charAt(0)
  return name.slice(0, 2)
}
