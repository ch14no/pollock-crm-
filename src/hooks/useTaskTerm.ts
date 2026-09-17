import { useAppStore } from '@/store/appStore'

// 事業部ごとの「タスク管理」呼称カスタマイズ（052、M&A事業部要望④。useDealTermと同型）。
// activeDivisionが未設定（初期ロード中等）でも安全にフォールバックする
export function useTaskTerm(): string {
  const activeDivision = useAppStore((s) => s.activeDivision)
  return activeDivision?.task_term ?? 'タスク管理'
}
