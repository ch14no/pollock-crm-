'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Building2, Building, Phone, Mail, Rocket,
  MessageSquare, CheckSquare, Clock, Plus, Tag, Lock,
  Users, FileText, ChevronDown, ExternalLink, UserCircle,
  Edit2, Check, X, MapPin,
} from 'lucide-react'
import { MOCK_DEALS, DEFAULT_DIVISION_CUSTOM_FIELDS } from '@/lib/mock-data'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchContactById, updateContact, fetchContactCustomValues } from '@/lib/db/contacts'
import { fetchActivitiesByTarget, updateActivityStatus } from '@/lib/db/activities'
import { fetchDealsByContact } from '@/lib/db/deals'
import type { Contact, Activity, Deal } from '@/types/database'
import { getLocationConfig, sortTags } from '@/lib/config'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { cn, formatDate, formatRelativeTime, getInitials, formatCurrency } from '@/lib/utils'
import { useAppStore, selectIsOwnDivision } from '@/store/appStore'
import { STATUS_CONFIG } from '@/lib/contactStatus'
import type { ActivityType } from '@/types/database'

// ボタン用のスタイルマップ（詳細ページ専用）
const BUTTON_STYLE: Record<string, { activeClass: string; inactiveClass: string }> = {
  star:      { activeClass: 'bg-yellow-400 text-white border-yellow-400',  inactiveClass: 'text-gray-300 border-gray-200 hover:border-yellow-300 hover:text-yellow-400' },
  heart:     { activeClass: 'bg-pink-500 text-white border-pink-500',       inactiveClass: 'text-gray-300 border-gray-200 hover:border-pink-300 hover:text-pink-400' },
  rising:    { activeClass: 'bg-green-500 text-white border-green-500',     inactiveClass: 'text-gray-300 border-gray-200 hover:border-green-300 hover:text-green-500' },
  blacklist: { activeClass: 'bg-gray-700 text-white border-gray-700',       inactiveClass: 'text-gray-300 border-gray-200 hover:border-gray-400 hover:text-gray-500' },
  trophy:    { activeClass: 'bg-blue-500 text-white border-blue-500',       inactiveClass: 'text-gray-300 border-gray-200 hover:border-blue-300 hover:text-blue-500' },
}

const QUICK_TAGS = ['VIP', 'キーマン', '要フォロー', '新規', '東京', '大阪', '福岡']

function TagBadge({ tag }: { tag: string }) {
  const locCfg = getLocationConfig(tag)
  if (locCfg) {
    return (
      <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', locCfg.color)}>
        <Tag size={10} />
        {locCfg.label}
      </span>
    )
  }
  return <Badge variant={tag === 'VIP' ? 'orange' : 'default'}>{tag}</Badge>
}

const ACT_ICON: Record<ActivityType, React.ElementType> = {
  call: Phone, email: Mail, meeting: Users,
  task: CheckSquare, tossup: Rocket, note: FileText,
}
const ACT_COLOR: Record<ActivityType, string> = {
  call:    'bg-blue-100 text-blue-600',
  email:   'bg-purple-100 text-purple-600',
  meeting: 'bg-green-100 text-green-600',
  task:    'bg-yellow-100 text-yellow-600',
  tossup:  'bg-orange-100 text-orange-600',
  note:    'bg-gray-100 text-gray-600',
}
const ACT_LABEL: Record<ActivityType, string> = {
  call: '電話', email: 'メール', meeting: '面談',
  task: 'タスク', tossup: 'トスアップ', note: 'メモ',
}

