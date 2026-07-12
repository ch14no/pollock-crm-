import type { DivisionStage } from '@/store/appStore'

// 事業部別ステージ定義から「受注」「失注」として扱う stage_id の集合を作る。
// 本番の deals.stage_id は pipeline_stages.id（UUID）なので、名前のハードコード比較では判定できない。
// 旧データで stage_id にステージ名（'受注'/'失注'）が残っているケースのために、従来の文字列も常に含める。
export function buildWonLostStageIds(stages: DivisionStage[] | undefined | null): {
  wonIds: Set<string>
  lostIds: Set<string>
} {
  const wonIds = new Set<string>(['受注'])
  const lostIds = new Set<string>(['失注'])
  for (const s of stages ?? []) {
    if (s.isWon) wonIds.add(s.id)
    if (s.isLost) lostIds.add(s.id)
  }
  return { wonIds, lostIds }
}
