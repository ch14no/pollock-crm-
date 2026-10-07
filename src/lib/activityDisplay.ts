import { Phone, Mail, Users, CheckSquare, Rocket, FileText } from 'lucide-react'
import type { ActivityType } from '@/types/database'

// 活動タイプの表示（アイコン・色・ラベル）。会社ページ（src/components/sourcing/）で使う。
// contacts/[id] と contacts/company/[id] にも同じ定義が残っているが、既存ページは触らない方針のため据え置き

export const ACT_ICON: Record<ActivityType, React.ElementType> = {
  call: Phone, email: Mail, meeting: Users,
  task: CheckSquare, tossup: Rocket, note: FileText,
}
export const ACT_COLOR: Record<ActivityType, string> = {
  call:    'bg-blue-100 text-blue-600',
  email:   'bg-purple-100 text-purple-600',
  meeting: 'bg-green-100 text-green-600',
  task:    'bg-yellow-100 text-yellow-600',
  tossup:  'bg-orange-100 text-orange-600',
  note:    'bg-gray-100 text-gray-600',
}
export const ACT_LABEL: Record<ActivityType, string> = {
  call: '電話', email: 'メール', meeting: '面談',
  task: 'タスク', tossup: 'トスアップ', note: 'メモ',
}
