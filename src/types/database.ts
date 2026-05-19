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
  due_date?: string
  status: ActivityStatus
  action_date: string
  created_at: string
  // joined
  users?: User
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
