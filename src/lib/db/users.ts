import { getSupabase } from './client'
import type { User } from '@/types/database'

export async function fetchAllUsers(): Promise<User[]> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('id, name, email, role, created_at')
    .order('created_at', { ascending: true })
  if (error) return []
  return (data ?? []) as User[]
}

export async function updateUserName(userId: string, name: string): Promise<void> {
  const { error } = await getSupabase()
    .from('users')
    .update({ name })
    .eq('id', userId)
  if (error) throw error
}

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
