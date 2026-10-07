import type { TsrProspect, TsrPriority } from '@/lib/db/tsrProspects'

// ソーシング（TSR）画面の表示用ヘルパー。一覧（sourcing/page.tsx）と詳細ページ・各パネルで共有する

export const PRIORITY_BADGE: Record<TsrPriority, 'danger' | 'orange' | 'default' | 'info'> = { S: 'danger', A: 'orange', B: 'default', '不明': 'info' }

export const fmtMillion = (thousandYen: number | null) => thousandYen == null ? '—' : `${Math.round(thousandYen / 1000).toLocaleString('ja-JP')}百万円`
export const fmtThousand = (v: number | null) => v == null ? '—' : `${v.toLocaleString('ja-JP')}千円`
export const fmtInt = (v: number | null, unit = '') => v == null ? '—' : `${v.toLocaleString('ja-JP')}${unit}`
export const fmtYm = (d: string | null) => d ? d.slice(0, 7).replace('-', '/') : '—'
export const fmtPct = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(1)}%`
export const fmtEst = (y: number | null, m: number | null) => y ? `${y}年${m ? `${m}月` : ''}` : '—'
export const fmtBirth = (y: number | null, m: number | null, d: number | null) => y ? `${y}${m ? `/${String(m).padStart(2, '0')}` : ''}${d ? `/${String(d).padStart(2, '0')}` : ''}` : '—'

// 代表者の個人情報が1つでも入っているか（氏名欠落でも住所・生年等があれば「あり」として扱い、閲覧記録も残す）
export const hasPersonalInfo = (p: TsrProspect) =>
  [p.rep_name, p.rep_name_kana, p.rep_home_address, p.rep_birth_year, p.rep_birthplace, p.rep_school].some((v) => v != null && v !== '')

// 手動登録の行か（TSR 由来の業績等は無い）
export const isManualProspect = (p: Pick<TsrProspect, 'source'>) => p.source === 'manual'
