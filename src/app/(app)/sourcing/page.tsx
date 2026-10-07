'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Search, SlidersHorizontal, Download, X, ChevronLeft, ChevronRight, Plus, GitMerge } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAppStore } from '@/store/appStore'
import { MA_DIVISION_NAME } from '@/lib/config'
import { PREFECTURES, downloadCsv, cn, formatErrorDetail } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field, inputCls } from '@/components/sourcing/fields'
import { ManualCompanyModal } from '@/components/sourcing/ManualCompanyModal'
import { PRIORITY_BADGE, fmtMillion, fmtInt, fmtYm, fmtEst, fmtBirth } from '@/lib/tsrFormat'
import { fetchDivisionUsers } from '@/lib/db/users'
import {
  searchTsrProspects, fetchTsrProspectsForExport, fetchTsrIndustryOptions, logTsrProspectExport,
  TSR_STATUSES,
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
const isSortKey = (v: unknown): v is TsrSortKey => SORT_OPTIONS.some((o) => o.value === v)

type NumInput = { [K in 'employeesMin' | 'employeesMax' | 'capitalMin' | 'capitalMax' | 'salesMin' | 'salesMax' | 'ageMin' | 'ageMax']?: string }
type FilterState = Omit<TsrFilters, 'query' | keyof NumInput>

// 永続化した値（型が緩い）から安全に復元する。選択肢に無い値は捨てる
function restoreFilters(raw: Record<string, string | number | undefined>): FilterState {
  const str = (k: string) => (typeof raw[k] === 'string' && raw[k] ? (raw[k] as string) : undefined)
  const priority = str('priority')
  const promoted = str('promoted')
  const source = str('source')
  const surveyedYear = typeof raw.surveyedYear === 'number' ? raw.surveyedYear : undefined
  return {
    prefecture: str('prefecture'), industryCode: str('industryCode'), status: str('status'), ownerUserId: str('ownerUserId'),
    priority: priority === 'S' || priority === 'A' || priority === 'B' || priority === '不明' ? priority : undefined,
    promoted: promoted === 'yes' || promoted === 'no' ? promoted : undefined,
    source: source === 'tsr' || source === 'manual' ? source : undefined,
    surveyedYear,
  }
}
function restoreNums(raw: Record<string, string | undefined>): NumInput {
  const out: NumInput = {}
  for (const k of ['employeesMin', 'employeesMax', 'capitalMin', 'capitalMax', 'salesMin', 'salesMax', 'ageMin', 'ageMax'] as const) {
    if (typeof raw[k] === 'string' && raw[k]) out[k] = raw[k]
  }
  return out
}

export default function SourcingPage() {
  const router = useRouter()
  const activeDivision = useAppStore((s) => s.activeDivision)
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const currentUser = useAppStore((s) => s.currentUser)
  const savedView = useAppStore((s) => s.sourcingListView)
  const setSavedView = useAppStore((s) => s.setSourcingListView)
  const returningFromDetail = useAppStore((s) => s.sourcingDetailVisited)
  const setSourcingDetailVisited = useAppStore((s) => s.setSourcingDetailVisited)
  const isMA = activeDivision?.name === MA_DIVISION_NAME
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'super_admin'

  // 検索条件・並び順・ページは詳細ページから戻ったときのために永続化している（appStore.sourcingListView）
  const [query, setQuery] = useState(savedView.query)
  const [filters, setFilters] = useState<FilterState>(() => restoreFilters(savedView.filters))
  const [nums, setNums] = useState<NumInput>(() => restoreNums(savedView.nums))
  const [sort, setSort] = useState<TsrSortKey>(() => (isSortKey(savedView.sort) ? savedView.sort : 'priority'))
  // ページ番号は詳細ページから戻ってきたときだけ復元する（サイドバーから入り直したときは 1 ページ目）
  const [page, setPageRaw] = useState(() => (returningFromDetail ? Math.max(0, savedView.page) : 0))
  useEffect(() => { setSourcingDetailVisited(false) }, [setSourcingDetailVisited])
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
  const [exporting, setExporting] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
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

  // 永続化（外部ストアへの同期）
  useEffect(() => {
    setSavedView({ query, filters: filters as Record<string, string | number | undefined>, nums, sort, page })
  }, [query, filters, nums, sort, page, setSavedView])

  const load = useCallback(async () => {
    if (!activeDivisionId || !isMA) return
    const mySeq = ++seq.current
    setLoading(true); setLoadError(null)
    let steppingBack = false
    try {
      const res = await searchTsrProspects(activeDivisionId, effectiveFilters, { page, pageSize: PAGE_SIZE, sort })
      if (seq.current !== mySeq) return
      // 概算件数の過大評価や他ユーザーの操作でデータの外側のページに出てしまったら、1つ前に戻る
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
  const openDetail = (p: TsrProspect) => router.push(`/sourcing/${encodeURIComponent(p.tsr_code)}`)

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
      if (all.length === 0) { toast.error('出力対象がありません', { id: t }); return }
      // 個人情報を含める場合は、何件・どの条件で出したかを先に記録する（記録できなければ出力しない）
      if (withPersonal) await logTsrProspectExport(currentUser.id, all.length, effectiveFilters)
      const headers = ['企業コード', '出所', '商号', '商号カナ', '上場', '都道府県', '郵便番号', '所在地', '電話番号', '設立年月', '資本金(千円)', '従業員数',
        '業種1', '業種2', '業種3', '営業種目', '役員', '大株主', '営業所・支店', '仕入先', '販売先', '取引銀行', '概況',
        '直近期決算年月', '直近期売上(千円)', '直近期利益(千円)', '前期決算年月', '前期売上(千円)', '前期利益(千円)', '前々期決算年月', '前々期売上(千円)', '前々期利益(千円)',
        '売上CAGR', '直近期利益率', '調査年月日', 'データ経過年数', '代表者年齢', 'アプローチ優先度',
        ...(withPersonal ? ['代表者氏名', '代表者カナ', '代表者現住所', '代表者生年月日', '出身地', '出身校'] : []),
        'アプローチ区分', '担当者', '最終接触日', 'ステータス', 'メモ', '担当者登録済み']
      const personalCells = (p: TsrProspectPublic): unknown[] => {
        if (!withPersonal) return []
        const r = p as TsrProspect
        return [r.rep_name, r.rep_name_kana, r.rep_home_address, fmtBirth(r.rep_birth_year, r.rep_birth_month, r.rep_birth_day), r.rep_birthplace, r.rep_school]
      }
      const line = (p: TsrProspectPublic): unknown[] => [
        p.tsr_code, p.source === 'manual' ? '手動登録' : 'TSR', p.name, p.name_kana, p.listing_name, p.prefecture, p.postal_code, p.address, p.phone, fmtEst(p.established_year, p.established_month), p.capital_thousand_yen, p.employee_count,
        [p.industry1_code, p.industry1_name].filter(Boolean).join(' '), [p.industry2_code, p.industry2_name].filter(Boolean).join(' '), [p.industry3_code, p.industry3_name].filter(Boolean).join(' '),
        p.business_description, p.officers, p.major_shareholders, p.branches, p.suppliers, p.customers, p.banks, p.overview,
        fmtYm(p.fy1_closing), p.fy1_sales, p.fy1_profit, fmtYm(p.fy2_closing), p.fy2_sales, p.fy2_profit, fmtYm(p.fy3_closing), p.fy3_sales, p.fy3_profit,
        p.sales_cagr, p.profit_margin, p.surveyed_on, p.data_age_years, p.rep_age, p.approach_priority,
        ...personalCells(p),
        p.approach_type, memberName(p.owner_user_id) === '—' ? '' : memberName(p.owner_user_id), p.last_contact_on, p.status, p.memo, p.contact_count > 0 ? `${p.contact_count}名` : '',
      ]
      downloadCsv(`TSRソーシング_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`, headers, all.map(line))
      toast.success(`${all.length.toLocaleString()}件を出力しました${truncated ? `（上限${EXPORT_MAX.toLocaleString()}件で打ち切り。条件を絞ってください）` : ''}`, { id: t, duration: 6000 })
    } catch (e) {
      toast.error(`出力に失敗しました: ${formatErrorDetail(e)}`, { id: t })
    } finally {
      setExporting(false)
    }
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
            <span className="text-gray-400 ml-2 text-xs">TSR営業対象リスト＋手動登録</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isManager && (
            <Link href="/sourcing/merge" className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-orange-600 px-2 py-1.5 rounded-lg hover:bg-orange-50">
              <GitMerge size={14} />突合確認
            </Link>
          )}
          <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={handleExport} loading={exporting} disabled={loading || total === 0}>
            CSV出力
          </Button>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>会社を追加</Button>
        </div>
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
            <Field label="担当者（アプローチ）">
              <select value={filters.ownerUserId ?? ''} onChange={(e) => setFilters((f) => ({ ...f, ownerUserId: e.target.value || undefined }))} className={inputCls}>
                <option value="">すべて</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="名刺（担当者）の登録">
              <select value={filters.promoted ?? ''} onChange={(e) => setFilters((f) => ({ ...f, promoted: (e.target.value || undefined) as 'yes' | 'no' | undefined }))} className={inputCls}>
                <option value="">すべて</option>
                <option value="no">未登録のみ</option>
                <option value="yes">登録済みのみ</option>
              </select>
            </Field>
            <Field label="出所">
              <select value={filters.source ?? ''} onChange={(e) => setFilters((f) => ({ ...f, source: (e.target.value || undefined) as 'tsr' | 'manual' | undefined }))} className={inputCls}>
                <option value="">すべて</option>
                <option value="tsr">TSRリスト</option>
                <option value="manual">手動登録</option>
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
              <p className="text-xs text-red-500 mt-1">管理者にご確認ください（マイグレーションの適用状況・権限）。</p>
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
                      <div className="font-medium text-gray-800 flex items-center gap-1.5 flex-wrap">
                        {p.name}
                        {p.source === 'manual' && <Badge variant="info">手動登録</Badge>}
                        {p.contact_count > 0 && <Badge variant="success">担当者 {p.contact_count}名</Badge>}
                      </div>
                      <div className="text-xs text-gray-400">{p.name_kana}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{p.prefecture ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-48 truncate" title={p.industry1_name ?? ''}>{p.industry1_name ?? p.industry1_code ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{fmtInt(p.employee_count)}</td>
                    <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{fmtMillion(p.fy1_sales)}</td>
                    <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{p.rep_age != null ? `${p.rep_age}歳` : '—'}</td>
                    <td className="px-3 py-2 text-center">{p.source === 'manual' ? <span className="text-xs text-gray-300">—</span> : <Badge variant={PRIORITY_BADGE[p.approach_priority]}>{p.approach_priority}</Badge>}</td>
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

      {activeDivisionId && (
        <ManualCompanyModal
          isOpen={addOpen}
          divisionId={activeDivisionId}
          onClose={() => setAddOpen(false)}
          onCreated={(code) => { setAddOpen(false); router.push(`/sourcing/${encodeURIComponent(code)}`) }}
        />
      )}
    </div>
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
