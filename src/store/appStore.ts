'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Division, User, Deal, Activity, ActivityStatus, Role, Tossup, TossupStatus } from '@/types/database'

// ─── 管理者用型定義 ─────────────────────────────────────────────
export interface AdminUserRecord {
  id: string
  name: string
  email: string
  password: string
  role: Role
  divisionIds: string[]
  primaryDivisionId: string
  created_at: string
}

export interface MasterDivision {
  id: string
  name: string
  colorCode: string
}

export interface MasterStage {
  id: string
  name: string
  sortOrder: number
  isWon: boolean
}

export interface MasterCustomField {
  id: string
  name: string
  fieldType: 'text' | 'number' | 'boolean'
  target: 'contact' | 'deal'
}

export interface TeamGoal {
  month: string           // "2026-05" 形式
  dealAmount?: number     // 受注目標額
  contactCount?: number   // 新規顧客目標数
  activityCount?: number  // 活動目標数
}

// ─── タスク管理拡張 ────────────────────────────────────────────────
// タスクの4象限メタデータ（urgency×importanceで象限決定）
export interface TaskMeta {
  urgency: boolean       // 緊急
  importance: boolean    // 重要
  scope: 'personal' | 'team'
}

// 長期課題（タスクと別管理）
export interface Challenge {
  id: string
  title: string
  description?: string
  scope: 'personal' | 'team'
  deadline?: string      // ISO string
  createdAt: string
  userId: string
  status: 'open' | 'in_progress' | 'done'
  divisionId?: string
}

// 顧客ステータス（5種）
export type ContactStatus = 'star' | 'heart' | 'rising' | 'blacklist' | 'trophy'

// 顧客ローカル編集（名前・役職・連絡先・タグ）
export interface ContactLocalEdit {
  name?: string
  position?: string
  phone?: string
  email?: string
  department?: string
  address?: string
  notes?: string
  tags?: string[]
}

// 事業部別カスタムフィールド定義
export interface DivisionCustomField {
  id: string
  name: string            // field key (e.g. "industry")
  label: string           // display label (e.g. "業種")
  fieldType: 'text' | 'select' | 'number' | 'boolean'
  options?: string[]      // select の選択肢
  required: boolean
  sortOrder: number
}

// 事業部別パイプラインステージ定義
export interface DivisionStage {
  id: string
  name: string
  sortOrder: number
  isWon: boolean
  isLost: boolean
  tabId: string | null
}

// パイプラインタブ定義（事業部内でカンバンを複数系統に分ける、任意機能）
export interface PipelineTab {
  id: string
  divisionId: string
  name: string
  sortOrder: number
}

// タスクカンバンステージ定義
export interface TaskKanbanStage {
  id: string
  name: string
  color: string  // 'blue' | 'green' | 'yellow' | 'red' | 'gray' | 'purple' | 'orange'
}
// ─────────────────────────────────────────────────────────────────

interface TossupModalState {
  isOpen: boolean
  prefillContactId?: string
  prefillCompanyId?: string
}

interface AppState {
  // Auth
  currentUser: User | null
  setCurrentUser: (user: User | null) => void

  // 自分が所属する事業部IDs（編集権限の基準）
  userOwnDivisionIds: string[]
  setUserOwnDivisions: (ids: string[]) => void

  // 初期化完了フラグ
  initialized: boolean

  // 現在閲覧中の事業部
  divisions: Division[]
  activeDivisionId: string | null
  activeDivision: Division | null
  setDivisions: (divisions: Division[]) => void
  setActiveDivision: (division: Division) => void

  // Tossup modal
  tossupModal: TossupModalState
  openTossupModal: (prefill?: { contactId?: string; companyId?: string }) => void
  closeTossupModal: () => void

  // Activity modal
  activityModal: {
    isOpen: boolean
    prefillContactId?: string
    prefillContactName?: string
    prefillDealId?: string
    prefillDealTitle?: string
    prefillTaskUrgency?: boolean
    prefillTaskImportance?: boolean
    prefillKanbanStageId?: string
  }
  openActivityModal: (prefill?: {
    contactId?: string; contactName?: string
    dealId?: string; dealTitle?: string
    taskUrgency?: boolean; taskImportance?: boolean
    prefillKanbanStageId?: string
  }) => void
  closeActivityModal: () => void

