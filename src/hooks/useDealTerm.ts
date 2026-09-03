import { useAppStore } from '@/store/appStore'

// 事業部ごとの「商談」呼称カスタマイズ（050、M&A事業部要望）。
// activeDivisionが未設定（初期ロード中等）でも安全にフォールバックする
export function useDealTerm(): string {
  const activeDivision = useAppStore((s) => s.activeDivision)
  return activeDivision?.deal_term ?? '商談'
}
