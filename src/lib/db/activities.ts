import { getSupabase } from './client'
import type { Activity } from '@/types/database'

export async function fetchActivitiesByUser(userId: string): Promise<Activity[]> {
  const { data, error } = await getSupabase()
    .from('activities')
    .select('*, users:user_id(id,name,email,role,created_at)')
    .eq('user_id', userId)
    .order('action_date', { ascending: false })
    .limit(200)
  if (error) throw error
  return (data ?? []).map(toActivity)
}

export async function fetchActivitiesByTarget(targetType: string, targetId: string): Promise<Activity[]> {
  const { data, error } = await getSupabase()
    .from('activities')
    .select('*, users:user_id(id,name,email,role,created_at)')
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .order('action_date', { ascending: false })
  if (error) throw error
  return (data ?? []).map(toActivity)
}

export async function createActivity(input: {
  targetType: string; targetId: string; userId?: string; activityType: string
  title?: string; memo?: string; dueDate?: string; status?: string; actionDate?: string
}): Promise<string> {
  const { data, error } = await getSupabase()
    .from('activities')
    .insert({
      target_type: input.targetType, target_id: input.targetId,
      user_id: input.userId ?? null, activity_type: input.activityType,
      title: input.title ?? null, memo: input.memo ?? null,
      due_date: input.dueDate ?? null, status: input.status ?? 'done',
      action_date: input.actionDate ?? new Date().toISOString(),
    })
    .select('id').single()
  if (error) throw error
  return data.id
}

export async function updateActivityStatus(id: string, status: string): Promise<void> {
  const { error } = await getSupabase()
    .from('activities').update({ status }).eq('id', id)
  if (error) throw error
}

export async function upsertTaskMeta(activityId: string, urgency: boolean, importance: boolean, scope: string): Promise<void> {
  const { error } = await getSupabase()
    .from('task_meta')
    .upsert({ activity_id: activityId, urgency, importance, scope })
  if (error) throw error
}

function toActivity(r: Record<string, unknown>): Activity {
  return {
    id: r.id as string,
    target_type: r.target_type as 'contact' | 'deal',
    target_id: r.target_id as string,
    user_id: r.user_id as string | undefined,
    activity_type: r.activity_type as Activity['activity_type'],
    title: r.title as string | undefined,
    memo: r.memo as string | undefined,
    due_date: r.due_date as string | undefined,
    status: r.status as Activity['status'],
    action_date: r.action_date as string,
    created_at: r.created_at as string,
    users: r.users as Activity['users'],
  }
}