  // Deal modal
  dealModal: {
    isOpen: boolean
    deal?: Deal
    prefillStageId?: string
    prefillContactId?: string
  }
  openDealModal: (options?: { deal?: Deal; prefillStageId?: string; prefillContactId?: string }) => void
  closeDealModal: () => void

  // ローカル活動・商談
  localActivities: Activity[]
  addActivity: (activity: Activity) => void
  localDeals: Deal[]
  addDeal: (deal: Deal) => void
  updateLocalDeal: (id: string, updates: Partial<Deal>) => void
  removeLocalDeal: (id: string) => void

  // タスクのステータス（ページ横断同期）
  taskStatuses: Record<string, ActivityStatus>
  setTaskStatus: (id: string, status: ActivityStatus) => void

  // ─── 管理者データ ───────────────────────────────────────────────
  // 追加アカウント
  adminUsers: AdminUserRecord[]
  addAdminUser: (user: AdminUserRecord) => void
  removeAdminUser: (id: string) => void

  // 権限オーバーライド（既存ユーザーの権限変更）
  roleOverrides: Record<string, Role>
  setRoleOverride: (userId: string, role: Role) => void

  // 事業部所属オーバーライド
  userDivisionMap: Record<string, { ids: string[]; primaryId: string }>
  setUserDivisionMap: (userId: string, ids: string[], primaryId: string) => void

  // マスタ: 追加事業部
  extraDivisions: MasterDivision[]
  removedDivisionIds: string[]
  addExtraDivision: (div: MasterDivision) => void
  removeExtraDivision: (id: string) => void

  // マスタ: 追加ステージ
  extraStages: MasterStage[]
  removedStageIds: string[]
  addExtraStage: (stage: MasterStage) => void
  removeExtraStage: (id: string) => void

  // マスタ: カスタム項目
  extraCustomFields: MasterCustomField[]
  removedFieldIds: string[]
  addExtraCustomField: (field: MasterCustomField) => void
  removeExtraCustomField: (id: string) => void

  // チーム目標管理（マネージャー設定）
  teamGoals: Record<string, TeamGoal>   // userId -> goal
  setTeamGoal: (userId: string, goal: TeamGoal) => void

  // トスアップ（ローカル追加分 + ステータス変更）
  localTossups: Tossup[]
  addTossup: (tossup: Tossup) => void
  tossupStatuses: Record<string, TossupStatus>
  setTossupStatus: (id: string, status: TossupStatus) => void

  // 活動削除・更新（自分が追加したものだけ）
  removeLocalActivity: (id: string) => void
  updateLocalActivity: (id: string, updates: Partial<Activity>) => void

  // 事業部別カスタムフィールド（顧客詳細に表示）
  divisionCustomFields: Record<string, DivisionCustomField[]>  // divisionId -> fields
  setDivisionCustomFields: (divisionId: string, fields: DivisionCustomField[]) => void

  // 事業部別パイプラインステージ
  divisionStages: Record<string, DivisionStage[]>  // divisionId -> stages
  setDivisionStages: (divisionId: string, stages: DivisionStage[]) => void

  // 事業部別パイプラインタブ（任意）
  divisionTabs: Record<string, PipelineTab[]>  // divisionId -> tabs
  setDivisionTabs: (divisionId: string, tabs: PipelineTab[]) => void

  // 選択中のタブ（事業部別、セッション限定・永続化しない）
  activeTabId: Record<string, string | null>
  setActiveTabId: (divisionId: string, tabId: string | null) => void

  // 商品マスタ（事業部別）
  divisionProducts: Record<string, string[]>  // divisionId -> product names
  setDivisionProducts: (divisionId: string, products: string[]) => void

