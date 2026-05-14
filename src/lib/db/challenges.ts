import { getSupabase } from './client'
import type { Challenge } from '@/store/appStore'

export async function fetchChallenges(divisionId: string): Promise<Challenge[]> {
  const { data, error } = await getSupabase()
    .from('challenges')
    .select('*')
    .or(`division_id.eq.${divisionId},division_id.is.null`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id, title: r.title, description: r.description ?? undefined,
    scope: r.scope as 'personal' | 'team', deadline: r.deadline ?? undefined,
    createdAt: r.created_at, userId: r.user_id ?? '',
    status: r.status as Challenge['status'], divisionId: r.division_id ?? undefined,
  }))
}

export async function createChallenge(input: {
  userId: string; divisionId?: string; title: string; description?: string
  scope: 'personal' | 'team'; deadline?: string
}): Promise<string> {
  const { data, error } = await getSupabase()
    .from('challenges')
    .insert({
      user_id: input.userId, division_id: input.divisionId ?? null,
      title: input.title, description: input.description ?? null,
      scope: input.scope, deadline: input.deadline ?? null,
    })
    .select('id').single()
  if (error) throw error
  return data.id
}

export async function updateChallengeStatus(id: string, status: string): Promise<void> {
  const { error } = await getSupabase()
    .from('challenges').update({ status }).eq('id', id)
  if (error) throw error
}

export async function deleteChallenge(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from('challenges').delete().eq('id', id)
  if (error) throw error
}
