import { getSupabase } from './client'

export async function findOrCreateCompany(name: string): Promise<string | null> {
  if (!name.trim()) return null
  const supabase = getSupabase()
  const { data: existing } = await supabase
    .from('companies')
    .select('id')
    .eq('name', name.trim())
    .maybeSingle()
  if (existing) return existing.id
  const { data: created, error } = await supabase
    .from('companies')
    .insert({ name: name.trim() })
    .select('id')
    .single()
  if (error) return null
  return created.id
}