  // 商品選択の表示ON/OFF（事業部別）
  divisionProductsEnabled: Record<string, boolean>
  setDivisionProductsEnabled: (divisionId: string, enabled: boolean) => void

  // 商談の提案商品（dealId -> product name）
  dealProducts: Record<string, string>
  setDealProduct: (dealId: string, product: string) => void
  clearDealProduct: (dealId: string) => void

  // タスクカンバンステージ（事業部別）
  divisionTaskStages: Record<string, TaskKanbanStage[]>
  setDivisionTaskStages: (divisionId: string, stages: TaskKanbanStage[]) => void

  // タスクのカンバン列（activityId -> stageId）
  taskStageMap: Record<string, string>
  setTaskStage: (activityId: string, stageId: string) => void

  // 顧客の事業部別カスタムフィールド値
  contactCustomValues: Record<string, Record<string, string>>  // contactId -> { fieldId -> value }
  setContactCustomValue: (contactId: string, fieldId: string, value: string) => void

  // タスク4象限メタデータ
  taskMeta: Record<string, TaskMeta>  // activityId -> meta
  setTaskMeta: (activityId: string, meta: TaskMeta) => void

  // 長期課題
  localChallenges: Challenge[]
  addChallenge: (challenge: Challenge) => void
  updateChallenge: (id: string, updates: Partial<Challenge>) => void
  removeChallenge: (id: string) => void

  // 顧客ステータス（星・ハート等 複数選択可）
  contactStatuses: Record<string, ContactStatus[]>  // contactId -> statuses[]
  toggleContactStatus: (contactId: string, status: ContactStatus) => void

  // 顧客情報ローカル編集（名前・役職・タグ等）
  localContactEdits: Record<string, ContactLocalEdit>  // contactId -> edit
  setLocalContactEdit: (contactId: string, edit: ContactLocalEdit) => void
  // ─────────────────────────────────────────────────────────────────
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      setCurrentUser: (user) => set({ currentUser: user }),

      userOwnDivisionIds: [],
      setUserOwnDivisions: (ids) => set({ userOwnDivisionIds: ids }),

      initialized: false,

      divisions: [],
      activeDivisionId: null,
      activeDivision: null,
      setDivisions: (divisions) => {
        const current = get().activeDivisionId
        const activeDivision = divisions.find((d) => d.id === current) ?? divisions[0] ?? null
        set({
          initialized: true,
          divisions,
          activeDivisionId: activeDivision?.id ?? null,
          activeDivision,
        })
      },
      setActiveDivision: (division) =>
        set({ activeDivisionId: division.id, activeDivision: division }),

      tossupModal: { isOpen: false },
      openTossupModal: (prefill) =>
        set({ tossupModal: { isOpen: true, prefillContactId: prefill?.contactId, prefillCompanyId: prefill?.companyId } }),
      closeTossupModal: () => set({ tossupModal: { isOpen: false } }),

      activityModal: { isOpen: false },
      openActivityModal: (prefill) =>
        set({
          activityModal: {
            isOpen: true,
            prefillContactId: prefill?.contactId,
            prefillContactName: prefill?.contactName,
            prefillDealId: prefill?.dealId,
            prefillDealTitle: prefill?.dealTitle,
            prefillTaskUrgency: prefill?.taskUrgency,
            prefillTaskImportance: prefill?.taskImportance,
            prefillKanbanStageId: prefill?.prefillKanbanStageId,
          },
        }),
      closeActivityModal: () => set({ activityModal: { isOpen: false } }),

      dealModal: { isOpen: false },
      openDealModal: (options) =>
        set({
          dealModal: {
            isOpen: true,
            deal: options?.deal,
            prefillStageId: options?.prefillStageId,
            prefillContactId: options?.prefillContactId,
          },
        }),
      closeDealModal: () => set({ dealModal: { isOpen: false } }),

      localActivities: [],
      addActivity: (activity) =>
        set((state) => ({ localActivities: [activity, ...state.localActivities] })),

