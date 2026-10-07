'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Briefcase, Rocket, ExternalLink, Lock } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAppStore } from '@/store/appStore'
import { MA_DIVISION_NAME } from '@/lib/config'
import { formatErrorDetail, formatRelativeTime } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ProspectInfoPanel } from '@/components/sourcing/ProspectInfoPanel'
import { ProspectOpsPanel } from '@/components/sourcing/ProspectOpsPanel'
import { CompanyContactsPanel } from '@/components/sourcing/CompanyContactsPanel'
import { CompanyActivityTabs } from '@/components/sourcing/CompanyActivityTabs'
import { ContactSelectModal } from '@/components/sourcing/ContactSelectModal'
import { hasPersonalInfo, isManualProspect } from '@/lib/tsrFormat'
import { useDealTerm } from '@/hooks/useDealTerm'
import { fetchDivisionUsers } from '@/lib/db/users'
import { fetchContactsByCompany } from '@/lib/db/companies'
import { fetchContactsCustomValues } from '@/lib/db/contacts'
import { fetchActivitiesByCompany } from '@/lib/db/activities'
import { fetchDealsByContactIds } from '@/lib/db/deals'
import { fetchTsrProspect, logTsrProspectView, fetchCompanyContactCountsByDivision, type TsrProspect, type CompanyContactCountByDivision } from '@/lib/db/tsrProspects'
import type { User, Contact, Activity, Deal } from '@/types/database'

