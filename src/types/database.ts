export type Role = 'super_admin' | 'manager' | 'user'
export type ActivityType = 'call' | 'email' | 'meeting' | 'task' | 'tossup' | 'note'
export type ActivityStatus = 'todo' | 'doing' | 'done'
export type TossupStatus = 'unread' | 'in_progress' | 'closed'
export type TargetType = 'contact' | 'deal' | 'company'

// 紹介者（M&A事業部要望④）。社内は users 参照、社外は contacts 参照。
export type ReferrerType = 'internal' | 'external'

// 紹介者として参照される社外担当者の要約情報。
// フルの Contact 型（tags・custom_attributes 等が必須）をそのまま使うと
// 浅いjoin結果でダミー値を埋める羽目になるため、表示に必要な項目のみの専用型にする。
export interface ReferrerContact {
  id: string
  name: string
  department?: string
  position?: string
  email?: string
  phone?: string
  company_id?: string
  companies?: { id: string; name: string }
}

// 紹介者として参照される社内担当者の情報。DBのjoin結果（Contact/Dealのreferrer_user）は
// フル（email/role/created_at含む）だが、紹介者検索（024マイグレーションのSECURITY DEFINER
// 関数経由のfetchUsersWithDivision）はid/nameのみを返す（email等の機微情報を全社員に
// 晒さない設計。修正2）ため、email/role/created_atは任意にしている
export interface ReferrerUser {
  id: string
  name: string
  email?: string
  role?: Role
  created_at?: string
}

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
  // 紹介者（M&A事業部要望④。021マイグレーション）
  referrer_type?: ReferrerType
  referrer_user_id?: string
  referrer_contact_id?: string
  created_at: string
  updated_at: string
  // joined
  companies?: Company
  users?: User
  divisions?: Division
  referrer_user?: ReferrerUser
  referrer_contact?: ReferrerContact
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
  // 紹介者（M&A事業部要望④。021マイグレーション）
  referrer_type?: ReferrerType
  referrer_user_id?: string
  referrer_contact_id?: string
  created_at: string
  updated_at: string
  // joined
  contacts?: Contact
  users?: User
  referrer_user?: ReferrerUser
  referrer_contact?: ReferrerContact
}

// ─── 対応期日（マイルストーン）＋Slack通知設定（M&A事業部要望⑧。022マイグレーション） ───

// 事業部ごとに設定可能なマイルストーン種別（013の division_document_types と同じパターン）
export interface DivisionMilestoneType {
  id: string
  division_id: string
  name: string
  sort_order: number
  created_at: string
}

// 案件ごとのマイルストーン期日
export interface DealMilestone {
  id: string
  deal_id: string
  division_id: string
  milestone_type_id: string
  due_date?: string
  notified_at?: string
  created_at: string
  updated_at: string
  // joined
  division_milestone_types?: DivisionMilestoneType
}

// 事業部ごとのSlack通知設定（webhook URLはmanager/super_adminのみ閲覧可）
export interface DivisionNotificationSettings {
  division_id: string
  slack_webhook_url?: string
  slack_mention?: string
  days_before: number
  enabled: boolean
  updated_at: string
}

// ─── 売主・買主の希望条件（M&A事業部要望㉒。023マイグレーション） ───

export type DesiredArea = '全国' | '1都3県' | '関東' | '関西' | '中部' | '九州' | 'その他'
export type LossDeficitOk = '可' | '否'
export type FundingMethod = '手元資金' | '借入' | 'エクイティ'

// 売主の譲渡希望条件（1商談＝1レコード）
export interface DealSellerConditions {
  deal_id: string
  division_id: string
  desired_timing?: string
  desired_scheme?: string
  desired_price?: string
  other_conditions?: string
  updated_at: string
}

// 買主の買収意向（1商談＝1レコード）
export interface DealBuyerConditions {
  deal_id: string
  division_id: string
  desired_area?: DesiredArea
  desired_industry?: string
  desired_revenue_size?: string
  valuation_method?: string
  investment_budget_max?: string
  loss_deficit_ok?: LossDeficitOk
  funding_method?: FundingMethod
  funding_amount_max?: string
  key_man_lockup?: string
  audit_by_company?: string
  audit_by_specialist?: string
  review_period?: string
  approval_flow?: string
  updated_at: string
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