      localDeals: [],
      addDeal: (deal) =>
        set((state) => ({ localDeals: [deal, ...state.localDeals] })),
      updateLocalDeal: (id, updates) =>
        set((state) => ({
          localDeals: state.localDeals.map((d) => d.id === id ? { ...d, ...updates } : d),
        })),
      removeLocalDeal: (id) =>
        set((state) => ({ localDeals: state.localDeals.filter((d) => d.id !== id) })),

      taskStatuses: {},
      setTaskStatus: (id, status) =>
        set((state) => ({ taskStatuses: { ...state.taskStatuses, [id]: status } })),

      // 管理者データ
      adminUsers: [],
      addAdminUser: (user) =>
        set((state) => ({ adminUsers: [...state.adminUsers, user] })),
      removeAdminUser: (id) =>
        set((state) => ({ adminUsers: state.adminUsers.filter((u) => u.id !== id) })),

      roleOverrides: {},
      setRoleOverride: (userId, role) =>
        set((state) => ({ roleOverrides: { ...state.roleOverrides, [userId]: role } })),

      userDivisionMap: {},
      setUserDivisionMap: (userId, ids, primaryId) =>
        set((state) => ({ userDivisionMap: { ...state.userDivisionMap, [userId]: { ids, primaryId } } })),

      extraDivisions: [],
      removedDivisionIds: [],
      addExtraDivision: (div) =>
        set((state) => ({ extraDivisions: [...state.extraDivisions, div] })),
      removeExtraDivision: (id) =>
        set((state) => ({
          extraDivisions: state.extraDivisions.filter((d) => d.id !== id),
          removedDivisionIds: [...state.removedDivisionIds, id],
        })),

      extraStages: [],
      removedStageIds: [],
      addExtraStage: (stage) =>
        set((state) => ({ extraStages: [...state.extraStages, stage] })),
      removeExtraStage: (id) =>
        set((state) => ({
          extraStages: state.extraStages.filter((s) => s.id !== id),
          removedStageIds: [...state.removedStageIds, id],
        })),

      extraCustomFields: [],
      removedFieldIds: [],
      addExtraCustomField: (field) =>
        set((state) => ({ extraCustomFields: [...state.extraCustomFields, field] })),
      removeExtraCustomField: (id) =>
        set((state) => ({
          extraCustomFields: state.extraCustomFields.filter((f) => f.id !== id),
          removedFieldIds: [...state.removedFieldIds, id],
        })),

      teamGoals: {},
      setTeamGoal: (userId, goal) =>
        set((state) => ({ teamGoals: { ...state.teamGoals, [userId]: goal } })),

      localTossups: [],
      addTossup: (tossup) =>
        set((state) => ({ localTossups: [tossup, ...state.localTossups] })),
      tossupStatuses: {},
      setTossupStatus: (id, status) =>
        set((state) => ({ tossupStatuses: { ...state.tossupStatuses, [id]: status } })),

      removeLocalActivity: (id) =>
        set((state) => ({ localActivities: state.localActivities.filter((a) => a.id !== id) })),
      updateLocalActivity: (id, updates) =>
        set((state) => ({
          localActivities: state.localActivities.map((a) => a.id === id ? { ...a, ...updates } : a),
        })),

      divisionCustomFields: {},
      setDivisionCustomFields: (divisionId, fields) =>
        set((state) => ({ divisionCustomFields: { ...state.divisionCustomFields, [divisionId]: fields } })),

      divisionStages: {},
      setDivisionStages: (divisionId, stages) =>
        set((state) => ({ divisionStages: { ...state.divisionStages, [divisionId]: stages } })),

      divisionTabs: {},
      setDivisionTabs: (divisionId, tabs) =>
        set((state) => ({ divisionTabs: { ...state.divisionTabs, [divisionId]: tabs } })),

      activeTabId: {},
      setActiveTabId: (divisionId, tabId) =>
        set((state) => ({ activeTabId: { ...state.activeTabId, [divisionId]: tabId } })),

      divisionProducts: {},
      setDivisionProducts: (divisionId, products) =>
        set((state) => ({ divisionProducts: { ...state.divisionProducts, [divisionId]: products } })),

