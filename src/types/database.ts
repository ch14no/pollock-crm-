export type Role = 'super_admin' | 'manager' | 'user'
export type ActivityType = 'call' | 'email' | 'meeting' | 'task' | 'tossup' | 'note'
export type ActivityStatus = 'todo' | 'doing' | 'done'
export type TossupStatus = 'unread' | 'in_progress' | 'closed'
export type TargetType = 'contact' | 'deal' | 'company'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  avatar_url?: string
  created_at: string
}

export interface Division {
  id: string
  name: string
  color_code?: string
  created_at: string
}

export interface UserDivision {
  user_id: string
  division_id: string
  is_primary: boolean
}

export interface Company {
  id: string
  name: string
  corporate_number?: string
  website?: string
  ir_url?: string
  address?: string
  phone?: string
  industry?: string
  representative?: string
  employee_count?: number
  capital?: number
  established_on?: string
  note?: string
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  company_id?: string
  division_id: string
  assigned_user_id?: string
  name: string
  email?: string
  phone?: string
  position?: string
  address?: string
  department?: string
  tags: string[]
  custom_attributes: Record<string, unknown>
  notes?: string
  created_at: string
  updated_at: string
  // joined
  companies?: Company
  users?: User
  divisions?: Division
}

export interface PipelineStage {
  id: string
  division_id: string
  name: string
  sort_order: number
  is_won: boolean
  is_lost: boolean
  created_at: string
}

export type DealPriority = 'high' | 'medium' | 'low'

// 案件資料（Google Drive等へのリンク。ファイル実体は保存しない）
export interface DealDocument {
  id: string
  deal_id: string
  division_id: string
  doc_type: string
  name: string
  url: string
  note?: string
  created_by?: string
  created_at: string
  updated_at: string
  // joined（資料一覧ページ用）
  deals?: { id: string; title: string }
}

// 事業部ごとの資料カテゴリ。is_pinned=trueは案件の資料セクションに常設スロット表示
export interface DivisionDocType {
  id: string
  division_id: string
  name: string
  sort_order: number
  is_pinned: boolean
}

// ナレッジベース（事業部内の知見・研修資料・ニュース共有。M&A事業部要望⑱⑲⑳）
export type KnowledgeVisibility = 'division' | 'company'

export interface KnowledgeLink {
  name: string
  url: string
}

export interface KnowledgePost {
  id: string
  division_id: string
  category: string
  title: string
  body: string // Markdown
  visibility: KnowledgeVisibility
  links: KnowledgeLink[]
  created_by?: string
  created_at: string
  updated_at: string
  // joined
  users?: { id: string; name: string }
  divisions?: { id: string; name: string; color_code?: string }
}

// 事業部ごとのナレッジカテゴリ
export interface DivisionKnowledgeCategory {
  id: string
  division_id: string
  name: string
  sort_order: number
}

// 案件の金銭管理（手数料・報酬の請求/入金状況）
export type PaymentBillingStatus = 'unbilled' | 'billed' | 'paid'
export type PaymentParty = 'seller' | 'buyer'

export interface DealPayment {
  id: string
  deal_id: string
  division_id: string
  payment_type: string
  party?: PaymentParty
  amount: number
  billing_status: PaymentBillingStatus
  invoice_date?: string
  paid_date?: string
  note?: string
  created_by?: string
  created_at: string
  updated_at: string
}

export interface Deal {
  id: string
  contact_id?: string
  division_id: string
  assigned_user_id?: string
  title: string
  amount: number
  stage_id: string
  close_date?: string
  description?: string
  product_name?: string
  priority?: DealPriority
  created_at: string
  updated_at: string
  // joined
  contacts?: Contact
  users?: User
}

export interface Activity {
  id: string
  target_type: TargetType
  target_id: string
  user_id?: string
  activity_type: ActivityType
  title?: string
  memo?: string
  // 用途別カテゴリ（顧客/案件/面談/契約等・事業部で設定可能。M&A事業部要望⑰）
  memo_category?: string
  due_date?: string
  status: ActivityStatus
  action_date: string
  created_at: string
  // joined
  users?: User
}

// 事業部ごとの活動メモカテゴリ
export interface DivisionMemoCategory {
  id: string
  division_id: string
  name: string
  sort_order: number
}

export interface Tossup {
  id: string
  from_user_id?: string
  from_division_id: string
  to_division_id: string
  company_id?: string
  contact_id?: string
  message: string
  status: TossupStatus
  created_at: string
  updated_at: string
  // joined
  from_user?: User
  from_division?: Division
  to_division?: Division
  companies?: Company
  contacts?: { id: string; name: string; position?: string; company_id?: string; companies?: { id: string; name: string } | null }
}
