import { getSupabase } from './client'
import type { IndustryClass } from '@/types/database'

// 業種マスタ（044）。大中小の全階層を1回で取得しクライアント側で階層構築する
// （最大でも大20・中99・小394＝500件程度の想定で、ContactPicker/CompanyPicker
// と同じ「全件ロード→クライアントフィルタ」方式で十分な規模）。
// 044未適用の環境では例外を投げず空配列を返し、呼び出し元（CompanyEditModal）が
// 自由テキスト入力へフォールバックできるようにする
export async function fetchIndustryClasses(): Promise<IndustryClass[]> {
  const { data, error } = await getSupabase()
    .from('industry_classes')
    .select('code, level, parent_code, name, keywords, sort_order')
    .order('level')
    .order('sort_order')
  if (error) return []
  return (data ?? []).map((r) => ({
    code: r.code as string,
    level: r.level as 1 | 2 | 3,
    parent_code: (r.parent_code as string | null) ?? undefined,
    name: r.name as string,
    keywords: (r.keywords as string | null) ?? undefined,
    sort_order: r.sort_order as number,
  }))
}
