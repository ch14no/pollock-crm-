'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, Wand2, Link2, Unlink, Ban, PlusSquare } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAppStore } from '@/store/appStore'
import { MA_DIVISION_NAME } from '@/lib/config'
import { formatErrorDetail, cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  fetchTsrMergeCandidates, scanTsrMerge, applyTsrMergeAuto, linkTsrMerge, unlinkTsrMerge, rejectTsrMerge, markTsrMergeManual, mergeManualIntoTsr, fetchManualProspectCode,
  TSR_MERGE_REASON_LABEL, type TsrMergeCandidate, type TsrMergeStatus, type TsrMergeScanResult,
} from '@/lib/db/tsrProspects'

const STATUS_LABEL: Record<TsrMergeStatus, string> = { pending: '未処理', linked: '紐づけ済', rejected: '却下', manual: '別会社として登録' }
const STATUS_BADGE: Record<TsrMergeStatus, 'default' | 'success' | 'info' | 'orange'> = { pending: 'orange', linked: 'success', rejected: 'default', manual: 'info' }

// 突合確認: 旧「顧客」（担当者）が紐づく会社と TSR の会社行の対応を確認・決定する（M&A の manager / super_admin）
export default function MergeReviewPage() {
  const activeDivision = useAppStore((s) => s.activeDivision)
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const currentUser = useAppStore((s) => s.currentUser)
  const isMA = activeDivision?.name === MA_DIVISION_NAME
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'super_admin'

  const [status, setStatus] = useState<TsrMergeStatus | 'all'>('pending')
  const [rows, setRows] = useState<TsrMergeCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [lastScan, setLastScan] = useState<TsrMergeScanResult | null>(null)

  const load = useCallback(async () => {
    if (!activeDivisionId || !isMA || !isManager) return
    setLoading(true)
    try {
      setRows(await fetchTsrMergeCandidates(activeDivisionId, status === 'all' ? undefined : status))
    } catch (e) {
      toast.error(`読み込みに失敗しました: ${formatErrorDetail(e)}`)
    } finally {
      setLoading(false)
    }
  }, [activeDivisionId, isMA, isManager, status])

  // 読み込みは次のマイクロタスクで開始する（effect 本体で同期的に setState しない。
  // 連続レンダーを避けるための lint ルール react-hooks/set-state-in-effect に合わせた形）
  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => { if (active) void load() })
    return () => { active = false }
  }, [load])

  const run = async (key: string, fn: () => Promise<void>, done?: string) => {
    setBusy(key)
    try {
      await fn()
      if (done) toast.success(done)
      await load()
    } catch (e) {
      toast.error(formatErrorDetail(e))
    } finally {
      setBusy(null)
    }
  }

  const handleScan = () => run('scan', async () => {
    const r = await scanTsrMerge(activeDivisionId!)
    setLastScan(r)
    toast.success(`${r.companies_scanned}社を確認: 自動で紐づけ可 ${r.auto_linkable}／要確認 ${r.needs_review}／TSRに無し ${r.unmatched}${r.manual_dups ? `／手動登録との重複 ${r.manual_dups}` : ''}`, { duration: 8000 })
  })

  const handleAuto = () => run('auto', async () => {
    const dry = await applyTsrMergeAuto(activeDivisionId!, true)
    if (dry.linked + dry.manualized === 0) { toast('自動で処理できる候補はありません'); return }
    const ok = window.confirm(
      `安全な一致だけを自動で処理します。\n\n・紐づけ: ${dry.linked}社（電話番号一致、または商号が1社だけ一致し住所/都道府県も一致）\n・別会社（手動登録）として登録: ${dry.manualized}社（TSRに一致なし）\n・確認一覧に残す: ${dry.skipped}社\n\n実行しますか？（取り消しは管理者に依頼）`)
    if (!ok) return
    const r = await applyTsrMergeAuto(activeDivisionId!, false)
    toast.success(`紐づけ ${r.linked}社・別会社として登録 ${r.manualized}社（残り ${r.skipped}社は確認一覧へ）`, { duration: 8000 })
  })

  if (!isMA || !isManager) {
    return <EmptyState imgSrc="/characters/char-fisher.png" title="この画面はM&A事業部のマネージャー専用です" description="突合の確認・決定はマネージャーまたは管理者が行います" />
  }

  // 会社ごとにまとめて表示する
  const groups = new Map<string, TsrMergeCandidate[]>()
  for (const r of rows) {
    const list = groups.get(r.company_id) ?? []
    list.push(r)
    groups.set(r.company_id, list)
  }

  return (
    <div className="w-full">
      <div className="mb-4">
        <Link href="/sourcing" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-orange-600 mb-2"><ArrowLeft size={14} />会社一覧へ戻る</Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-black text-gray-800">顧客とTSRの突合確認</h1>
            <p className="text-sm text-gray-500 mt-1">旧「顧客」に登録されている担当者の会社を、TSRの会社行に紐づけます。曖昧な候補はここで判断してください。</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={handleScan} loading={busy === 'scan'}>候補を再スキャン</Button>
            <Button size="sm" icon={<Wand2 size={14} />} onClick={handleAuto} loading={busy === 'auto'}>安全な分を自動で処理</Button>
          </div>
        </div>
        {lastScan && (
          <p className="text-xs text-gray-500 mt-2">
            最終スキャン: {lastScan.companies_scanned}社 ／ 自動可 {lastScan.auto_linkable} ／ 要確認 {lastScan.needs_review} ／ TSRに無し {lastScan.unmatched}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 mb-3">
        <label className="text-xs text-gray-500" htmlFor="merge-status">状態</label>
        <select id="merge-status" value={status} onChange={(e) => setStatus(e.target.value as TsrMergeStatus | 'all')}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-orange-500">
          <option value="pending">未処理</option>
          <option value="linked">紐づけ済</option>
          <option value="manual">別会社として登録</option>
          <option value="rejected">却下</option>
          <option value="all">すべて</option>
        </select>
        <span className="text-xs text-gray-400">{groups.size}社・{rows.length}候補</span>
      </div>

      {rows.length === 0 && !loading ? (
        <EmptyState imgSrc="/characters/char-fisher.png" title="候補がありません" description={status === 'pending' ? '「候補を再スキャン」で最新の状態を取得できます' : ''} />
      ) : (
        <div className={cn('space-y-3', loading && 'opacity-50')}>
          {[...groups.entries()].map(([companyId, cands]) => {
            const c = cands[0]
            return (
              <div key={companyId} className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <Link href={`/contacts/company/${companyId}`} className="font-bold text-gray-800 hover:text-orange-600">{c.companies?.name ?? '（会社不明）'}</Link>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {c.companies?.address ?? '住所なし'}{c.companies?.phone ? ` ／ ${c.companies.phone}` : ''} ／ 担当者 {c.contact_count}名
                    </p>
                  </div>
                  {status !== 'pending' && <Badge variant={STATUS_BADGE[c.status]}>{STATUS_LABEL[c.status]}</Badge>}
                </div>

                <div className="mt-3 space-y-2">
                  {cands.map((cand) => (
                    <div key={cand.id} className="flex items-start justify-between gap-3 flex-wrap border border-gray-100 rounded-xl px-3 py-2">
                      <div className="min-w-0">
                        {cand.tsr_code ? (
                          <>
                            <Link href={`/sourcing/${encodeURIComponent(cand.tsr_code)}`} className="text-sm font-medium text-gray-800 hover:text-orange-600">
                              {cand.tsr_prospects?.name ?? cand.tsr_code}
                            </Link>
                            <p className="text-xs text-gray-500">{cand.tsr_prospects?.address ?? '—'}{cand.tsr_prospects?.phone ? ` ／ ${cand.tsr_prospects.phone}` : ''}</p>
                          </>
                        ) : (
                          <p className="text-sm text-gray-500">TSRに一致する会社がありません</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant={cand.score >= 70 ? 'success' : cand.score >= 40 ? 'orange' : 'default'}>{TSR_MERGE_REASON_LABEL[cand.match_reason]}</Badge>
                          {cand.status !== 'pending' && <Badge variant={STATUS_BADGE[cand.status]}>{STATUS_LABEL[cand.status]}</Badge>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {cand.status === 'pending' && cand.tsr_code && cand.match_reason === 'manual_dup' && (
                          <Button size="sm" icon={<Link2 size={13} />} loading={busy === cand.id}
                            onClick={() => {
                              if (!window.confirm('手動登録の行をTSRの行に統合しますか？（手動登録の行は削除され、担当者・活動はTSRの行に引き継がれます）')) return
                              void run(cand.id, async () => {
                                // manual_dup 候補: tsr_code は TSR 行、手動登録の行は company_id から引く
                                const manualCode = await fetchManualProspectCode(activeDivisionId!, cand.company_id)
                                if (!manualCode) throw new Error('手動登録の行が見つかりません（既に統合済みの可能性があります）')
                                await mergeManualIntoTsr(activeDivisionId!, manualCode, cand.tsr_code!)
                              }, '統合しました')
                            }}>
                            統合
                          </Button>
                        )}
                        {cand.status === 'pending' && cand.tsr_code && cand.match_reason !== 'manual_dup' && (
                          <Button size="sm" icon={<Link2 size={13} />} loading={busy === cand.id}
                            onClick={() => void run(cand.id, () => linkTsrMerge(activeDivisionId!, cand.company_id, cand.tsr_code!), '紐づけました')}>
                            この会社に紐づける
                          </Button>
                        )}
                        {cand.status === 'pending' && cand.tsr_code && (
                          <Button size="sm" variant="secondary" icon={<Ban size={13} />} loading={busy === `rej-${cand.id}`}
                            onClick={() => void run(`rej-${cand.id}`, () => rejectTsrMerge(cand.id))}>
                            違う
                          </Button>
                        )}
                        {cand.status === 'linked' && cand.tsr_code && (
                          <Button size="sm" variant="secondary" icon={<Unlink size={13} />} loading={busy === `un-${cand.id}`}
                            onClick={() => { if (window.confirm('紐づけを解除しますか？')) void run(`un-${cand.id}`, () => unlinkTsrMerge(activeDivisionId!, cand.tsr_code!), '解除しました') }}>
                            解除
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {status === 'pending' && (
                  <div className="mt-3 flex justify-end">
                    <Button size="sm" variant="secondary" icon={<PlusSquare size={13} />} loading={busy === `man-${companyId}`}
                      onClick={() => { if (window.confirm(`「${c.companies?.name ?? ''}」をTSRとは別の会社（手動登録）として一覧に登録しますか？`)) void run(`man-${companyId}`, async () => { await markTsrMergeManual(activeDivisionId!, companyId) }, '別会社として登録しました') }}>
                      別会社として残す（手動登録）
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
