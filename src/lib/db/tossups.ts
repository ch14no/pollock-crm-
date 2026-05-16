import { getSupabase } from './client'
import type { Tossup } from '@/types/database'

export async function fetchTossupsByDivision(divisionId: string): Promise<Tossup[]> {
  const { data, error } = await getSupabase()
    .from('tossups')
    .select(`
      *,
      from_user:from_user_id(id,name,email,role,created_at),
      from_division:from_division_id(id,name,color_code,created_at),
      to_division:to_division_id(id,name,color_code,created_at),
      companies(id,name),
      contacts(id,name,position,company_id,companies(id,name))
    `)
    .or(`from_division_id.eq.${divisionId},to_division_id.eq.${divisionId}`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Tossup[]
}

export async function fetchUnreadTossupCount(divisionId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from('tossups')
    .select('*', { count: 'exact', head: true })
    .eq('to_division_id', divisionId)
    .eq('status', 'unread')
  if (error) return 0
  return count ?? 0
}

export async function createTossup(input: {
  fromUserId?: string; fromDivisionId: string; toDivisionId: string
  companyId?: string; contactId?: string; message: string
}): Promise<string> {
  const { data, error } = await getSupabase()
    .from('tossups')
    .insert({
      from_user_id:    input.fromUserId ?? null,
      from_division_id: input.fromDivisionId,
      to_division_id:  input.toDivisionId,
      company_id:      input.companyId ?? null,
      contact_id:      input.contactId ?? null,
      message:         input.message,
    })
    .select('id').single()
  if (error) throw error
  return data.id
}

export async function updateTossupStatus(id: string, status: string): Promise<void> {
  const { error } = await getSupabase()
    .from('tossups').update({ status }).eq('id', id)
  if (error) throw error
}