      divisionProductsEnabled: {},
      setDivisionProductsEnabled: (divisionId, enabled) =>
        set((state) => ({ divisionProductsEnabled: { ...state.divisionProductsEnabled, [divisionId]: enabled } })),

      dealProducts: {},
      setDealProduct: (dealId, product) =>
        set((state) => ({ dealProducts: { ...state.dealProducts, [dealId]: product } })),
      clearDealProduct: (dealId) =>
        set((state) => {
          const next = { ...state.dealProducts }
          delete next[dealId]
          return { dealProducts: next }
        }),

      divisionTaskStages: {},
      setDivisionTaskStages: (divisionId, stages) =>
        set((state) => ({ divisionTaskStages: { ...state.divisionTaskStages, [divisionId]: stages } })),

      taskStageMap: {},
      setTaskStage: (activityId, stageId) =>
        set((state) => ({ taskStageMap: { ...state.taskStageMap, [activityId]: stageId } })),

      contactCustomValues: {},
      setContactCustomValue: (contactId, fieldId, value) =>
        set((state) => ({
          contactCustomValues: {
            ...state.contactCustomValues,
            [contactId]: { ...state.contactCustomValues[contactId], [fieldId]: value },
          },
        })),

      taskMeta: {},
      setTaskMeta: (activityId, meta) =>
        set((state) => ({ taskMeta: { ...state.taskMeta, [activityId]: meta } })),

      localChallenges: [],
      addChallenge: (challenge) =>
        set((state) => ({ localChallenges: [challenge, ...state.localChallenges] })),
      updateChallenge: (id, updates) =>
        set((state) => ({
          localChallenges: state.localChallenges.map((c) => c.id === id ? { ...c, ...updates } : c),
        })),
      removeChallenge: (id) =>
        set((state) => ({ localChallenges: state.localChallenges.filter((c) => c.id !== id) })),

      contactStatuses: {},
      toggleContactStatus: (contactId, status) =>
        set((state) => {
          const current = state.contactStatuses[contactId] ?? []
          const next = current.includes(status)
            ? current.filter((s) => s !== status)
            : [...current, status]
          return { contactStatuses: { ...state.contactStatuses, [contactId]: next } }
        }),

      localContactEdits: {},
      setLocalContactEdit: (contactId, edit) =>
        set((state) => ({
          localContactEdits: { ...state.localContactEdits, [contactId]: edit },
        })),
    }),
    {
      name: 'pollock-crm',
      partialize: (state) => ({
        activeDivisionId: state.activeDivisionId,
        currentUser: state.currentUser,
        localActivities: state.localActivities,
        localDeals: state.localDeals,
        taskStatuses: state.taskStatuses,
        adminUsers: state.adminUsers,
        roleOverrides: state.roleOverrides,
        userDivisionMap: state.userDivisionMap,
        extraDivisions: state.extraDivisions,
        removedDivisionIds: state.removedDivisionIds,
        extraStages: state.extraStages,
        removedStageIds: state.removedStageIds,
        extraCustomFields: state.extraCustomFields,
        removedFieldIds: state.removedFieldIds,
        teamGoals: state.teamGoals,
        localTossups: state.localTossups,
        tossupStatuses: state.tossupStatuses,
        divisionCustomFields: state.divisionCustomFields,
        divisionStages: state.divisionStages,
        divisionTabs: state.divisionTabs,
        divisionProducts: state.divisionProducts,
        divisionProductsEnabled: state.divisionProductsEnabled,
        dealProducts: state.dealProducts,
        divisionTaskStages: state.divisionTaskStages,
        taskStageMap: state.taskStageMap,
        contactCustomValues: state.contactCustomValues,
        contactStatuses: state.contactStatuses,
        localContactEdits: state.localContactEdits,
        taskMeta: state.taskMeta,
        localChallenges: state.localChallenges,
      }),
      skipHydration: true,
    }
  )
)

export const selectIsOwnDivision = (state: AppState) =>
  state.userOwnDivisionIds.includes(state.activeDivisionId ?? '')
