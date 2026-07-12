'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Target, AlertCircle, Clock, CalendarDays, ArrowRight } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchActivitiesByDivision } from '@/lib/db/activities'
import { fetchDealsByDivision } from '@/lib/db/deals'
import type { Activity, Deal } from '@/types/database'
import { MOCK_ACTIVITIES, MOCK_DEALS, MOCK_CONTACTS, DEFAULT_DIVISION_STAGES } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { buildWonLostStageIds } from '@/lib/stage-status'

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

type ActionItem = {
  key: string
  urgency: 'high' | 'medium' | 'low'
  icon: React.ElementType
  label: string
  detail: string
  link: string
}

interface DailyMissionProps {
  personalMode?: boolean
}

export function DailyMission({ personalMode = false }: DailyMissionProps) {
  const router = useRouter()
  const { activeDivisionId, localActivities, localDeals, taskStatuses, currentUser, divisionStages } = useAppStore()

  const [dbActivities, setDbActivities] = useState<Activity[]>([])
  const [dbDeals, setDbDeals]           = useState<Deal[]>([])

  useEffect(() => {
    if (!activeDivisionId || !isSupabaseConfigured()) return
    fetchActivitiesByDivision(activeDivisionId).then(setDbActivities).catch(() => {})
    fetchDealsByDivision(activeDivisionId).then(setDbDeals).catch(() => {})
  }, [activeDivisionId])

  const allActivities = useMemo((): Activity[] =>
    isSupabaseConfigured()
      ? [...dbActivities, ...localActivities]
      : [...(MOCK_ACTIVITIES as unknown as Activity[]), ...localActivities],
    [dbActivities, localActivities]
  )
  const allDeals = useMemo((): Deal[] =>
    isSupabaseConfigured()
      ? [...dbDeals, ...localDeals]
      : [...(MOCK_DEALS as unknown as Deal[]), ...localDeals],
    [dbDeals, localDeals]
  )

  // 受注・失注ステージIDは共有ヘルパーで解決（旧データの'受注'/'失注'文字列も常に含む。他画面と判定を揃える）
  const divId = activeDivisionId ?? ''
  const stagesForDiv = divisionStages[divId] ?? DEFAULT_DIVISION_STAGES[divId] ?? null
  const { wonIds, lostIds } = useMemo(() => buildWonLostStageIds(stagesForDiv), [stagesForDiv])
  const isActiveStage = (stageId: string) => !wonIds.has(stageId) && !lostIds.has(stageId)

  const divDealIds = useMemo(
    () => new Set(allDeals.filter((d) => d.division_id === activeDivisionId).map((d) => d.id)),
    [allDeals, activeDivisionId]
  )

  // contact IDs for this division (Supabase: resolved from dbActivities targets, demo: from MOCK)
  const divContactIds = useMemo(() => {
    if (isSupabaseConfigured()) {
      return new Set(dbActivities.filter((a) => a.target_type === 'contact').map((a) => a.target_id))
    }
    return new Set(MOCK_CONTACTS.filter((c) => c.division_id === activeDivisionId).map((c) => c.id))
  }, [dbActivities, activeDivisionId])

  const divTasks = useMemo(() => {
    if (personalMode) {
      return allActivities.filter(
        (a) => a.activity_type === 'task' && a.user_id === currentUser?.id &&
               (taskStatuses[a.id] ?? a.status) !== 'done'
      )
    }
    return allActivities.filter(
      (a) => a.activity_type === 'task' &&
             (taskStatuses[a.id] ?? a.status) !== 'done' &&
             ((a.target_type === 'contact' && divContactIds.has(a.target_id)) ||
              (a.target_type === 'deal' && divDealIds.has(a.target_id)))
    )
  }, [allActivities, personalMode, currentUser?.id, taskStatuses, divContactIds, divDealIds])

  const closingDeals = useMemo(() => {
    const base = personalMode
      ? allDeals.filter((d) => d.assigned_user_id === currentUser?.id)
      : allDeals.filter((d) => d.division_id === activeDivisionId)
    return base.filter(
      (d) => isActiveStage(d.stage_id) && d.close_date &&
             daysUntil(d.close_date) >= 0 && daysUntil(d.close_date) <= 7
    )
  }, [allDeals, personalMode, currentUser?.id, activeDivisionId, wonIds, lostIds]) // eslint-disable-line

  const resolveTargetName = (targetType: string, targetId: string): string => {
    if (!isSupabaseConfigured()) {
      if (targetType === 'contact') return MOCK_CONTACTS.find((x) => x.id === targetId)?.name ?? ''
      return MOCK_DEALS.find((x) => x.id === targetId)?.contacts?.name ?? ''
    }
    // In Supabase mode activities don't carry contact names; omit for now
    return ''
  }

  const actions: ActionItem[] = useMemo(() => {
    const result: ActionItem[] = []
    divTasks
      .filter((t) => t.due_date && daysUntil(t.due_date) < 0)
      .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
      .slice(0, 2)
      .forEach((t) => {
        const name = resolveTargetName(t.target_type, t.target_id)
        result.push({
          key: t.id, urgency: 'high', icon: AlertCircle,
          label: t.title ?? 'タスク',
          detail: `期限切れ ${Math.abs(daysUntil(t.due_date!))}日${name ? ` · ${name}` : ''}`,
          link: t.target_type === 'contact' ? `/contacts/${t.target_id}` : '/activities',
        })
      })
    divTasks
      .filter((t) => t.due_date && daysUntil(t.due_date) === 0)
      .slice(0, 2)
      .forEach((t) => {
        const name = resolveTargetName(t.target_type, t.target_id)
        result.push({
          key: t.id, urgency: 'medium', icon: Clock,
          label: t.title ?? 'タスク',
          detail: `本日期限${name ? ` · ${name}` : ''}`,
          link: t.target_type === 'contact' ? `/contacts/${t.target_id}` : '/activities',
        })
      })
    if (result.length < 3) {
      closingDeals.slice(0, 1).forEach((d) => {
        const days = daysUntil(d.close_date!)
        result.push({
          key: d.id, urgency: days <= 2 ? 'high' : 'medium', icon: CalendarDays,
          label: `${d.title}のクロージング`,
          detail: days === 0 ? '本日期限' : `${days}日後が期限`,
          link: '/deals',
        })
      })
    }
    if (result.length < 3) {
      divTasks
        .filter((t) => t.due_date && daysUntil(t.due_date) > 0 && daysUntil(t.due_date) <= 3)
        .filter((t) => !result.some((r) => r.key === t.id))
        .slice(0, 3 - result.length)
        .forEach((t) => {
          const name = resolveTargetName(t.target_type, t.target_id)
          result.push({
            key: t.id, urgency: 'low', icon: Clock,
            label: t.title ?? 'タスク',
            detail: `${daysUntil(t.due_date!)}日後期限${name ? ` · ${name}` : ''}`,
            link: t.target_type === 'contact' ? `/contacts/${t.target_id}` : '/activities',
          })
        })
    }
    return result.slice(0, 3)
  }, [divTasks, closingDeals]) // eslint-disable-line

  const urgencyStyle: Record<string, string> = {
    high: 'bg-red-50 border-red-100', medium: 'bg-orange-50 border-orange-100', low: 'bg-gray-50 border-gray-100',
  }
  const dotStyle: Record<string, string> = {
    high: 'bg-red-500', medium: 'bg-orange-400', low: 'bg-gray-300',
  }
  const textStyle: Record<string, string> = {
    high: 'text-red-500', medium: 'text-orange-500', low: 'text-gray-400',
  }

  return (
    <div className="bg-white border-l-4 border-l-orange-500 border border-gray-100 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-orange-500" />
          <span className="text-xs font-bold text-orange-600 uppercase tracking-wide">Today's Mission</span>
          {personalMode && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">自分のタスク</span>}
        </div>
        {actions.length > 0 && (
          <button onClick={() => router.push('/activities')} className="text-xs text-gray-400 hover:text-orange-600 flex items-center gap-1 transition-colors">
            すべて見る <ArrowRight size={11} />
          </button>
        )}
      </div>
      {actions.length === 0 ? (
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎉</span>
          <div>
            <p className="text-sm font-medium text-gray-700">今日のタスクはすべて完了！</p>
            <p className="text-xs text-gray-400 mt-0.5">新しい活動を記録して商談を前進させましょう</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {actions.map((action) => {
            const Icon = action.icon
            return (
              <button key={action.key} onClick={() => router.push(action.link)}
                className={cn('w-full flex items-center gap-3 text-left p-2.5 rounded-xl border transition-all hover:shadow-sm', urgencyStyle[action.urgency])}>
                <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dotStyle[action.urgency])} />
                <Icon size={13} className={cn('flex-shrink-0', textStyle[action.urgency])} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{action.label}</p>
                  <p className={cn('text-xs', textStyle[action.urgency])}>{action.detail}</p>
                </div>
                <ArrowRight size={13} className="text-gray-300 flex-shrink-0" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