// 企業詳細（会社ハブ）: ①企業情報（TSR） ②アプローチ管理 ③名刺管理 ④活動タイムライン／タスク／案件
export default function ProspectDetailPage() {
  const params = useParams<{ tsrCode: string }>()
  const tsrCode = decodeURIComponent(params.tsrCode)
  const router = useRouter()
  const dealTerm = useDealTerm()
  const activeDivision = useAppStore((s) => s.activeDivision)
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const currentUser = useAppStore((s) => s.currentUser)
  const userOwnDivisionIds = useAppStore((s) => s.userOwnDivisionIds)
  const divisionCustomFields = useAppStore((s) => s.divisionCustomFields)
  const openActivityModal = useAppStore((s) => s.openActivityModal)
  const openDealModal = useAppStore((s) => s.openDealModal)
  const openTossupModal = useAppStore((s) => s.openTossupModal)
  const activityModalOpen = useAppStore((s) => s.activityModal.isOpen)
  const dealModalOpen = useAppStore((s) => s.dealModal.isOpen)
  const isMA = activeDivision?.name === MA_DIVISION_NAME
  const setSourcingDetailVisited = useAppStore((s) => s.setSourcingDetailVisited)
  // 編集可否は fail-closed（所属の取得前・所属外は閲覧のみ）。super_admin は全事業部を編集可
  const canEdit = !!activeDivisionId && (userOwnDivisionIds.includes(activeDivisionId) || currentUser?.role === 'super_admin')

  const [prospect, setProspect] = useState<TsrProspect | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [members, setMembers] = useState<User[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [otherDivisionCounts, setOtherDivisionCounts] = useState<CompanyContactCountByDivision[]>([])
  const [customValues, setCustomValues] = useState<Record<string, Record<string, string>>>({})
  const [activities, setActivities] = useState<Activity[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [selectForDeal, setSelectForDeal] = useState(false)
  const seq = useRef(0)
  const loggedCode = useRef<string | null>(null)

  const customFields = useMemo(
    () => (activeDivisionId ? (divisionCustomFields[activeDivisionId] ?? []) : []).filter((f) => f.name !== 'encounter_source'),
    [divisionCustomFields, activeDivisionId],
  )

  // 会社に紐づく情報（担当者・M&A項目・活動・案件・他事業部件数）
  const loadRelated = useCallback(async (p: TsrProspect, mySeq: number) => {
    if (!p.company_id || !activeDivisionId) {
      setContacts([]); setCustomValues({}); setActivities([]); setDeals([]); setOtherDivisionCounts([])
      return
    }
    const list = await fetchContactsByCompany(p.company_id, { divisionId: activeDivisionId })
    const ids = list.map((c) => c.id)
    const [values, acts, ds, counts] = await Promise.all([
      ids.length ? fetchContactsCustomValues(ids) : Promise.resolve({} as Record<string, Record<string, string>>),
      fetchActivitiesByCompany(p.company_id, ids),
      fetchDealsByContactIds(ids),
      fetchCompanyContactCountsByDivision(p.company_id).catch(() => [] as CompanyContactCountByDivision[]),
    ])
    if (seq.current !== mySeq) return
    setContacts(list); setCustomValues(values); setActivities(acts); setDeals(ds)
    setOtherDivisionCounts(counts.filter((c) => c.division_id !== activeDivisionId))
  }, [activeDivisionId])

  const load = useCallback(async () => {
    if (!isMA || !activeDivisionId) return
    const mySeq = ++seq.current
    setLoadError(null)
    try {
      const p = await fetchTsrProspect(tsrCode)
      if (seq.current !== mySeq) return
      if (!p) { setNotFound(true); return }
      setProspect(p)
      if (hasPersonalInfo(p) && currentUser && loggedCode.current !== p.tsr_code) {
        loggedCode.current = p.tsr_code
        logTsrProspectView(p.tsr_code, currentUser.id)
      }
      await loadRelated(p, mySeq)
    } catch (e) {
      if (seq.current !== mySeq) return
      setLoadError(formatErrorDetail(e))
    }
  }, [isMA, activeDivisionId, tsrCode, currentUser, loadRelated])

  // 読み込みは次のマイクロタスクで開始する（effect 本体で同期的に setState しない。
  // 連続レンダーを避けるための lint ルール react-hooks/set-state-in-effect に合わせた形）
  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => { if (active) void load() })
    return () => { active = false }
  }, [load])

  useEffect(() => {
    if (!activeDivisionId || !isMA) return
    fetchDivisionUsers(activeDivisionId).then(setMembers).catch(() => setMembers([]))
  }, [activeDivisionId, isMA])

  // 一覧へ戻ったときにページ番号を復元させるための印（外部ストアへの同期）
  useEffect(() => { setSourcingDetailVisited(true) }, [setSourcingDetailVisited])

  // 関連情報の再取得（失敗は無言にせず知らせる。古い表示のまま操作を続けさせない）
  const refreshRelated = useCallback((p: TsrProspect) => {
    loadRelated(p, ++seq.current).catch((e) => toast.error(`最新の情報を取得できませんでした: ${formatErrorDetail(e)}`))
  }, [loadRelated])

  // 活動・案件モーダルが閉じたら再取得（記録・作成の反映）
  const prevActivityOpen = useRef(activityModalOpen)
  const prevDealOpen = useRef(dealModalOpen)
  useEffect(() => {
    const closedActivity = prevActivityOpen.current && !activityModalOpen
    const closedDeal = prevDealOpen.current && !dealModalOpen
    prevActivityOpen.current = activityModalOpen
    prevDealOpen.current = dealModalOpen
    if ((closedActivity || closedDeal) && prospect) refreshRelated(prospect)
  }, [activityModalOpen, dealModalOpen, prospect, refreshRelated])

  const contactNameById = useMemo(() => new Map(contacts.map((c) => [c.id, c.name])), [contacts])
  const companyContacts = useMemo(() => contacts.map((c) => ({ id: c.id, name: c.name })), [contacts])

  const requireCompany = (): boolean => {
    if (prospect?.company_id) return true
    toast.error('先に「名刺管理」から担当者を1名追加してください（追加すると会社がCRMに登録されます）')
    return false
  }
  const handleRecordActivity = () => {
    if (!prospect || !requireCompany()) return
    openActivityModal({ companyId: prospect.company_id!, companyName: prospect.name, companyContacts })
  }
  const handleCreateDeal = () => {
    if (!prospect || !requireCompany()) return
    if (contacts.length === 0) { toast.error(`${dealTerm}を作るには担当者が必要です。先に担当者を追加してください`); return }
    if (contacts.length === 1) { openDealModal({ prefillContactId: contacts[0].id }); return }
    setSelectForDeal(true)
  }
  const handleTossup = () => {
    if (!prospect || !requireCompany()) return
    openTossupModal({ companyId: prospect.company_id! })
  }

  if (!isMA) {
    return <EmptyState imgSrc="/characters/char-fisher.png" title="この画面はM&A事業部専用です" description="右上の事業部切替でM&A事業部を選ぶと表示されます" />
  }
  if (notFound) {
    return (
      <div className="w-full">
        <EmptyState imgSrc="/characters/char-fisher.png" title="会社が見つかりません" description="削除されたか、閲覧権限がありません" />
        <div className="text-center mt-4"><Button variant="secondary" onClick={() => router.push('/sourcing')}>一覧へ戻る</Button></div>
      </div>
    )
  }
  if (loadError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
        読み込みに失敗しました: {loadError}
        <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => void load()}>もう一度読み込む</Button></div>
      </div>
    )
  }
  if (!prospect) {
    return <p className="text-sm text-gray-400 py-16 text-center">読み込み中...</p>
  }

  const openTasks = activities.filter((a) => a.activity_type === 'task' && a.status !== 'done').length
  const lastActivity = activities[0]

  return (
    <div className="w-full">
      <div className="mb-4">
        <Link href="/sourcing" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-orange-600 mb-2">
          <ArrowLeft size={14} />一覧へ戻る
        </Link>
        <h1 className="text-2xl font-black text-gray-800 break-words">{prospect.name}</h1>
        {prospect.name_kana && <p className="text-sm text-gray-400">{prospect.name_kana}</p>}
        {!canEdit && (
          <p className="mt-2 text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 inline-flex items-center gap-1"><Lock size={12} />閲覧のみ（所属外の事業部）</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
        {/* 左: 企業情報 + アプローチ管理 */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
            <ProspectInfoPanel prospect={prospect} />
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
            <ProspectOpsPanel prospect={prospect} members={members} canEdit={canEdit} onUpdated={setProspect} />
          </div>
        </div>

        {/* 中央: 名刺管理 + 活動/タスク/案件 */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
            <CompanyContactsPanel
              prospect={prospect}
              divisionId={activeDivisionId!}
              canEdit={canEdit}
              contacts={contacts}
              otherDivisionCounts={otherDivisionCounts}
              customFields={customFields}
              customValues={customValues}
              onContactAdded={() => void load()}
              onCustomValueChanged={(contactId, fieldId, value) =>
                setCustomValues((v) => ({ ...v, [contactId]: { ...(v[contactId] ?? {}), [fieldId]: value } }))}
            />
          </div>
          <CompanyActivityTabs
            activities={activities}
            deals={deals}
            contactNameById={contactNameById}
            dealTerm={dealTerm}
            canEdit={canEdit}
            currentUserId={currentUser?.id}
            onRecordActivity={handleRecordActivity}
            onCreateDeal={handleCreateDeal}
            onOpenDeal={(deal) => openDealModal({ deal })}
            onActivityChanged={() => { if (prospect) refreshRelated(prospect) }}
          />
        </div>

        {/* 右: 操作・サマリー */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 space-y-2">
            <Button className="w-full" icon={canEdit ? <Plus size={14} /> : <Lock size={14} />} disabled={!canEdit} onClick={handleRecordActivity}>活動を記録</Button>
            <Button className="w-full" variant="secondary" icon={<Briefcase size={14} />} disabled={!canEdit} onClick={handleCreateDeal}>{dealTerm}を作成</Button>
            <Button className="w-full" variant="secondary" icon={<Rocket size={14} />} disabled={!canEdit} onClick={handleTossup}>トスアップ</Button>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">サマリー</h3>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-gray-500">担当者</dt><dd className="text-right font-medium text-gray-800">{contacts.length}名</dd>
              <dt className="text-gray-500">活動数</dt><dd className="text-right font-medium text-gray-800">{activities.length}</dd>
              <dt className="text-gray-500">未完了タスク</dt><dd className="text-right font-medium text-gray-800">{openTasks}</dd>
              <dt className="text-gray-500">{dealTerm}</dt><dd className="text-right font-medium text-gray-800">{deals.length}</dd>
            </dl>
            {lastActivity && (
              <p className="text-xs text-gray-400 mt-3">最終活動: {formatRelativeTime(lastActivity.action_date)}</p>
            )}
          </div>
          {prospect.company_id ? (
            <Link href={`/contacts/company/${prospect.company_id}`} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-600 px-1">
              <ExternalLink size={12} />CRMの会社ページを開く{isManualProspect(prospect) && '（会社情報の編集）'}
            </Link>
          ) : (
            <p className="text-[11px] text-gray-400 px-1">担当者を追加するとCRMの会社マスタに登録され、他の事業部からも会社情報を参照できるようになります。</p>
          )}
        </div>
      </div>

      <ContactSelectModal
        isOpen={selectForDeal}
        title={`どの担当者の${dealTerm}を作成しますか？`}
        contacts={contacts}
        onSelect={(c) => { setSelectForDeal(false); openDealModal({ prefillContactId: c.id }) }}
        onClose={() => setSelectForDeal(false)}
      />
    </div>
  )
}
