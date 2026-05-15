import { getSupabase } from './client'
import type { Division } from '@/types/database'
import type { DivisionCustomField } from '@/store/appStore'

export async function fetchDivisionCustomFields(divisionId: string): Promise<DivisionCustomField[]> {
  const { data, error } = await getSupabase()
    .from('division_custom_fields')
    .select('*')
    .eq('division_id', divisionId)
    .order('sort_order', { ascending: true })
  if (error) return []
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    label: r.label as string,
    fieldType: r.field_type as DivisionCustomField['fieldType'],
    options: Array.isArray(r.options) ? (r.options as string[]) : undefined,
    required: (r.required as boolean) ?? false,
    sortOrder: (r.sort_order as number) ?? 0,
  }))
}

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