type TabType = 'timeline' | 'tasks' | 'deals'

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { openTossupModal, openActivityModal, openDealModal } = useAppStore()
  const isOwnDivision  = useAppStore(selectIsOwnDivision)
  const activeDivision = useAppStore((s) => s.activeDivision)
  const divisionStages = useAppStore((s) => s.divisionStages)
  const activityModal  = useAppStore((s) => s.activityModal)
  const dealModal      = useAppStore((s) => s.dealModal)

  // ストアからローカル状態を取得
  const currentUser = useAppStore((s) => s.currentUser)
  const localActivities = useAppStore((s) => s.localActivities)
  const localDeals = useAppStore((s) => s.localDeals)
  const taskStatuses = useAppStore((s) => s.taskStatuses)
  const setTaskStatus = useAppStore((s) => s.setTaskStatus)
  const updateLocalActivity = useAppStore((s) => s.updateLocalActivity)

  const divisionCustomFields = useAppStore((s) => s.divisionCustomFields)
  const contactCustomValues  = useAppStore((s) => s.contactCustomValues)
  const setContactCustomValue = useAppStore((s) => s.setContactCustomValue)
  const contactStatuses      = useAppStore((s) => s.contactStatuses)
  const toggleContactStatus  = useAppStore((s) => s.toggleContactStatus)
  const localContactEdits    = useAppStore((s) => s.localContactEdits)
  const setLocalContactEdit  = useAppStore((s) => s.setLocalContactEdit)

  // Supabase から顧客・活動・商談を読み込む
  const [dbContact,    setDbContact]    = useState<Contact | null>(null)
  const [contactLoading, setContactLoading] = useState(true)
  const [dbActivities, setDbActivities] = useState<Activity[]>([])
  const [dbDeals,      setDbDeals]      = useState<Deal[]>([])
  const prevActivityModalOpen = useRef(false)
  const prevDealModalOpen     = useRef(false)

  const loadContactData = async () => {
    if (!isSupabaseConfigured()) { setContactLoading(false); return }
    const [c, acts, customVals, dealsData] = await Promise.all([
      fetchContactById(id),
      fetchActivitiesByTarget('contact', id),
      fetchContactCustomValues(id),
      fetchDealsByContact(id),
    ])
    setDbContact(c)
    setDbActivities(acts)
    setDbDeals(dealsData)
    Object.entries(customVals).forEach(([fieldId, value]) => {
      setContactCustomValue(id, fieldId, value)
    })
    setContactLoading(false)
  }

  useEffect(() => { loadContactData() }, [id]) // eslint-disable-line

  // モーダルが閉じたら活動・商談を再取得
  useEffect(() => {
    if (prevActivityModalOpen.current && !activityModal.isOpen && isSupabaseConfigured()) {
      fetchActivitiesByTarget('contact', id).then(setDbActivities)
    }
    prevActivityModalOpen.current = activityModal.isOpen
  }, [activityModal.isOpen]) // eslint-disable-line

  useEffect(() => {
    if (prevDealModalOpen.current && !dealModal.isOpen && isSupabaseConfigured()) {
      fetchDealsByContact(id).then(setDbDeals)
    }
    prevDealModalOpen.current = dealModal.isOpen
  }, [dealModal.isOpen]) // eslint-disable-line

  const contact: Contact | null = dbContact

  // 事業部別フィールド定義
  const divFields = useMemo(() => {
    const divId = contact?.division_id ?? ''
    return divisionCustomFields[divId] ?? DEFAULT_DIVISION_CUSTOM_FIELDS[divId] ?? []
  }, [divisionCustomFields, contact?.division_id])

  const divValues = contactCustomValues[id] ?? {}

  const [activeTab, setActiveTab] = useState<TabType>('timeline')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ title: '', dueDate: '', memo: '' })
  const [editingFields, setEditingFields] = useState(false)

  // 基本情報インライン編集
  const [editingInfo, setEditingInfo] = useState(false)
  const [infoForm, setInfoForm] = useState({ name: '', position: '', phone: '', email: '', department: '', address: '', notes: '', tags: [] as string[], tagInput: '' })

  if (contactLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!contact) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-gray-500">顧客が見つかりません</p>
        <Button variant="ghost" onClick={() => router.back()} className="mt-4">戻る</Button>
      </div>
    )
  }

  // ローカル編集をマージした表示用コンタクト
  const edit = localContactEdits[id]
  const displayContact = edit ? { ...contact, ...edit } : contact

  // このコンタクトのアクティブなステータス
  const activeStatuses = contactStatuses[id] ?? []

  // 担当者（joinされた users フィールドを使用）
  const assignee = contact.users ?? null

  // 編集モードを開く
  const openInfoEdit = () => {
    setInfoForm({
      name: displayContact.name,
      position: displayContact.position ?? '',
      phone: displayContact.phone ?? '',
      email: displayContact.email ?? '',
      department: displayContact.department ?? '',
      address: displayContact.address ?? '',
      notes: displayContact.notes ?? '',
      tags: [...(displayContact.tags ?? [])],
      tagInput: '',
    })
    setEditingInfo(true)
  }

  const saveInfoEdit = async () => {
    const updates = {
      name: infoForm.name.trim() || contact.name,
      position: infoForm.position.trim() || null,
      phone: infoForm.phone.trim() || null,
      email: infoForm.email.trim() || null,
      department: infoForm.department.trim() || null,
      address: infoForm.address.trim() || null,
      notes: infoForm.notes.trim() || null,
      tags: infoForm.tags,
    }
    setLocalContactEdit(id, {
      name: updates.name,
      position: updates.position ?? undefined,
      phone: updates.phone ?? undefined,
      email: updates.email ?? undefined,
      department: updates.department ?? undefined,
      address: updates.address ?? undefined,
      notes: updates.notes ?? undefined,
      tags: updates.tags,
    })
    if (isSupabaseConfigured()) {
      await updateContact(id, updates).catch(() => {})
    }
    setEditingInfo(false)
  }

  const addTag = (tag: string) => {
    const t = tag.trim()
    if (t && !infoForm.tags.includes(t)) {
      setInfoForm((f) => ({ ...f, tags: [...f.tags, t], tagInput: '' }))
    } else {
      setInfoForm((f) => ({ ...f, tagInput: '' }))
    }
  }

  // DB活動 + ローカル追加分をマージ
  const allActivities = [...dbActivities, ...localActivities]
  const allDeals: Deal[] = isSupabaseConfigured()
    ? [...dbDeals, ...localDeals.filter((d) => d.contact_id === id && !dbDeals.some((dd) => dd.id === d.id))]
    : [...(MOCK_DEALS as unknown as Deal[]).filter((d) => d.contact_id === id), ...localDeals.filter((d) => d.contact_id === id)]

  const activities = allActivities
    .filter((a) => a.target_type === 'contact' && a.target_id === id)
    .sort((a, b) => new Date(b.action_date).getTime() - new Date(a.action_date).getTime())

  const tasks = activities.filter((a) => a.activity_type === 'task')

  // ステージ定義からwon/lost判定（UUIDステージID対応）
  const getDealStageName = (deal: Deal): string => {
    const stages = divisionStages[deal.division_id] ?? null
    return stages?.find((s) => s.id === deal.stage_id)?.name ?? deal.stage_id
  }
  const isDealWon  = (deal: Deal) => (divisionStages[deal.division_id] ?? null)?.some((s) => s.id === deal.stage_id && s.isWon)  ?? deal.stage_id === '受注'
  const isDealLost = (deal: Deal) => (divisionStages[deal.division_id] ?? null)?.some((s) => s.id === deal.stage_id && s.isLost) ?? deal.stage_id === '失注'

  const deals    = allDeals
  const openDeals = deals.filter((d) => !isDealWon(d) && !isDealLost(d))

  const toggleTask = (actId: string) => {
    const current = taskStatuses[actId] ?? tasks.find((t) => t.id === actId)?.status ?? 'todo'
    const newStatus = current === 'done' ? 'todo' : 'done'
    setTaskStatus(actId, newStatus)
    if (isSupabaseConfigured() && !actId.startsWith('act-local-')) {
      updateActivityStatus(actId, newStatus).catch(() => {})
    }
  }

  const toggleExpand = (actId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(actId) ? next.delete(actId) : next.add(actId)
      return next
    })
  }

  const todoTasks = tasks.filter((t) => (taskStatuses[t.id] ?? t.status) !== 'done')

  return (
    <div className="w-full">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
      >
        <ArrowLeft size={16} />
        顧客一覧へ戻る
      </button>

      {!isOwnDivision && (
        <div className="flex items-center gap-2 px-4 py-3 mb-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-800">
          <Lock size={15} className="flex-shrink-0 text-yellow-600" />
          <span>
            <strong>{activeDivision?.name}</strong> の顧客を閲覧中です。
            情報の編集・追加は担当事業部のみ可能です。
          </span>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4">
        {/* ─── Left pane ─── */}
        <div className="lg:w-1/4 space-y-3">
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">

            {/* ─── ステータスボタン5種 ─── */}
            <div className="flex justify-center gap-2 mb-4">
              {STATUS_CONFIG.map(({ status, icon: Icon, label }) => {
                const isActive = activeStatuses.includes(status)
                const style = BUTTON_STYLE[status]
                return (
                  <button
                    key={status}
                    onClick={() => toggleContactStatus(id, status)}
                    title={label}
                    className={cn(
                      'w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all',
                      isActive ? style.activeClass : style.inactiveClass
                    )}
                  >
                    <Icon size={15} fill={isActive ? 'currentColor' : 'none'} />
                  </button>
                )
              })}
            </div>
            {activeStatuses.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-center mb-3">
                {STATUS_CONFIG.filter(({ status }) => activeStatuses.includes(status)).map(({ status, label }) => (
                  <span key={status} className={cn('text-xs px-2 py-0.5 rounded-full font-medium text-white', BUTTON_STYLE[status].activeClass)}>
                    {label}
                  </span>
                ))}
              </div>
            )}

            {/* ─── プロフィール（表示 or 編集） ─── */}
            {!editingInfo ? (
              <>
                <div className="flex flex-col items-center mb-4">
                  <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center
                    text-orange-600 font-black text-xl mb-3">
                    {getInitials(displayContact.name)}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <h1 className="text-lg font-bold text-gray-800 text-center">{displayContact.name}</h1>
                    {isOwnDivision && (
                      <button onClick={openInfoEdit} className="text-gray-300 hover:text-orange-500 transition-colors" title="編集">
                        <Edit2 size={13} />
                      </button>
                    )}
                  </div>
                  {displayContact.position && (
                    <p className="text-sm text-gray-500 text-center mt-0.5">{displayContact.position}</p>
                  )}
                  <div className="flex flex-wrap gap-1 justify-center mt-2">
                    {sortTags(displayContact.tags ?? []).map((tag) => (
                      <TagBadge key={tag} tag={tag} />
                    ))}
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  {displayContact.companies && (
                    <div className="flex items-start gap-2 text-gray-600">
                      <Building2 size={14} className="mt-0.5 flex-shrink-0 text-gray-400" />
                      <span>{displayContact.companies.name}</span>
                    </div>
                  )}
                  {displayContact.phone && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Phone size={14} className="flex-shrink-0 text-gray-400" />
                      <a href={`tel:${displayContact.phone}`} className="hover:text-orange-600">{displayContact.phone}</a>
                    </div>
                  )}
                  {displayContact.email && (
                    <div className="flex items-center gap-2 text-gray-600 min-w-0">
                      <Mail size={14} className="flex-shrink-0 text-gray-400" />
                      <a href={`mailto:${displayContact.email}`} className="hover:text-orange-600 truncate text-sm">{displayContact.email}</a>
                    </div>
                  )}
                  {displayContact.department && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Building size={14} className="flex-shrink-0 text-gray-400" />
                      <span>{displayContact.department}</span>
                    </div>
                  )}
                  <div className="flex items-start gap-2 text-gray-600">
                    <MapPin size={14} className="mt-0.5 flex-shrink-0 text-gray-400" />
                    {(displayContact.address || (displayContact.custom_attributes?.address as string | undefined))
                      ? <span>{displayContact.address || (displayContact.custom_attributes?.address as string)}</span>
                      : <span className="text-gray-300 text-xs">住所未設定</span>
                    }
                  </div>
                  {assignee && (
                    <div className="flex items-center gap-2 text-gray-600 pt-2 border-t border-gray-100">
                      <UserCircle size={14} className="flex-shrink-0 text-gray-400" />
                      <div>
                        <span className="text-gray-700 font-medium">{assignee.name}</span>
                        <span className="text-xs text-gray-400 ml-1">
                          {assignee.role === 'manager' ? '（マネージャー）' : '（営業）'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* ─── 編集フォーム ─── */
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">基本情報を編集</p>
                {[
                  { label: '氏名', key: 'name' as const, type: 'text' },
                  { label: '役職', key: 'position' as const, type: 'text' },
                  { label: '部署名', key: 'department' as const, type: 'text' },
                  { label: '電話', key: 'phone' as const, type: 'tel' },
                  { label: 'メール', key: 'email' as const, type: 'email' },
                  { label: '住所', key: 'address' as const, type: 'text' },
                ].map(({ label, key, type }) => (
                  <div key={key}>
                    <label className="block text-xs text-gray-400 mb-0.5">{label}</label>
                    <input
                      type={type}
                      value={infoForm[key]}
                      onChange={(e) => setInfoForm((f) => ({ ...f, [key]: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-xs text-gray-400 mb-0.5">メモ・備考</label>
                  <textarea
                    value={infoForm.notes}
                    onChange={(e) => setInfoForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={3}
                    placeholder="メモを入力..."
                    className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                  />
                </div>

                {/* タグ編集 */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">タグ</label>
                  <div className="flex flex-wrap gap-1 mb-2 min-h-6">
                    {infoForm.tags.map((tag) => (
                      <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-50 text-orange-700 rounded-full text-xs font-medium">
                        {tag}
                        <button onClick={() => setInfoForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }))} className="text-orange-400 hover:text-orange-700">
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                  {/* クイックタグ */}
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {QUICK_TAGS.filter((t) => !infoForm.tags.includes(t)).map((tag) => (
                      <button key={tag} onClick={() => addTag(tag)}
                        className="text-xs px-2 py-0.5 border border-dashed border-gray-300 rounded-full text-gray-400 hover:border-orange-400 hover:text-orange-500 transition-colors">
                        +{tag}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={infoForm.tagInput}
                      onChange={(e) => setInfoForm((f) => ({ ...f, tagInput: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && addTag(infoForm.tagInput)}
                      placeholder="タグを追加..."
                      className="flex-1 px-2.5 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                    <button onClick={() => addTag(infoForm.tagInput)}
                      className="px-2.5 py-1 bg-orange-500 text-white rounded-lg text-xs hover:bg-orange-600 transition-colors">
                      追加
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button onClick={() => setEditingInfo(false)}
                    className="flex-1 flex items-center justify-center gap-1 text-xs text-gray-500 border border-gray-200 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                    <X size={12} /> キャンセル
                  </button>
                  <button onClick={saveInfoEdit}
                    className="flex-1 flex items-center justify-center gap-1 text-xs text-white bg-orange-500 py-1.5 rounded-lg font-medium hover:bg-orange-600 transition-colors">
                    <Check size={12} /> 保存
                  </button>
                </div>
              </div>
            )}

            {/* メモ・備考 */}
            {displayContact.notes && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1.5">メモ・備考</p>
                <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{displayContact.notes}</p>
              </div>
            )}

            {/* 事業部別カスタムフィールド */}
            {divFields.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">
                    {activeDivision?.name} 情報
                  </p>
                  {isOwnDivision && (
                    <button
                      onClick={() => setEditingFields((v) => !v)}
                      className="text-xs text-orange-500 hover:text-orange-700 font-medium flex items-center gap-1"
                    >
                      {editingFields ? <><X size={11} />閉じる</> : <><Edit2 size={11} />編集</>}
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {divFields.map((field) => {
                    const val = divValues[field.id] ?? ''
                    return (
                      <div key={field.id}>
                        <p className="text-xs text-gray-400 mb-0.5">{field.label}</p>
                        {editingFields && isOwnDivision ? (
                          field.fieldType === 'select' ? (
                            <select
                              value={val}
                              onChange={(e) => setContactCustomValue(id, field.id, e.target.value)}
                              className="w-full px-2 py-1 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                            >
                              <option value="">未選択</option>
                              {field.options?.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={field.fieldType === 'number' ? 'number' : 'text'}
                              value={val}
                              onChange={(e) => setContactCustomValue(id, field.id, e.target.value)}
                              placeholder={`${field.label}を入力`}
                              className="w-full px-2 py-1 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                            />
                          )
                        ) : (
                          <p className="text-sm font-medium text-gray-700">
                            {val || <span className="text-gray-300 text-xs">未設定</span>}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <p className="text-xs text-gray-400 mt-4 pt-4 border-t border-gray-100">
              最終更新: {formatRelativeTime(contact.updated_at)}
            </p>
          </div>
        </div>

        {/* ─── Center pane ─── */}
        <div className="lg:w-1/2 space-y-3">
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex border-b border-gray-100">
              {([
                { id: 'timeline', label: '活動タイムライン', icon: Clock,         badge: activities.length },
                { id: 'tasks',    label: 'タスク',           icon: CheckSquare,   badge: todoTasks.length || undefined },
                { id: 'deals',    label: '商談',             icon: MessageSquare, badge: openDeals.length || undefined },
              ] as const).map(({ id: tabId, label, icon: Icon, badge }) => (
                <button
                  key={tabId}
                  onClick={() => setActiveTab(tabId)}
                  className={cn(
                    'flex items-center justify-center gap-1.5 flex-1 py-3 text-sm font-medium transition-colors',
                    activeTab === tabId
                      ? 'text-orange-600 border-b-2 border-orange-500'
                      : 'text-gray-500 hover:text-gray-700'
                  )}
                >
                  <Icon size={14} />
                  {label}
                  {badge !== undefined && badge > 0 && (
                    <span className={cn(
                      'text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center',
                      tabId === 'tasks' ? 'bg-yellow-400 text-white' : 'bg-gray-200 text-gray-600'
                    )}>
                      {badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="p-4">
              {/* Timeline tab */}
              {activeTab === 'timeline' && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={isOwnDivision ? <Plus size={14} /> : <Lock size={14} />}
                    className="mb-4 w-full"
                    disabled={!isOwnDivision}
                    onClick={() => isOwnDivision && openActivityModal({
                      contactId: contact.id,
                      contactName: `${contact.name}（${contact.companies?.name ?? ''}）`,
                    })}
                  >
                    活動を記録
                  </Button>

                  {activities.length === 0 ? (
                    <p className="text-center text-sm text-gray-400 py-8">活動履歴がありません</p>
                  ) : (
                    <div className="space-y-3">
                      {activities.map((act) => {
                        const Icon = ACT_ICON[act.activity_type]
                        const color = ACT_COLOR[act.activity_type]
                        const label = ACT_LABEL[act.activity_type]
                        const isExpanded = expandedIds.has(act.id)

                        return (
                          <div key={act.id} className="flex gap-3">
                            <div className={cn('w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5', color)}>
                              <Icon size={13} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-1">
                                <div>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded', color)}>{label}</span>
                                    <span className="text-xs text-gray-400">{formatRelativeTime(act.action_date)}</span>
                                    {act.users && (
                                      <span className="text-xs text-gray-400">{act.users.name}</span>
                                    )}
                                  </div>
                                  {act.title && (
                                    <p className="text-sm font-medium text-gray-700 mt-0.5">{act.title}</p>
                                  )}
                                </div>
                                {act.memo && (
                                  <button onClick={() => toggleExpand(act.id)} className="text-gray-300 hover:text-gray-500 flex-shrink-0 mt-1">
                                    <ChevronDown size={13} className={cn('transition-transform', isExpanded && 'rotate-180')} />
                                  </button>
                                )}
                              </div>
                              {act.memo && (isExpanded || !act.title) && (
                                <p className="mt-1.5 text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{act.memo}</p>
                              )}
                              {act.memo && act.title && !isExpanded && (
                                <p className="mt-0.5 text-xs text-gray-400 truncate">{act.memo}</p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Tasks tab */}
              {activeTab === 'tasks' && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={isOwnDivision ? <Plus size={14} /> : <Lock size={14} />}
                    className="mb-4 w-full"
                    disabled={!isOwnDivision}
                    onClick={() => isOwnDivision && openActivityModal({
                      contactId: contact.id,
                      contactName: `${contact.name}（${contact.companies?.name ?? ''}）`,
                    })}
                  >
                    タスクを追加
                  </Button>
                  {tasks.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-2xl mb-2">🎉</p>
                      <p className="text-sm text-gray-500 font-medium">タスクはありません</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {tasks.map((task) => {
                        const effectiveStatus = taskStatuses[task.id] ?? task.status
                        const isDone = effectiveStatus === 'done'
                        const isLocal = task.id.startsWith('act-local-')
                        const isMyTask = task.user_id === currentUser?.id
                        const canComplete = isMyTask
                        const canEdit = isLocal && !isMyTask
                        const isLocked = !isMyTask && !isLocal
                        const isEditingThis = editingTaskId === task.id
                        const assigneeName = !isMyTask ? (task.users?.name ?? null) : null

                        return (
                          <div key={task.id} className={cn(
                            'p-3 rounded-xl transition-colors',
                            isDone ? 'bg-gray-50 opacity-60' :
                            isLocked ? 'bg-gray-50' : 'bg-yellow-50'
                          )}>
                            <div className="flex items-start gap-3">
                              {/* チェックボックス（自分のタスクのみ） */}
                              {canComplete ? (
                                <button
                                  onClick={() => toggleTask(task.id)}
                                  className={cn(
                                    'mt-0.5 w-4 h-4 flex-shrink-0 rounded border-2 flex items-center justify-center transition-colors',
                                    isDone ? 'bg-orange-500 border-orange-500' : 'border-yellow-400 hover:border-orange-400'
                                  )}
                                >
                                  {isDone && <span className="text-white text-xs leading-none">✓</span>}
                                </button>
                              ) : (
                                <div className={cn(
                                  'mt-0.5 w-4 h-4 flex-shrink-0 rounded border-2 flex items-center justify-center',
                                  isLocked ? 'border-gray-200 bg-gray-100' : 'border-orange-200 bg-orange-50'
                                )}>
                                  {isLocked
                                    ? <Lock size={9} className="text-gray-300" />
                                    : <span className="text-orange-300 text-[9px]">→</span>
                                  }
                                </div>
                              )}

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <p className={cn('text-sm font-medium text-gray-700 flex-1', isDone && 'line-through text-gray-400')}>
                                    {task.title}
                                  </p>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    {canEdit && !isEditingThis && (
                                      <button
                                        onClick={() => {
                                          setEditingTaskId(task.id)
                                          setEditForm({
                                            title: task.title ?? '',
                                            dueDate: task.due_date ? task.due_date.slice(0, 16) : '',
                                            memo: task.memo ?? '',
                                          })
                                        }}
                                        className="text-gray-300 hover:text-orange-500 transition-colors p-0.5 rounded"
                                        title="修正"
                                      >
                                        <Edit2 size={12} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {assigneeName && (
                                  <span className="text-xs text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">
                                    → {assigneeName}
                                  </span>
                                )}
                                {isLocked && (
                                  <span className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                                    <Lock size={9} /> 閲覧のみ
                                  </span>
                                )}
                                {task.due_date && (
                                  <p className="text-xs text-gray-400 mt-0.5">期限: {formatDate(task.due_date)}</p>
                                )}
                                {task.memo && !isEditingThis && (
                                  <p className="text-xs text-gray-500 mt-0.5">{task.memo}</p>
                                )}
                              </div>
                            </div>

                            {/* インライン修正フォーム */}
                            {isEditingThis && (
                              <div className="mt-2 p-2.5 bg-orange-50 rounded-xl space-y-2 border border-orange-100">
                                <input
                                  type="text"
                                  value={editForm.title}
                                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                                  placeholder="件名"
                                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                                />
                                <input
                                  type="datetime-local"
                                  value={editForm.dueDate}
                                  onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))}
                                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                                />
                                <textarea
                                  value={editForm.memo}
                                  onChange={(e) => setEditForm((f) => ({ ...f, memo: e.target.value }))}
                                  placeholder="メモ"
                                  rows={2}
                                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white resize-none"
                                />
                                <div className="flex gap-2 justify-end">
                                  <button onClick={() => setEditingTaskId(null)}
                                    className="flex items-center gap-1 text-xs text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                                    <X size={12} /> キャンセル
                                  </button>
                                  <button
                                    onClick={() => {
                                      updateLocalActivity(task.id, {
                                        title: editForm.title.trim() || undefined,
                                        due_date: editForm.dueDate ? new Date(editForm.dueDate).toISOString() : undefined,
                                        memo: editForm.memo.trim() || undefined,
                                      })
                                      setEditingTaskId(null)
                                    }}
                                    className="flex items-center gap-1 text-xs text-white bg-orange-500 hover:bg-orange-600 px-2.5 py-1.5 rounded-lg font-medium transition-colors">
                                    <Check size={12} /> 保存
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Deals tab */}
              {activeTab === 'deals' && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={isOwnDivision ? <Plus size={14} /> : <Lock size={14} />}
                    className="mb-4 w-full"
                    disabled={!isOwnDivision}
                    onClick={() => isOwnDivision && openDealModal({ prefillContactId: contact.id })}
                  >
                    商談を作成
                  </Button>
                  {deals.length === 0 ? (
                    <p className="text-center text-sm text-gray-400 py-8">関連する商談がありません</p>
                  ) : (
                    <div className="space-y-2">
                      {deals.map((deal) => {
                        const won  = isDealWon(deal)
                        const lost = isDealLost(deal)
                        return (
                          <div
                            key={deal.id}
                            onClick={() => openDealModal({ deal })}
                            className="p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-orange-50 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-medium text-gray-700 flex-1">{deal.title}</p>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <span className={cn(
                                  'text-xs px-2 py-0.5 rounded-full font-medium',
                                  won  ? 'bg-green-100 text-green-700' :
                                  lost ? 'bg-gray-100 text-gray-500' :
                                  'bg-orange-100 text-orange-700'
                                )}>
                                  {getDealStageName(deal)}
                                </span>
                                <ExternalLink size={12} className="text-gray-400" />
                              </div>
                            </div>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-sm font-bold text-gray-600">{formatCurrency(deal.amount)}</span>
                              {deal.close_date && (
                                <span className="text-xs text-gray-400">期限: {formatDate(deal.close_date)}</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ─── Right pane ─── */}
        <div className="lg:w-1/4 space-y-3">
          <Button
            className="w-full"
            icon={<Rocket size={16} />}
            onClick={() => openTossupModal({ contactId: contact.id })}
          >
            トスアップ実行
          </Button>

          {isOwnDivision && (
            <Button
              variant="secondary"
              className="w-full"
              icon={<Plus size={16} />}
              onClick={() => openActivityModal({
                contactId: contact.id,
                contactName: `${contact.name}（${contact.companies?.name ?? ''}）`,
              })}
            >
              活動を記録
            </Button>
          )}

          {contact.companies && (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">企業情報</p>
              <p className="font-medium text-gray-800 text-sm">{contact.companies.name}</p>
              {contact.companies.website && (
                <a
                  href={contact.companies.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-orange-600 hover:underline mt-1 flex items-center gap-1"
                >
                  <ExternalLink size={10} />
                  {contact.companies.website}
                </a>
              )}
            </div>
          )}

          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">サマリー</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">活動数</span>
                <span className="font-bold text-gray-700">{activities.length}件</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">未完了タスク</span>
                <span className={cn('font-bold', todoTasks.length > 0 ? 'text-yellow-600' : 'text-gray-400')}>
                  {todoTasks.length}件
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">商談数</span>
                <span className="font-bold text-gray-700">{deals.length}件</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">合計見込み</span>
                <span className="font-bold text-orange-600">
                  {formatCurrency(deals.reduce((s, d) => s + d.amount, 0))}
                </span>
              </div>
            </div>
          </div>

          {activities.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">最終活動</p>
              <p className="text-sm text-gray-600">{formatRelativeTime(activities[0].action_date)}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {ACT_LABEL[activities[0].activity_type]}
                {activities[0].title && ` · ${activities[0].title}`}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
