'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Rocket, TrendingUp, Phone, Mail, Users, FileText, CheckSquare } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { MOCK_ACTIVITIES, MOCK_CONTACTS, MOCK_DEALS } from '@/lib/mock-data'
import { formatRelativeTime, cn } from '@/lib/utils'
import type { ActivityType } from '@/types/database'

const TYPE_CONFIG: Record<ActivityType, { icon: React.ElementType; color: string; label: string }> = {
  call:    { icon: Phone,       color: 'text-blue-500 bg-blue-50',    label: '電話' },
  email:   { icon: Mail,        color: 'text-purple-500 bg-purple-50', label: 'メール' },
  meeting: { icon: Users,       color: 'text-green-500 bg-green-50',  label: '面談' },
  task:    { icon: CheckSquare, color: 'text-yellow-500 bg-yellow-50', label: 'タスク' },
  tossup:  { icon: Rocket,      color: 'text-orange-500 bg-orange-50', label: 'トスアップ' },
  note:    { icon: FileText,    color: 'text-gray-500 bg-gray-100',   label: 'メモ' },
}

// ステージ受注はタイムライン上で特別表示
const WON_CONFIG = { icon: TrendingUp, color: 'text-green-500 bg-green-50' }

function resolveTarget(targetType: string, targetId: string): { name: string; contactId?: string } {
  if (targetType === 'contact') {
    const c = MOCK_CONTACTS.find((x) => x.id === targetId)
    return { name: c ? `${c.name}（${c.companies?.name ?? ''}）` : '', contactId: targetId }
  }
  const d = MOCK_DEALS.find((x) => x.id === targetId)
  if (d) {
    return { name: `${d.title}${d.contacts ? ` / ${d.contacts.name}` : ''}`, contactId: d.contact_id }
  }
  return { name: '' }
}

export function RealtimeTimeline() {
  const router = useRouter()
  const { localActivities, activeDivisionId } = useAppStore()

  const divContactIds = useMemo(
    () => new Set(MOCK_CONTACTS.filter((c) => c.division_id === activeDivisionId).map((c) => c.id)),
    [activeDivisionId]
  )
  const divDealIds = useMemo(
    () => new Set(MOCK_DEALS.filter((d) => d.division_id === activeDivisionId).map((d) => d.id)),
    [activeDivisionId]
  )

  const allActivities = useMemo(() => [...localActivities, ...MOCK_ACTIVITIES], [localActivities])

  const recentActivities = useMemo(() => {
    return allActivities
      .filter(
        (a) =>
          (a.target_type === 'contact' && divContactIds.has(a.target_id)) ||
          (a.target_type === 'deal' && divDealIds.has(a.target_id))
      )
      .sort((a, b) => new Date(b.action_date).getTime() - new Date(a.action_date).getTime())
      .slice(0, 8)
  }, [allActivities, divContactIds, divDealIds])

  const isNewActivity = (id: string) => localActivities.some((a) => a.id === id)

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-gray-800">活動タイムライン</h2>
          <p className="text-xs text-gray-400 mt-0.5">{activeDivisionId ? 'この事業部の直近の活動' : '全活動'}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            ライブ
          </span>
          <button
            onClick={() => router.push('/activities')}
            className="text-xs text-orange-600 hover:underline"
          >
            すべて見る
          </button>
        </div>
      </div>

      {recentActivities.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-gray-400">まだ活動が記録されていません</p>
          <p className="text-xs text-gray-300 mt-1">「活動を記録」から最初の活動を追加しましょう</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-50">
          {recentActivities.map((activity) => {
            const cfg = TYPE_CONFIG[activity.activity_type]
            const Icon = cfg.icon
            const target = resolveTarget(activity.target_type, activity.target_id)
            const isNew = isNewActivity(activity.id)

            return (
              <li
                key={activity.id}
                className={cn(
                  'flex gap-3 px-5 py-3.5 transition-all duration-300 cursor-pointer hover:bg-gray-50',
                  isNew && 'bg-orange-50/60'
                )}
                onClick={() => target.contactId && router.push(`/contacts/${target.contactId}`)}
              >
                <div className={cn('w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5', cfg.color)}>
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded', cfg.color)}>
                      {cfg.label}
                    </span>
                    {activity.users && (
                      <span className="text-xs font-medium text-gray-600">{activity.users.name}</span>
                    )}
                    {isNew && (
                      <span className="text-xs text-orange-600 font-bold bg-orange-100 px-1.5 py-0.5 rounded-full">NEW</span>
                    )}
                  </div>
                  {activity.title && (
                    <p className="text-sm font-medium text-gray-700 mt-0.5 truncate">{activity.title}</p>
                  )}
                  {!activity.title && activity.memo && (
                    <p className="text-sm text-gray-600 mt-0.5 truncate">{activity.memo}</p>
                  )}
                  {target.name && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{target.name}</p>
                  )}
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5 whitespace-nowrap">
                  {formatRelativeTime(activity.action_date)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
