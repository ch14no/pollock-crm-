import { getSupabase } from './client'

// 商品マスタ（事業部別）。supabase/migrations/010_products.sql のテーブルを使用する。
// マイグレーション未適用の環境ではnullを返し、呼び出し側は既存のローカルキャッシュにフォールバックする。
export async function fetchDivisionProductsData(
  divisionId: string
): Promise<{ products: string[]; enabled: boolean } | null> {
  try {
    const supabase = getSupabase()
    const [prodRes, settingRes] = await Promise.all([
      supabase
        .from('division_products')
        .select('name, sort_order')
        .eq('division_id', divisionId)
        .order('sort_order'),
      supabase
        .from('division_settings')
        .select('products_enabled')
        .eq('division_id', divisionId)
        .maybeSingle(),
    ])
    if (prodRes.error) return null
    return {
      products: (prodRes.data ?? []).map((r) => r.name as string),
      enabled: (settingRes.data?.products_enabled as boolean | undefined) ?? false,
    }
  } catch {
    return null
  }
}

// 1件単位で追加・削除する（全削除→全挿入だと途中失敗や同時編集で
// 商品マスタが丸ごと消えるリスクがあるため、操作単位をアトミックに保つ）
export async function addDivisionProduct(divisionId: string, name: string, sortOrder: number): Promise<void> {
  const { error } = await getSupabase()
    .from('division_products')
    .insert({ division_id: divisionId, name, sort_order: sortOrder })
  if (error) throw error
}

export async function removeDivisionProduct(divisionId: string, name: string): Promise<void> {
  const { error } = await getSupabase()
    .from('division_products')
    .delete()
    .eq('division_id', divisionId)
    .eq('name', name)
  if (error) throw error
}

export async function saveDivisionProductsEnabled(divisionId: string, enabled: boolean): Promise<void> {
  const { error } = await getSupabase()
    .from('division_settings')
    .upsert({ division_id: divisionId, products_enabled: enabled, updated_at: new Date().toISOString() })
  if (error) throw error
}
