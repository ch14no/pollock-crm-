import type { DivisionStage, PipelineTab } from '@/store/appStore'

export function hasTabs(divisionTabs: Record<string, PipelineTab[]>, divisionId: string | null | undefined): boolean {
  if (!divisionId) return false
  return (divisionTabs[divisionId]?.length ?? 0) > 0
}

export function stagesForTab(stages: DivisionStage[], tabId: string | null): DivisionStage[] {
  return stages.filter((s) => s.tabId === tabId).sort((a, b) => a.sortOrder - b.sortOrder)
}

export function tabIdForStage(stages: DivisionStage[], stageId: string): string | null {
  return stages.find((s) => s.id === stageId)?.tabId ?? null
}
