import { getSupabase } from './client'
import type { Division } from '@/types/database'

export async function fetchDivisions(): Promise<Division[]> {
  const { data, error } = await getSupabase()
    .from('divisions')
    .select('*')
    .order('created_at')
  if (error) throw error
  return (data ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    color_code: d.color_code ?? undefined,
    created_at: d.created_at,
  }))
}

export async function fetchUserDivisions(userId: string): Promise<{ divisionId: string; isPrimary: boolean }[]> {
  const { data, error } = await getSupabase()
    .from('user_divisions')
    .select('division_id, is_primary')
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? []).map((d) => ({ divisionId: d.division_id, isPrimary: d.is_primary }))
}

export async function fetchPipelineStages(divisionId: string) {
  const { data, error } = await getSupabase()
    .from('pipeline_stages')
    .select('*')
    .eq('division_id', divisionId)
    .order('sort_order')
  if (error) throw error
  return data ?? []
}
