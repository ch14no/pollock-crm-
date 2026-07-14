import { getSupabase } from './client'
import { createClient } from '@/lib/supabase/client'
import type { ReferrerUser, User } from '@/types/database'

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
  name: string; email: string; password: string; role: string; divisionIds?: string[]
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
  name?: string; role?: string; password?: string; divisionIds?: string[]
}): Promise<void> {
  const res = await adminFetch('/api/admin/users', {
    method: 'PUT',
    body: JSON.stringify({ id, ...updates }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? '更新に失敗しました')
}

export async function fetchUserDivisionIds(userId: string): Promise<string[]> {
  const { data } = await getSupabase()
    .from('user_divisions')
    .select('division_id')
    .eq('user_id', userId)
  return (data ?? []).map((r) => r.division_id as string)
}

export async function deleteUserAdmin(id: string): Promise<void> {
  const res = await adminFetch(`/api/admin/users?id=${id}`, { method: 'DELETE' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? '削除に失敗しました')
}

// 紹介者ピッカー（社内）用: 全ユーザー＋主所属事業部名。
// users テーブルを直接クエリすると users_select RLS（自分自身 or super_admin のみ）に
// より一般ユーザー・managerからは自分以外が見えないため（修正2）、024マイグレーションの
// SECURITY DEFINER関数 list_user_directory() 経由で取得する。
// email等の機微情報は返さないため、戻り値もReferrerUser（id/nameのみ）ベースにしている
export async function fetchUsersWithDivision(): Promise<(ReferrerUser & { primaryDivisionName?: string })[]> {
  const { data, error } = await getSupabase().rpc('list_user_directory')
  if (error) return []
  type Raw = { id: string; name: string; primary_division_name: string | null }
  return ((data ?? []) as Raw[]).map((r) => ({
    id: r.id,
    name: r.name,
    primaryDivisionName: r.primary_division_name ?? undefined,
  }))
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
