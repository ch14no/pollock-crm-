import { getSupabase } from './client'
import type { Deal } from '@/types/database'

export async function fetchDealsByDivision(divisionId: string): Promise<Deal[]> {
  const { data, error } = await getSupabase()
    .from('deals')
    .select('*, contacts(id,name,company_id,companies(id,name)), users:assigned_user_id(id,name,email,role,created_at)')
    .eq('division_id', divisionId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((d) => ({
    id: d.id, contact_id: d.contact_id ?? undefined, division_id: d.division_id,
    assigned_user_id: d.assigned_user_id ?? undefined, title: d.title,
    amount: d.amount, stage_id: d.stage_id,
    close_date: d.close_date ?? undefined, description: d.description ?? undefined,
    created_at: d.created_at, updated_at: d.updated_at,
    contacts: d.contacts ?? undefined,
    users: d.users ?? undefined,
  })) as Deal[]
}

export async function createDeal(input: {
  divisionId: string; contactId?: string; assignedUserId?: string
  title: string; amount: number; stageId: string; closeDate?: string; description?: string
}): Promise<string> {
  const { data, error } = await getSupabase()
    .from('deals')
    .insert({
      division_id: input.divisionId, contact_id: input.contactId ?? null,
      assigned_user_id: input.assignedUserId ?? null,
      title: input.title, amount: input.amount, stage_id: input.stageId,
      close_date: input.closeDate ?? null, description: input.description ?? null,
    })
    .select('id').single()
  if (error) throw error
  return data.id
}

export async function updateDealStage(id: string, stageId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('deals').update({ stage_id: stageId }).eq('id', id)
  if (error) throw error
}

export async function updateDeal(id: string, updates: {
  title?: string; amount?: number; stageId?: string
  closeDate?: string | null; description?: string | null
}): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (updates.title !== undefined) patch.title = updates.title
  if (updates.amount !== undefined) patch.amount = updates.amount
  if (updates.stageId !== undefined) patch.stage_id = updates.stageId
  if (updates.closeDate !== undefined) patch.close_date = updates.closeDate
  if (updates.description !== undefined) patch.description = updates.description
  const { error } = await getSupabase().from('deals').update(patch).eq('id', id)
  if (error) throw error
}
