import { getSupabase } from './client'
import type { User } from '@/types/database'

export async function fetchDivisionUsers(divisionId: string): Promise<User[]> {
  const { data, error } = await getSupabase()
    .from('user_divisions')
    .select('users:user_id(id,name,email,role,created_at)')
    .eq('division_id', divisionId)
  if (error) return []
  return (data ?? [])
    .map((r: Record<string, unknown>) => r.users)
    .filter(Boolean) as User[]
}
