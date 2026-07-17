import { getSupabase } from './client'
import { createClient } from '@/lib/supabase/client'
import type { Division } from '@/types/database'
import type { DivisionCustomField, DivisionStage, PipelineTab, TaskKanbanStage } from '@/store/appStore'

async function getAuthToken(): Promise<string | null> {
  try {
    const { data: { session } } = await createClient().auth.getSession()
    return session?.access_token ?? null
  } catch { return null }
}

async function adminFetch(url: string, options: RequestInit): Promise<Response> {
  const token = await getAuthToken()
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  })
}

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

export async function createDivision(input: { name: string; colorCode?: string }): Promise<Division> {
  const res = await adminFetch('/api/admin/divisions', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? '作成に失敗しました')
  return data as Division
}

export async function updateDivision(id: string, input: { name?: string; colorCode?: string }): Promise<void> {
  const res = await adminFetch('/api/admin/divisions', {
    method: 'PUT',
    body: JSON.stringify({ id, ...input }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? '更新に失敗しました')
}

export class DivisionDeleteBlockedError extends Error {
  details: { contacts: number; deals: number; tossups: number }
  constructor(message: string, details: { contacts: number; deals: number; tossups: number }) {
    super(message)
    this.name = 'DivisionDeleteBlockedError'
    this.details = details
  }
}

export async function deleteDivision(id: string): Promise<void> {
  const res = await adminFetch(`/api/admin/divisions?id=${id}`, { method: 'DELETE' })
  const data = await res.json()
  if (!res.ok) {
    if (data.details) throw new DivisionDeleteBlockedError(data.error ?? '削除できません', data.details)
    throw new Error(data.error ?? '削除に失敗しました')
  }
}

export async function checkDivisionReferences(id: string): Promise<{
  contacts: number; deals: number; tossups: number; deletable: boolean
}> {
  const token = await getAuthToken()
  const res = await fetch(`/api/admin/divisions?id=${id}`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? '参照チェックに失敗しました')
  return data as { contacts: number; deals: number; tossups: number; deletable: boolean }
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
  await getSupabase().from('pipeline_stages').delete().eq('division_id', divisionId).is('tab_id', null)
  if (stages.length === 0) return
  const { error } = await getSupabase().from('pipeline_stages').insert(
    stages.map((s) => ({ division_id: divisionId, name: s.name, sort_order: s.sort_order, is_won: s.is_won, is_lost: s.is_lost }))
  )
  if (error) throw error
}

// ストアの型に変換済みのステージ一覧（設定画面以外の画面からも共通で使う）
export async function fetchDivisionStagesMapped(divisionId: string): Promise<DivisionStage[]> {
  const raw = await fetchPipelineStages(divisionId) as {
    id: string; name: string; sort_order: number; is_won: boolean; is_lost: boolean; tab_id: string | null
  }[]
  return raw.map((s) => ({
    id: s.id, name: s.name, sortOrder: s.sort_order, isWon: s.is_won, isLost: s.is_lost, tabId: s.tab_id ?? null,
  }))
}

export async function fetchDivisionTabsMapped(divisionId: string): Promise<PipelineTab[]> {
  const raw = await fetchPipelineTabs(divisionId) as {
    id: string; division_id: string; name: string; sort_order: number
  }[]
  return raw.map((r) => ({ id: r.id, divisionId: r.division_id, name: r.name, sortOrder: r.sort_order }))
}

export async function fetchPipelineTabs(divisionId: string) {
  const { data, error } = await getSupabase()
    .from('pipeline_tabs')
    .select('*')
    .eq('division_id', divisionId)
    .order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function createPipelineTab(divisionId: string, name: string, sortOrder: number): Promise<string> {
  const { data, error } = await getSupabase()
    .from('pipeline_tabs')
    .insert({ division_id: divisionId, name, sort_order: sortOrder })
    .select('id').single()
  if (error) throw error
  return data.id as string
}

export async function updatePipelineTab(id: string, updates: { name?: string; sortOrder?: number }): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (updates.name !== undefined) patch.name = updates.name
  if (updates.sortOrder !== undefined) patch.sort_order = updates.sortOrder
  const { error } = await getSupabase().from('pipeline_tabs').update(patch).eq('id', id)
  if (error) throw error
}

export async function deletePipelineTab(id: string): Promise<void> {
  const { error } = await getSupabase().from('pipeline_tabs').delete().eq('id', id)
  if (error) throw error
}

// その事業部の tab_id=NULL（未タブ化）なステージを、新規作成したタブへ一括で付け替える。
// ステージ行のUUIDは維持されるため、既存商談の deals.stage_id 参照は壊れない。
export async function migrateUntabbedStagesToTab(divisionId: string, tabId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('pipeline_stages')
    .update({ tab_id: tabId })
    .eq('division_id', divisionId)
    .is('tab_id', null)
  if (error) throw error
}

export async function upsertPipelineStagesForTab(
  divisionId: string,
  tabId: string,
  stages: { name: string; sort_order: number; is_won: boolean; is_lost: boolean }[]
): Promise<void> {
  await getSupabase().from('pipeline_stages').delete().eq('tab_id', tabId)
  if (stages.length === 0) return
  const { error } = await getSupabase().from('pipeline_stages').insert(
    stages.map((s) => ({
      division_id: divisionId, tab_id: tabId,
      name: s.name, sort_order: s.sort_order, is_won: s.is_won, is_lost: s.is_lost,
    }))
  )
  if (error) throw error
}

// ─── タスクカンバンの列定義（025_task_kanban_stages.sql） ─────────────
// 列定義はDBが真実源。行が無い事業部はクライアント側でデフォルト
// （DEFAULT_DIVISION_TASK_STAGES）やlocalStorageの値にフォールバックする。

export async function fetchDivisionTaskStagesDb(divisionId: string): Promise<TaskKanbanStage[]> {
  const { data, error } = await getSupabase()
    .from('task_kanban_stages')
    .select('id, name, color')
    .eq('division_id', divisionId)
    .order('sort_order')
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    color: r.color as string,
  }))
}

// 列リスト全体を置換保存する。クライアントからのdelete→insert 2リクエスト方式は
// insertだけ失敗した場合に列定義が丸ごと消えるため、1トランザクションで置換する
// RPC（replace_task_kanban_stages・権限不足時は例外）を使う。
// idはクライアント生成のTEXT（'todo'/'stage-<ts>'等）をそのまま保存し、
// task_meta.kanban_stage_id との紐付けを維持する。
export async function saveDivisionTaskStages(divisionId: string, stages: TaskKanbanStage[]): Promise<void> {
  const { error } = await getSupabase().rpc('replace_task_kanban_stages', {
    p_division_id: divisionId,
    p_stages: stages.map((s, i) => ({ id: s.id, name: s.name, color: s.color, sort_order: i })),
  })
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
