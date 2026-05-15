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

export async function upsertPipelineStages(
  divisionId: string,
  stages: { name: string; sort_order: number; is_won: boolean; is_lost: boolean }[]
): Promise<void> {
  await getSupabase().from('pipeline_stages').delete().eq('division_id', divisionId)
  if (stages.length === 0) return
  const { error } = await getSupabase().from('pipeline_stages').insert(
    stages.map((s) => ({ division_id: divisionId, name: s.name, sort_order: s.sort_order, is_won: s.is_won, is_lost: s.is_lost }))
  )
  if (error) throw error
}

export async function createDivisionCustomField(input: {
  divisionId: string; name: string; label: string
  fieldType: string; options?: string[]; sortOrder: number
}): Promise<string> {
  const { data, error } = await getSupabase()
    .from('division_custom_fields')
    .insert({
      division_id: input.divisionId, name: input.name, label: input.label,
      field_type: input.fieldType, options: input.options ?? null, sort_order: input.sortOrder,
    })
    .select('id').single()
  if (error) throw error
  return data.id as string
}

export async function updateDivisionCustomField(id: string, input: {
  label: string; fieldType: string; options?: string[]; sortOrder: number
}): Promise<void> {
  const { error } = await getSupabase()
    .from('division_custom_fields')
    .update({ label: input.label, field_type: input.fieldType, options: input.options ?? null, sort_order: input.sortOrder })
    .eq('id', id)
  if (error) throw error
}

export async function deleteDivisionCustomField(id: string): Promise<void> {
  const { error } = await getSupabase().from('division_custom_fields').delete().eq('id', id)
  if (error) throw error
}
