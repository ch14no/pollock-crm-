import { getSupabase } from './client'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@/types/database'

async function getAuthToken(): Promise<string | null> {
  try {
    const { data: { session } } = await createClient().auth.getSession()
    return session?.access_token ?? null
  } catch { return null }
}

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

export async function createUserAdmin(input: {
  name: string; email: string; password: string; role: string
}): Promise<User> {
  const res = await adminFetch('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? '作成に失敗しました')
  return data as User
}

export async function updateUserAdmin(id: string, updates: {
  name?: string; role?: string; password?: string
}): Promise<void> {
  const res = await adminFetch('/api/admin/users', {
    method: 'PUT',
    body: JSON.stringify({ id, ...updates }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? '更新に失敗しました')
}

export async function deleteUserAdmin(id: string): Promise<void> {
  const res = await adminFetch(`/api/admin/users?id=${id}`, { method: 'DELETE' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? '削除に失敗しました')
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
