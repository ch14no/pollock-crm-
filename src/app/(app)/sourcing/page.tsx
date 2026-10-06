'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Search, SlidersHorizontal, Download, X, Building2, ChevronLeft, ChevronRight, ExternalLink, Lock } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAppStore } from '@/store/appStore'
import { MA_DIVISION_NAME } from '@/lib/config'
import { PREFECTURES, downloadCsv, cn, formatErrorDetail } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { fetchDivisionUsers } from '@/lib/db/users'
import {
  searchTsrProspects, fetchTsrProspectsForExport, fetchTsrIndustryOptions, updateTsrProspectOps,
  logTsrProspectView, logTsrProspectExport, promoteTsrProspectToCompany,
  TSR_STATUSES, TSR_APPROACH_TYPES,
  type TsrProspect, type TsrProspectPublic, type TsrFilters, type TsrSortKey, type TsrIndustryOption, type TsrPriority,
} from '@/lib/db/tsrProspects'
import type { User } from '@/types/database'

const PAGE_SIZE = 50
const EXPORT_MAX = 20000

const SORT_OPTIONS: { value: TsrSortKey; label: string }[] = [
  { value: 'priority', label: '優先度順' },
  { value: 'sales_desc', label: '売上が大きい順' },
  { value: 'age_desc', label: '代表者年齢が高い順' },
  { value: 'surveyed_desc', label: '調査日が新しい順' },
  { value: 'name', label: '商号（カナ）順' },
]

const PRIORITY_BADGE: Record<TsrPriority, 'danger' | 'orange' | 'default' | 'info'> = { S: 'danger', A: 'orange', B: 'default', '不明': 'info' }

