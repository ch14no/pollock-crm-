export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Tables: {
      users: {
        Row: { id: string; name: string; email: string; role: string; avatar_url: string | null; created_at: string }
        Insert: { id: string; name: string; email: string; role?: string }
        Update: { name?: string; role?: string; avatar_url?: string | null }
      }
      divisions: {
        Row: { id: string; name: string; color_code: string | null; created_at: string }
        Insert: { name: string; color_code?: string | null }
        Update: { name?: string; color_code?: string | null }
      }
      user_divisions: {
        Row: { user_id: string; division_id: string; is_primary: boolean }
        Insert: { user_id: string; division_id: string; is_primary?: boolean }
        Update: { is_primary?: boolean }
      }
      companies: {
        Row: { id: string; name: string; corporate_number: string | null; website: string | null; ir_url: string | null; created_at: string; updated_at: string }
        Insert: { name: string; corporate_number?: string | null; website?: string | null; ir_url?: string | null }
        Update: { name?: string; corporate_number?: string | null; website?: string | null; ir_url?: string | null }
      }
      contacts: {
        Row: { id: string; company_id: string | null; division_id: string; assigned_user_id: string | null; name: string; email: string | null; phone: string | null; position: string | null; tags: string[]; custom_attributes: Json; notes: string | null; created_at: string; updated_at: string }
        Insert: { company_id?: string | null; division_id: string; assigned_user_id?: string | null; name: string; email?: string | null; phone?: string | null; position?: string | null; tags?: string[]; custom_attributes?: Json; notes?: string | null }
        Update: { name?: string; email?: string | null; phone?: string | null; position?: string | null; tags?: string[]; custom_attributes?: Json; notes?: string | null; assigned_user_id?: string | null }
      }
      pipeline_stages: {
        Row: { id: string; division_id: string; name: string; sort_order: number; is_won: boolean; is_lost: boolean; created_at: string }
        Insert: { division_id: string; name: string; sort_order?: number; is_won?: boolean; is_lost?: boolean }
        Update: { name?: string; sort_order?: number; is_won?: boolean; is_lost?: boolean }
      }
      deals: {
        Row: { id: string; contact_id: string | null; division_id: string; assigned_user_id: string | null; title: string; amount: number; stage_id: string; close_date: string | null; description: string | null; created_at: string; updated_at: string }
        Insert: { contact_id?: string | null; division_id: string; assigned_user_id?: string | null; title: string; amount?: number; stage_id: string; close_date?: string | null; description?: string | null }
        Update: { title?: string; amount?: number; stage_id?: string; close_date?: string | null; description?: string | null; assigned_user_id?: string | null }
      }
      activities: {
        Row: { id: string; target_type: string; target_id: string; user_id: string | null; activity_type: string; title: string | null; memo: string | null; due_date: string | null; status: string; action_date: string; created_at: string }
        Insert: { target_type: string; target_id: string; user_id?: string | null; activity_type: string; title?: string | null; memo?: string | null; due_date?: string | null; status?: string; action_date?: string }
        Update: { title?: string | null; memo?: string | null; due_date?: string | null; status?: string }
      }
      tossups: {
        Row: { id: string; from_user_id: string | null; from_division_id: string; to_division_id: string; company_id: string | null; contact_id: string | null; message: string; status: string; created_at: string; updated_at: string }
        Insert: { from_user_id?: string | null; from_division_id: string; to_division_id: string; company_id?: string | null; contact_id?: string | null; message: string; status?: string }
        Update: { status?: string }
      }
      task_meta: {
        Row: { activity_id: string; urgency: boolean; importance: boolean; scope: string; created_at: string }
        Insert: { activity_id: string; urgency?: boolean; importance?: boolean; scope?: string }
        Update: { urgency?: boolean; importance?: boolean; scope?: string }
      }
      challenges: {
        Row: { id: string; division_id: string | null; user_id: string | null; title: string; description: string | null; scope: string; deadline: string | null; status: string; created_at: string; updated_at: string }
        Insert: { division_id?: string | null; user_id?: string | null; title: string; description?: string | null; scope?: string; deadline?: string | null; status?: string }
        Update: { title?: string; description?: string | null; scope?: string; deadline?: string | null; status?: string }
      }
      contact_statuses: {
        Row: { contact_id: string; status: string; user_id: string | null; created_at: string }
        Insert: { contact_id: string; status: string; user_id?: string | null }
        Update: Record<string, never>
      }
      division_custom_fields: {
        Row: { id: string; division_id: string; name: string; label: string; field_type: string; options: string[] | null; required: boolean; sort_order: number; created_at: string }
        Insert: { division_id: string; name: string; label: string; field_type: string; options?: string[] | null; required?: boolean; sort_order?: number }
        Update: { label?: string; field_type?: string; options?: string[] | null; required?: boolean; sort_order?: number }
      }
      contact_custom_values: {
        Row: { contact_id: string; field_id: string; value: string | null; updated_at: string }
        Insert: { contact_id: string; field_id: string; value?: string | null }
        Update: { value?: string | null }
      }
    }
  }
}
