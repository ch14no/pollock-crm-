import type { TaskKanbanStage, TaskKanbanTab } from '@/store/appStore'

export function hasTaskTabs(divisionTaskTabs: Record<string, TaskKanbanTab[]>, divisionId: string | null | undefined): boolean {
  if (!divisionId) return false
  return (divisionTaskTabs[divisionId]?.length ?? 0) > 0
}

// TaskKanbanStageはsortOrderを持たないため、pipeline-tabs.tsのstagesForTabと違い
// ソートしない（配列順＝DBのsort_order順が正のため、フィルタのみ行う）
export function taskStagesForTab(stages: TaskKanbanStage[], tabId: string | null): TaskKanbanStage[] {
  return stages.filter((s) => (s.tabId ?? null) === tabId)
}

// タスクの所属タブを返す。ステージが実在しない／tabIdがどのタブとも一致しない場合は
// フォールバック先タブ（fallbackTabId、通常はresolveFallbackTaskTabIdの結果）に解決する。
// これにより迷子タスクのフォールバック先が常に単一の場所に収束する
// （同じタスクが複数タブに重複表示されるのを防ぐ）
export function taskTabIdForStage(
  stages: TaskKanbanStage[], stageId: string | undefined, fallbackTabId: string
): string {
  return stages.find((s) => s.id === stageId)?.tabId ?? fallbackTabId
}

// 迷子タスク（列削除・stage未設定）の受け皿として使うタブを決定する。
// 単純に「先頭タブ（sort_order最小）」を使うと、そのタブの列がすべて削除されて
// 0件になった場合（他タブに列が残っていれば事業部全体としては許可される操作）、
// 受け皿となる列自体が存在せず迷子タスクがどのタブを見ても表示されなくなる
// （実機なら「未担当タスクが消えた」に見える）。そのため「列を1つ以上持つ先頭タブ」を
// 優先し、万一どのタブにも列が無い（事業部全体で0列。通常は最後の1列削除ガードで
// 起こり得ない）場合のみ先頭タブへフォールバックする
export function resolveFallbackTaskTabId(
  taskTabs: TaskKanbanTab[], stages: TaskKanbanStage[]
): string | null {
  if (taskTabs.length === 0) return null
  const withStages = taskTabs.find((t) => stages.some((s) => (s.tabId ?? null) === t.id))
  return (withStages ?? taskTabs[0]).id
}