const fmtMillion = (thousandYen: number | null) => thousandYen == null ? '—' : `${Math.round(thousandYen / 1000).toLocaleString('ja-JP')}百万円`
const fmtThousand = (v: number | null) => v == null ? '—' : `${v.toLocaleString('ja-JP')}千円`
const fmtInt = (v: number | null, unit = '') => v == null ? '—' : `${v.toLocaleString('ja-JP')}${unit}`
const fmtYm = (d: string | null) => d ? d.slice(0, 7).replace('-', '/') : '—'
const fmtPct = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(1)}%`
const fmtEst = (y: number | null, m: number | null) => y ? `${y}年${m ? `${m}月` : ''}` : '—'
const fmtBirth = (y: number | null, m: number | null, d: number | null) => y ? `${y}${m ? `/${String(m).padStart(2, '0')}` : ''}${d ? `/${String(d).padStart(2, '0')}` : ''}` : '—'

// 代表者の個人情報が1つでも入っているか（氏名欠落でも住所・生年等があれば「あり」として扱い、閲覧記録も残す）
const hasPersonalInfo = (p: TsrProspect) =>
  [p.rep_name, p.rep_name_kana, p.rep_home_address, p.rep_birth_year, p.rep_birthplace, p.rep_school].some((v) => v != null && v !== '')

type NumInput ={ [K in 'employeesMin' | 'employeesMax' | 'capitalMin' | 'capitalMax' | 'salesMin' | 'salesMax' | 'ageMin' | 'ageMax']?: string }

export default function SourcingPage() {
  const router = useRouter()
  const activeDivision = useAppStore((s) => s.activeDivision)
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const currentUser = useAppStore((s) => s.currentUser)
  const isMA = activeDivision?.name === MA_DIVISION_NAME

  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Omit<TsrFilters, 'query' | keyof NumInput>>({})
  const [nums, setNums] = useState<NumInput>({})
  const [sort, setSort] = useState<TsrSortKey>('priority')
  const [page, setPageRaw] = useState(0)
  const [showFilters, setShowFilters] = useState(false)
  const [rows, setRows] = useState<TsrProspect[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  // 正確な件数が取れなかったとき（タイムアウト等）は概算なので「約」を付けて表示する
  const [totalIsExact, setTotalIsExact] = useState(true)
  const totalLabel = `${totalIsExact ? '' : '約'}${total.toLocaleString()}`
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [industries, setIndustries] = useState<TsrIndustryOption[]>([])
  const [members, setMembers] = useState<User[]>([])
  const [selected, setSelected] = useState<TsrProspect | null>(null)
  const [exporting, setExporting] = useState(false)
  const seq = useRef(0)

  // 千円・人・歳の数値入力は空欄＝条件なし。カンマ入りでも受け付ける
  const effectiveFilters = useMemo<TsrFilters>(() => {
    const num = (v?: string) => { const n = Number((v ?? '').replace(/[,，\s]/g, '')); return v && Number.isFinite(n) ? n : undefined }
    return {
      ...filters, query: query.trim() || undefined,
      employeesMin: num(nums.employeesMin), employeesMax: num(nums.employeesMax),
      capitalMin: num(nums.capitalMin), capitalMax: num(nums.capitalMax),
      salesMin: num(nums.salesMin), salesMax: num(nums.salesMax),
      ageMin: num(nums.ageMin), ageMax: num(nums.ageMax),
    }
  }, [filters, nums, query])

  // 検索条件・並び順が変わったらページを0に戻す。effect内のsetStateではなく「前回の値と違ったら
  // レンダー中に更新する」Reactの定石（派生stateのリセット）で行い、レンダーの連鎖を避ける
  const pageKey = useMemo(() => JSON.stringify([effectiveFilters, sort]), [effectiveFilters, sort])
  const [prevPageKey, setPrevPageKey] = useState(pageKey)
  if (prevPageKey !== pageKey) {
    setPrevPageKey(pageKey)
    setPageRaw(0)
  }
  const setPage = useCallback((updater: (p: number) => number) => setPageRaw((p) => Math.max(0, updater(p))), [])

  const load = useCallback(async () => {
    if (!activeDivisionId || !isMA) return
    const mySeq = ++seq.current
    setLoading(true); setLoadError(null)
    let steppingBack = false
    try {
      const res = await searchTsrProspects(activeDivisionId, effectiveFilters, { page, pageSize: PAGE_SIZE, sort })
      if (seq.current !== mySeq) return
      // 概算件数の過大評価や他ユーザーの操作でデータの外側のページに出てしまったら、1つ前に戻る
      // （行き止まりで「前のページ」も出ない状態を避ける）。戻った先の再検索が終わるまで
      // 読み込み中のままにし、古いページの行が確定表示に見えないようにする
      if (res.rows.length === 0 && page > 0) { steppingBack = true; setHasMore(false); setPage((p) => p - 1); return }
      setRows(res.rows); setTotal(res.total); setTotalIsExact(res.totalIsExact); setHasMore(res.hasMore)
    } catch (e) {
      if (seq.current !== mySeq) return
      setLoadError(formatErrorDetail(e))
    } finally {
      if (seq.current === mySeq && !steppingBack) setLoading(false)
    }
  }, [activeDivisionId, isMA, effectiveFilters, page, sort, setPage])

  // 入力のたびに叩かず、少し待ってから検索する（46万件のサーバー検索）
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t) }, [load])

  useEffect(() => {
    if (!activeDivisionId || !isMA) return
    fetchTsrIndustryOptions(activeDivisionId).then(setIndustries).catch(() => setIndustries([]))
    fetchDivisionUsers(activeDivisionId).then(setMembers).catch(() => setMembers([]))
  }, [activeDivisionId, isMA])

  const memberName = (id: string | null) => members.find((m) => m.id === id)?.name ?? (id ? '（不明）' : '—')
  const activeFilterCount = Object.values(effectiveFilters).filter((v) => v !== undefined && v !== '').length - (effectiveFilters.query ? 1 : 0)
  const clearFilters = () => { setFilters({}); setNums({}) }

  const handleExport = async () => {
    if (!activeDivisionId || !currentUser) return
    const withPersonal = window.confirm('代表者の個人情報（氏名・住所・生年月日・出身地・出身校）を含めますか？\n「キャンセル」で個人情報を除いて出力します。')
    setExporting(true)
    const t = toast.loading('出力データを取得中...')
    try {
      const { rows: all, truncated } = await fetchTsrProspectsForExport(activeDivisionId, effectiveFilters, {
        sort, max: EXPORT_MAX, includePersonal: withPersonal,
        onProgress: (n) => toast.loading(`出力データを取得中... ${n.toLocaleString()}件`, { id: t }),
      })
      // 件数は概算なので、実際に取得してから0件を判定する
      if (all.length === 0) { toast.error('出力対象がありません', { id: t }); return }
      // 個人情報を含める場合は、何件・どの条件で出したかを先に記録する（記録できなければ出力しない）
      if (withPersonal) await logTsrProspectExport(currentUser.id, all.length, effectiveFilters)
      const headers = ['企業コード', '商号', '商号カナ', '上場', '都道府県', '郵便番号', '所在地', '電話番号', '設立年月', '資本金(千円)', '従業員数',
        '業種1', '業種2', '業種3', '営業種目', '役員', '大株主', '営業所・支店', '仕入先', '販売先', '取引銀行', '概況',
        '直近期決算年月', '直近期売上(千円)', '直近期利益(千円)', '前期決算年月', '前期売上(千円)', '前期利益(千円)', '前々期決算年月', '前々期売上(千円)', '前々期利益(千円)',
        '売上CAGR', '直近期利益率', '調査年月日', 'データ経過年数', '代表者年齢', 'アプローチ優先度',
        ...(withPersonal ? ['代表者氏名', '代表者カナ', '代表者現住所', '代表者生年月日', '出身地', '出身校'] : []),
        'アプローチ区分', '担当者', '最終接触日', 'ステータス', 'メモ', 'CRM登録済み']
      // 個人情報の列は includePersonal=true のときだけ取得されている（それ以外は型上も存在しない）
      const personalCells = (p: TsrProspectPublic): unknown[] => {
        if (!withPersonal) return []
        const r = p as TsrProspect
        return [r.rep_name, r.rep_name_kana, r.rep_home_address, fmtBirth(r.rep_birth_year, r.rep_birth_month, r.rep_birth_day), r.rep_birthplace, r.rep_school]
      }
      const line = (p: TsrProspectPublic): unknown[] => [
        p.tsr_code, p.name, p.name_kana, p.listing_name, p.prefecture, p.postal_code, p.address, p.phone, fmtEst(p.established_year, p.established_month), p.capital_thousand_yen, p.employee_count,
        [p.industry1_code, p.industry1_name].filter(Boolean).join(' '), [p.industry2_code, p.industry2_name].filter(Boolean).join(' '), [p.industry3_code, p.industry3_name].filter(Boolean).join(' '),
        p.business_description, p.officers, p.major_shareholders, p.branches, p.suppliers, p.customers, p.banks, p.overview,
        fmtYm(p.fy1_closing), p.fy1_sales, p.fy1_profit, fmtYm(p.fy2_closing), p.fy2_sales, p.fy2_profit, fmtYm(p.fy3_closing), p.fy3_sales, p.fy3_profit,
        p.sales_cagr, p.profit_margin, p.surveyed_on, p.data_age_years, p.rep_age, p.approach_priority,
        ...personalCells(p),
        p.approach_type, memberName(p.owner_user_id) === '—' ? '' : memberName(p.owner_user_id), p.last_contact_on, p.status, p.memo, p.company_id ? '済' : '',
      ]
      downloadCsv(`TSRソーシング_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`, headers, all.map(line))
      toast.success(`${all.length.toLocaleString()}件を出力しました${truncated ? `（上限${EXPORT_MAX.toLocaleString()}件で打ち切り。条件を絞ってください）` : ''}`, { id: t, duration: 6000 })
    } catch (e) {
      toast.error(`出力に失敗しました: ${formatErrorDetail(e)}`, { id: t })
    } finally {
      setExporting(false)
    }
  }

  const openDetail = (p: TsrProspect) => {
    setSelected(p)
    if (hasPersonalInfo(p) && currentUser) logTsrProspectView(p.tsr_code, currentUser.id)
  }

  if (!isMA) {
    return (
      <EmptyState
        imgSrc="/characters/char-fisher.png"
        title="ソーシングはM&A事業部専用の機能です"
        description="右上の事業部切替でM&A事業部を選ぶと表示されます"
      />
    )
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-800">ソーシング</h1>
          <p className="text-sm text-gray-500">
            {loading ? '検索中...' : `${totalLabel}社`}
            <span className="text-gray-400 ml-2 text-xs">TSR営業対象リスト</span>
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={handleExport} loading={exporting} disabled={loading || total === 0}>
          CSV出力
        </Button>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-64">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="商号・商号カナ・電話番号・企業コードで検索（2文字以下は商号の先頭一致）"
            className="w-full pl-9 pr-8 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label="検索語をクリア"><X size={14} /></button>
          )}
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={cn('flex items-center gap-1.5 px-3 py-2 text-sm border rounded-xl transition-colors',
            showFilters || activeFilterCount > 0 ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50')}
        >
          <SlidersHorizontal size={14} />絞り込み{activeFilterCount > 0 && <span className="bg-orange-500 text-white text-xs px-1.5 rounded-full">{activeFilterCount}</span>}
        </button>
        <select value={sort} onChange={(e) => setSort(e.target.value as TsrSortKey)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-orange-500">
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {showFilters && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="都道府県">
              <select value={filters.prefecture ?? ''} onChange={(e) => setFilters((f) => ({ ...f, prefecture: e.target.value || undefined }))} className={inputCls}>
                <option value="">すべて</option>
                {PREFECTURES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="業種（業種1〜3のいずれか）">
              <select value={filters.industryCode ?? ''} onChange={(e) => setFilters((f) => ({ ...f, industryCode: e.target.value || undefined }))} className={inputCls}>
                <option value="">すべて</option>
                {industries.map((i) => <option key={i.code} value={i.code}>{i.code} {i.name ?? ''}（{i.company_count.toLocaleString()}）</option>)}
              </select>
            </Field>
            <Field label="アプローチ優先度">
              <select value={filters.priority ?? ''} onChange={(e) => setFilters((f) => ({ ...f, priority: (e.target.value || undefined) as TsrPriority | undefined }))} className={inputCls}>
                <option value="">すべて</option>
                {(['S', 'A', 'B', '不明'] as TsrPriority[]).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="ステータス">
              <select value={filters.status ?? ''} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined }))} className={inputCls}>
                <option value="">すべて</option>
                {TSR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <RangeField label="従業員数（人）" min={nums.employeesMin} max={nums.employeesMax} onChange={(k, v) => setNums((n) => ({ ...n, [`employees${k}`]: v }))} />
            <RangeField label="直近期売上（千円）" min={nums.salesMin} max={nums.salesMax} onChange={(k, v) => setNums((n) => ({ ...n, [`sales${k}`]: v }))} />
            <RangeField label="資本金（千円）" min={nums.capitalMin} max={nums.capitalMax} onChange={(k, v) => setNums((n) => ({ ...n, [`capital${k}`]: v }))} />
            <RangeField label="代表者年齢（歳）" min={nums.ageMin} max={nums.ageMax} onChange={(k, v) => setNums((n) => ({ ...n, [`age${k}`]: v }))} />
            <Field label="担当者">
              <select value={filters.ownerUserId ?? ''} onChange={(e) => setFilters((f) => ({ ...f, ownerUserId: e.target.value || undefined }))} className={inputCls}>
                <option value="">すべて</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="CRM登録">
              <select value={filters.promoted ?? ''} onChange={(e) => setFilters((f) => ({ ...f, promoted: (e.target.value || undefined) as 'yes' | 'no' | undefined }))} className={inputCls}>
                <option value="">すべて</option>
                <option value="no">未登録のみ</option>
                <option value="yes">登録済みのみ</option>
              </select>
            </Field>
            <Field label="調査年">
              <select value={filters.surveyedYear ?? ''} onChange={(e) => setFilters((f) => ({ ...f, surveyedYear: e.target.value ? Number(e.target.value) : undefined }))} className={inputCls}>
                <option value="">すべて</option>
                {[2025, 2024, 2023].map((y) => <option key={y} value={y}>{y}年</option>)}
              </select>
            </Field>
          </div>
          <div className="flex justify-end mt-3">
            <button onClick={clearFilters} className="text-xs font-medium text-orange-500 hover:text-orange-700">条件をすべてクリア</button>
          </div>
        </div>
      )}

      {loadError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
          {/57014|statement timeout/.test(loadError) ? (
            <>
              この条件の検索は時間内（8秒）に終わりませんでした。
              <p className="text-xs text-red-500 mt-1">
                条件を1つ減らすか、もう一度お試しください（同じ条件は2回目以降は速くなります）。
              </p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load()}>もう一度検索</Button>
            </>
          ) : (
            <>
              読み込みに失敗しました: {loadError}
              <p className="text-xs text-red-500 mt-1">管理者にご確認ください（マイグレーション053〜063の適用状況・権限）。</p>
            </>
          )}
        </div>
      ) : rows.length === 0 && !loading ? (
        <EmptyState imgSrc="/characters/char-fisher.png" title="該当する会社がありません" description="検索条件・絞り込みを変えてみてください" />
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs">
                  <th className="px-3 py-2 text-left font-medium">商号</th>
                  <th className="px-3 py-2 text-left font-medium">都道府県</th>
                  <th className="px-3 py-2 text-left font-medium">業種1</th>
                  <th className="px-3 py-2 text-right font-medium">従業員</th>
                  <th className="px-3 py-2 text-right font-medium">直近期売上</th>
                  <th className="px-3 py-2 text-right font-medium">代表者年齢</th>
                  <th className="px-3 py-2 text-center font-medium">優先度</th>
                  <th className="px-3 py-2 text-left font-medium">ステータス</th>
                  <th className="px-3 py-2 text-left font-medium">担当</th>
                  <th className="px-3 py-2 text-left font-medium">最終接触</th>
                </tr>
              </thead>
              <tbody className={cn('divide-y divide-gray-50', loading && 'opacity-50')}>
                {rows.map((p) => (
                  <tr
                    key={p.tsr_code}
                    role="button"
                    tabIndex={0}
                    aria-label={`${p.name} の詳細を開く`}
                    onClick={() => openDetail(p)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(p) } }}
                    className="hover:bg-orange-50/50 cursor-pointer focus:outline-none focus-visible:bg-orange-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-400"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-800 flex items-center gap-1.5">
                        {p.name}
                        {p.company_id && <Badge variant="success">CRM</Badge>}
                      </div>
                      <div className="text-xs text-gray-400">{p.name_kana}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{p.prefecture ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-48 truncate" title={p.industry1_name ?? ''}>{p.industry1_name ?? p.industry1_code ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{fmtInt(p.employee_count)}</td>
                    <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{fmtMillion(p.fy1_sales)}</td>
                    <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{p.rep_age != null ? `${p.rep_age}歳` : '—'}</td>
                    <td className="px-3 py-2 text-center"><Badge variant={PRIORITY_BADGE[p.approach_priority]}>{p.approach_priority}</Badge></td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{p.status}</td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{memberName(p.owner_user_id)}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-xs">{p.last_contact_on ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 text-xs text-gray-500">
            <span>{total === 0 ? '0件' : `${(page * PAGE_SIZE + 1).toLocaleString()}〜${Math.min((page + 1) * PAGE_SIZE, total).toLocaleString()}件 / ${totalLabel}件`}</span>
            <div className="flex items-center gap-1">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30" aria-label="前のページ"><ChevronLeft size={14} /></button>
              <span>{page + 1} / {pageCount}</span>
              <button disabled={!hasMore} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30" aria-label="次のページ"><ChevronRight size={14} /></button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <ProspectDetailModal
          prospect={selected}
          members={members}
          onClose={() => setSelected(null)}
          onUpdated={(p) => { setSelected(p); setRows((rs) => rs.map((r) => (r.tsr_code === p.tsr_code ? p : r))) }}
          onOpenCompany={(id) => router.push(`/contacts/company/${id}`)}
        />
      )}
    </div>
  )
}

const inputCls = 'w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-orange-500'

interface FieldProps { label: string; children: React.ReactNode }
function Field({ label, children }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

interface RangeFieldProps { label: string; min?: string; max?: string; onChange: (k: 'Min' | 'Max', v: string) => void }
function RangeField({ label, min, max, onChange }: RangeFieldProps) {
  return (
    <div>
      <span className="block text-xs text-gray-500 mb-1">{label}</span>
      <div className="flex items-center gap-1.5">
        <input type="text" inputMode="numeric" value={min ?? ''} onChange={(e) => onChange('Min', e.target.value)} placeholder="下限" className={inputCls} aria-label={`${label} 下限`} />
        <span className="text-gray-400 text-xs">〜</span>
        <input type="text" inputMode="numeric" value={max ?? ''} onChange={(e) => onChange('Max', e.target.value)} placeholder="上限" className={inputCls} aria-label={`${label} 上限`} />
      </div>
    </div>
  )
}

interface ProspectDetailModalProps {
  prospect: TsrProspect
  members: User[]
  onClose: () => void
  onUpdated: (p: TsrProspect) => void
  onOpenCompany: (companyId: string) => void
}
function ProspectDetailModal({ prospect: p, members, onClose, onUpdated, onOpenCompany }: ProspectDetailModalProps) {
  const [ops, setOps] = useState({
    approachType: p.approach_type ?? '', ownerUserId: p.owner_user_id ?? '', lastContactOn: p.last_contact_on ?? '', status: p.status, memo: p.memo ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [promoting, setPromoting] = useState(false)

  const dirty = ops.approachType !== (p.approach_type ?? '') || ops.ownerUserId !== (p.owner_user_id ?? '') ||
    ops.lastContactOn !== (p.last_contact_on ?? '') || ops.status !== p.status || ops.memo !== (p.memo ?? '')

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateTsrProspectOps(p.tsr_code, {
        approachType: ops.approachType || null, ownerUserId: ops.ownerUserId || null,
        lastContactOn: ops.lastContactOn || null, status: ops.status, memo: ops.memo.trim() || null,
      })
      onUpdated({ ...p, approach_type: ops.approachType || null, owner_user_id: ops.ownerUserId || null, last_contact_on: ops.lastContactOn || null, status: ops.status, memo: ops.memo.trim() || null })
      toast.success('保存しました')
    } catch (e) {
      toast.error(`保存に失敗しました: ${formatErrorDetail(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const handlePromote = async () => {
    if (!window.confirm(`「${p.name}」をCRMの会社マスタに登録しますか？\n（商号・代表者・所在地・電話・業種・資本金・従業員数・設立年月を転記します）`)) return
    setPromoting(true)
    try {
      const companyId = await promoteTsrProspectToCompany(p)
      onUpdated({ ...p, company_id: companyId })
      toast.success('CRMに登録しました')
    } catch (e) {
      toast.error(`登録に失敗しました: ${formatErrorDetail(e)}`)
    } finally {
      setPromoting(false)
    }
  }

  const fin = [
    { label: '直近期', closing: p.fy1_closing, sales: p.fy1_sales, profit: p.fy1_profit },
    { label: '前期', closing: p.fy2_closing, sales: p.fy2_sales, profit: p.fy2_profit },
    { label: '前々期', closing: p.fy3_closing, sales: p.fy3_sales, profit: p.fy3_profit },
  ]

  return (
    <Modal isOpen onClose={onClose} title={p.name} size="lg">
      <div className="space-y-5 text-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={PRIORITY_BADGE[p.approach_priority]}>優先度 {p.approach_priority}</Badge>
          {p.listing_name && <Badge>{p.listing_name}</Badge>}
          <span className="text-xs text-gray-400">企業コード {p.tsr_code} · 調査 {p.surveyed_on ?? '—'}（{p.data_age_years ?? '—'}年前）</span>
          {p.company_id ? (
            <button onClick={() => onOpenCompany(p.company_id!)} className="ml-auto flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-lg hover:bg-green-100">
              <ExternalLink size={12} />CRMの会社ページを開く
            </button>
          ) : (
            <Button size="sm" className="ml-auto" icon={<Building2 size={14} />} onClick={handlePromote} loading={promoting}>CRMに登録</Button>
          )}
        </div>

        <Section title="基本情報">
          <Row label="商号カナ" value={p.name_kana} />
          <Row label="所在地" value={`${p.postal_code ? `〒${p.postal_code} ` : ''}${p.address ?? ''}`} />
          <Row label="電話番号" value={p.phone} />
          <Row label="設立" value={fmtEst(p.established_year, p.established_month)} />
          <Row label="資本金" value={fmtThousand(p.capital_thousand_yen)} />
          <Row label="従業員数" value={fmtInt(p.employee_count, '人')} />
          <Row label="業種" value={([
            [p.industry1_code, p.industry1_name], [p.industry2_code, p.industry2_name], [p.industry3_code, p.industry3_name],
          ] as const).map(([code, name]) => (code ? `${code} ${name ?? ''}`.trim() : null)).filter(Boolean).join(' ／ ')} />
        </Section>

        <Section title="業績">
          <table className="w-full text-xs">
            <thead><tr className="text-gray-400"><th className="text-left font-medium py-1">期</th><th className="text-left font-medium">決算年月</th><th className="text-right font-medium">売上（千円）</th><th className="text-right font-medium">利益（千円）</th></tr></thead>
            <tbody>
              {fin.map((f) => (
                <tr key={f.label} className="border-t border-gray-50">
                  <td className="py-1 text-gray-500">{f.label}</td>
                  <td className="text-gray-700">{fmtYm(f.closing)}</td>
                  <td className="text-right text-gray-700">{fmtInt(f.sales)}</td>
                  <td className="text-right text-gray-700">{fmtInt(f.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-4 mt-2 text-xs text-gray-500">
            <span>売上CAGR（3期）: <b className="text-gray-700">{fmtPct(p.sales_cagr)}</b></span>
            <span>直近期利益率: <b className="text-gray-700">{fmtPct(p.profit_margin)}</b></span>
          </div>
        </Section>

        <Section title="事業・組織">
          <Row label="営業種目" value={p.business_description} />
          <Row label="概況" value={p.overview} />
          <Row label="役員" value={p.officers} />
          <Row label="大株主" value={p.major_shareholders} />
          <Row label="営業所・支店" value={p.branches} />
          <Row label="仕入先" value={p.suppliers} />
          <Row label="販売先" value={p.customers} />
          <Row label="取引銀行" value={p.banks} />
        </Section>

        {hasPersonalInfo(p) ? (
          <Section title="代表者" note="個人情報（閲覧は記録されます）">
            <Row label="氏名" value={p.rep_name ? `${p.rep_name}${p.rep_name_kana ? `（${p.rep_name_kana}）` : ''}` : null} />
            <Row label="年齢" value={p.rep_age != null ? `${p.rep_age}歳（${fmtBirth(p.rep_birth_year, p.rep_birth_month, p.rep_birth_day)}生）` : '不明'} />
            <Row label="現住所" value={p.rep_home_address} />
            <Row label="出身地" value={p.rep_birthplace} />
            <Row label="出身校" value={p.rep_school} />
          </Section>
        ) : (
          <p className="text-xs text-gray-400 flex items-center gap-1"><Lock size={11} />代表者情報はありません（元データに記載がないか、閲覧権限がありません）</p>
        )}

        <Section title="アプローチ管理">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="ステータス">
              <select value={ops.status} onChange={(e) => setOps((o) => ({ ...o, status: e.target.value }))} className={inputCls}>
                {TSR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="アプローチ区分">
              <select value={ops.approachType} onChange={(e) => setOps((o) => ({ ...o, approachType: e.target.value }))} className={inputCls}>
                <option value="">未設定</option>
                {TSR_APPROACH_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="担当者">
              <select value={ops.ownerUserId} onChange={(e) => setOps((o) => ({ ...o, ownerUserId: e.target.value }))} className={inputCls}>
                <option value="">未担当</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="最終接触日">
              <input type="date" value={ops.lastContactOn} onChange={(e) => setOps((o) => ({ ...o, lastContactOn: e.target.value }))} className={inputCls} />
            </Field>
          </div>
          <Field label="メモ">
            <textarea value={ops.memo} onChange={(e) => setOps((o) => ({ ...o, memo: e.target.value }))} rows={3} className={inputCls} placeholder="接触の記録、所感など" />
          </Field>
          <div className="flex justify-end mt-2">
            <Button size="sm" onClick={handleSave} loading={saving} disabled={!dirty}>保存</Button>
          </div>
        </Section>

        <p className="text-[11px] text-gray-400">出典PDF: {p.source_files.join(' / ')}</p>
      </div>
    </Modal>
  )
}

interface SectionProps { title: string; note?: string; children: React.ReactNode }
function Section({ title, note, children }: SectionProps) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide">{title}</h3>
        {note && <span className="text-[11px] text-gray-400">{note}</span>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

interface RowProps { label: string; value: string | null | undefined }
function Row({ label, value }: RowProps) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-2">
      <span className="text-xs text-gray-400 pt-0.5">{label}</span>
      <span className="text-gray-700 whitespace-pre-wrap break-words">{value || <span className="text-gray-300">—</span>}</span>
    </div>
  )
}
