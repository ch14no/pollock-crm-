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
