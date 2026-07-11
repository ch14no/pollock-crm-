'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Building2, Phone, Mail, Rocket,
  MessageSquare, CheckSquare, Users, FileText, ChevronDown, ExternalLink, Hash,
  Landmark, Edit2,
} from 'lucide-react'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchCompanyById, fetchContactsByCompany } from '@/lib/db/companies'
import { CompanyEditModal } from '@/components/contacts/CompanyEditModal'
import { fetchActivitiesByCompany } from '@/lib/db/activities'
import type { Company, Contact, Activity } from '@/types/database'
import { Button } from '@/components/ui/Button'
import { cn, formatRelativeTime, getInitials } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import type { ActivityType } from '@/types/database'

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

function DivisionBadge({ divisionId }: { divisionId: string }) {
  const divisions = useAppStore((s) => s.divisions)
  const division = divisions.find((d) => d.id === divisionId)
  if (!division) return null
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: division.color_code ?? '#6b7280' }} />
      {division.name}
    </span>
  )
}

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const currentUser = useAppStore((s) => s.currentUser)

  const [company, setCompany] = useState<Company | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [editOpen, setEditOpen] = useState(false)

  // 会社は全社共有マスタのため、編集はDBのcompanies_updateポリシーと同じ manager / super_admin のみ
  const canEditCompany = currentUser?.role === 'super_admin' || currentUser?.role === 'manager'

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setCompany(null)
      setContacts([])
      setActivities([])
      if (!isSupabaseConfigured()) { setLoading(false); return }
      const c = await fetchCompanyById(id)
      if (cancelled) return
      setCompany(c)
      if (!c) { setLoading(false); return }
      const contactsData = await fetchContactsByCompany(id)
      if (cancelled) return
      setContacts(contactsData)
      const activitiesData = await fetchActivitiesByCompany(id, contactsData.map((c) => c.id))
      if (cancelled) return
      setActivities(activitiesData)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [id])

  const toggleExpand = (actId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(actId) ? next.delete(actId) : next.add(actId)
      return next
    })
  }

  const contactNameById = new Map(contacts.map((c) => [c.id, c.name]))

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!company) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-gray-500">会社が見つかりません</p>
        <Button variant="ghost" onClick={() => router.back()} className="mt-4">戻る</Button>
      </div>
    )
  }

  return (
    <div className="w-full">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
      >
        <ArrowLeft size={16} />
        顧客一覧へ戻る
      </button>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* ─── Left pane: 会社情報 ─── */}
        <div className="lg:w-1/3 space-y-3">
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 relative">
            {canEditCompany && (
              <button
                onClick={() => setEditOpen(true)}
                aria-label="会社情報を編集"
                className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-300 hover:text-orange-500 hover:bg-orange-50 transition-colors"
              >
                <Edit2 size={15} />
              </button>
            )}
            <div className="flex flex-col items-center mb-4">
              <div className="w-16 h-16 rounded-xl bg-blue-50 flex items-center justify-center mb-3">
                <Building2 size={28} className="text-blue-500" />
              </div>
              <h1 className="text-lg font-bold text-gray-800 text-center">{company.name}</h1>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-gray-600">
                <Hash size={14} className="flex-shrink-0 text-gray-400" />
                {company.corporate_number
                  ? <span>{company.corporate_number}</span>
                  : <span className="text-gray-300 text-xs">未登録</span>
                }
              </div>
              {company.website && (
                <div className="flex items-center gap-2 text-gray-600 min-w-0">
                  <ExternalLink size={14} className="flex-shrink-0 text-gray-400" />
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-orange-600 truncate text-sm"
                  >
                    {company.website}
                  </a>
                </div>
              )}
              {/* IRページ（M&A事業部要望⑳。ニュース・決算資料共有の起点） */}
              {company.ir_url && (
                <div className="flex items-center gap-2 text-gray-600 min-w-0">
                  <Landmark size={14} className="flex-shrink-0 text-gray-400" />
                  <a
                    href={company.ir_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-orange-600 truncate text-sm"
                  >
                    IRページ
                  </a>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-400 mt-4 pt-4 border-t border-gray-100">
              最終更新: {formatRelativeTime(company.updated_at)}
            </p>
          </div>
        </div>

        {/* ─── Right pane ─── */}
        <div className="lg:w-2/3 space-y-3">
          {/* 担当者一覧 */}
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">担当者一覧</p>
            {contacts.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-8">この会社に紐づく担当者はいません</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {contacts.map((contact) => (
                  <div
                    key={contact.id}
                    onClick={() => router.push(`/contacts/${contact.id}`)}
                    className="flex items-center gap-3 py-3 cursor-pointer hover:bg-orange-50/50 transition-colors rounded-lg px-2 -mx-2"
                  >
                    <div className="w-9 h-9 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
                      {getInitials(contact.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-gray-800">{contact.name}</span>
                        <DivisionBadge divisionId={contact.division_id} />
                        {contact.position && <span className="text-xs text-gray-500">{contact.position}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400 flex-wrap">
                        {contact.phone && (
                          <a href={`tel:${contact.phone}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 hover:text-orange-600">
                            <Phone size={11} />{contact.phone}
                          </a>
                        )}
                        {contact.email && (
                          <a href={`mailto:${contact.email}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 hover:text-orange-600 truncate max-w-48">
                            <Mail size={11} />{contact.email}
                          </a>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-gray-300 flex-shrink-0">
                      {formatRelativeTime(contact.updated_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 活動履歴 */}
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">活動履歴</p>
            {activities.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-8">活動履歴がありません</p>
            ) : (
              <div className="space-y-3">
                {activities.map((act) => {
                  const Icon = ACT_ICON[act.activity_type]
                  const color = ACT_COLOR[act.activity_type]
                  const label = ACT_LABEL[act.activity_type]
                  const isExpanded = expandedIds.has(act.id)
                  const contactName = act.target_type === 'contact' ? contactNameById.get(act.target_id) : undefined

                  return (
                    <div key={act.id} className="flex gap-3">
                      <div className={cn('w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5', color)}>
                        <Icon size={13} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-1">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded', color)}>{label}</span>
                              <span className="text-xs text-gray-400">{formatRelativeTime(act.action_date)}</span>
                              {act.users && (
                                <span className="text-xs text-gray-400">{act.users.name}</span>
                              )}
                              {contactName && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{contactName}</span>
                              )}
                            </div>
                            {act.title && (
                              <p className="text-sm font-medium text-gray-700 mt-0.5">{act.title}</p>
                            )}
                          </div>
                          {act.memo && (
                            <button onClick={() => toggleExpand(act.id)} className="text-gray-300 hover:text-gray-500 flex-shrink-0">
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
          </div>
        </div>
      </div>

      {canEditCompany && editOpen && (
        <CompanyEditModal
          onClose={() => setEditOpen(false)}
          company={company}
          onSaved={setCompany}
        />
      )}
    </div>
  )
}
