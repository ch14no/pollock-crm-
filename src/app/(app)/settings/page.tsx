'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/appStore'
import type { DivisionCustomField, DivisionStage, PipelineTab, TaskKanbanStage } from '@/store/appStore'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import {
  Save, User, Building2, Bell, Shield, Users,
  Settings2, Tag, Trash2, Plus,
  Check, X, ArrowUp, ArrowDown, Edit2, Eye, EyeOff, KeyRound, Info, FileText, BookOpen, Activity, Send,
} from 'lucide-react'
import { DEFAULT_DIVISION_CUSTOM_FIELDS, DEFAULT_DIVISION_STAGES, DEFAULT_DIVISION_PRODUCTS, DEFAULT_DIVISION_TASK_STAGES } from '@/lib/mock-data'
import type { Role } from '@/types/database'
import { cn, getInitials } from '@/lib/utils'
import { isSupabaseConfigured } from '@/lib/db/client'
import { updateUserName, fetchAllUsers, createUserAdmin, updateUserAdmin, deleteUserAdmin, fetchUserDivisionIds } from '@/lib/db/users'
import {
  fetchPipelineStages, upsertPipelineStages,
  fetchPipelineTabs, createPipelineTab, updatePipelineTab, deletePipelineTab, upsertPipelineStagesForTab,
  migrateUntabbedStagesToTab,
  fetchDivisionCustomFields,
  createDivisionCustomField, updateDivisionCustomField, deleteDivisionCustomField,
  fetchDivisions, createDivision, updateDivision, deleteDivision, checkDivisionReferences,
} from '@/lib/db/divisions'
import {
  fetchDivisionProductsData, addDivisionProduct, removeDivisionProduct, saveDivisionProductsEnabled,
} from '@/lib/db/products'
import {
  fetchDivisionDocTypes, createDivisionDocType, updateDivisionDocType, deleteDivisionDocType,
} from '@/lib/db/documents'
import {
  fetchNotificationSettings, upsertNotificationSettings,
} from '@/lib/db/milestones'
import {
  fetchDivisionKnowledgeCategories, createDivisionKnowledgeCategory, deleteDivisionKnowledgeCategory,
} from '@/lib/db/knowledge'
import {
  fetchDivisionMemoCategories, createDivisionMemoCategory, deleteDivisionMemoCategory,
} from '@/lib/db/activities'
import type { DivisionDocType } from '@/types/database'
import type { User as UserType, Division } from '@/types/database'
// 通知設定（保存はlib/notif-settings、ヘッダーの通知ベルが参照する）
import { loadNotifSettings, saveNotifSettings, DEFAULT_NOTIF_SETTINGS as DEFAULT_NOTIF } from '@/lib/notif-settings'
import toast from 'react-hot-toast'

const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'システム管理者',
  manager:     'マネージャー',
  user:        'ユーザー',
}
const ROLE_COLORS: Record<Role, string> = {
  super_admin: 'bg-purple-100 text-purple-700',
  manager:     'bg-orange-100 text-orange-700',
  user:        'bg-gray-100 text-gray-600',
}
const FIELD_TYPE_LABEL: Record<string, string> = {
  text: 'テキスト', number: '数値', boolean: 'チェック', select: '選択',
}

function moveItem<T>(arr: T[], idx: number, dir: -1 | 1): T[] {
  const next = [...arr]; const target = idx + dir
  if (target < 0 || target >= next.length) return next
  ;[next[idx], next[target]] = [next[target], next[idx]]
  return next
}

// ─── メインページ ─────────────────────────────────────────────────
export default function SettingsPage() {
  const { currentUser, setCurrentUser, activeDivision, divisions } = useAppStore()
  const isSuperAdmin = currentUser?.role === 'super_admin'
  // Slack通知設定（022マイグレーションのRLS: division_notification_settings_select/_manage）は
  // super_adminと当該事業部のmanagerの両方を許可する設計だが、以前はUI側が
  // {isSuperAdmin && ...} ブロック内にしか置かれておらずmanagerが到達できなかった（修正6）。
  // managerは自分の所属事業部のみ設定できるようにする
  const isManager = currentUser?.role === 'manager'
  const userOwnDivisionIds = useAppStore((s) => s.userOwnDivisionIds)
  const managerDivisions = divisions.filter((d) => userOwnDivisionIds.includes(d.id))
  const [managerNotifDivId, setManagerNotifDivId] = useState(activeDivision?.id ?? managerDivisions[0]?.id ?? '')
  useEffect(() => {
    if (activeDivision?.id && userOwnDivisionIds.includes(activeDivision.id)) setManagerNotifDivId(activeDivision.id)
  }, [activeDivision?.id, userOwnDivisionIds])
  if (!managerNotifDivId && managerDivisions.length > 0) {
    setManagerNotifDivId(managerDivisions[0].id)
  }
  const managerNotifDivName = managerDivisions.find((d) => d.id === managerNotifDivId)?.name ?? ''

  const [name, setName] = useState(currentUser?.name ?? '')
  const [saving, setSaving] = useState(false)

  // マスタ管理（パイプライン・カスタム項目・商品・資料カテゴリ・ナレッジカテゴリ・
  // タスクカンバン）の対象事業部。各パネルで個別に選ぶのではなく、ここで一括して切り替える。
  // 先頭固定にすると「M&A事業部で作業中なのにITのステージを編集してしまう」事故が起きるため、
  // ユーザーが手動で選ぶまでは閲覧中の事業部に追従させる
  // （activeDivision はストア復元・DB取得の順序次第でマウント後に確定するため、初期値だけでは不十分）
  const [masterDivId, setMasterDivId] = useState(activeDivision?.id ?? divisions[0]?.id ?? '')
  const [masterDivTouched, setMasterDivTouched] = useState(false)
  useEffect(() => {
    if (!masterDivTouched && activeDivision?.id) setMasterDivId(activeDivision.id)
  }, [activeDivision?.id, masterDivTouched])
  // 事業部一覧が未取得だった場合、取得後に先頭を仮選択する（activeDivision確定時に上のeffectが上書きする）
  if (!masterDivId && divisions.length > 0) {
    setMasterDivId(divisions[0].id)
  }
  const masterDivName = divisions.find((d) => d.id === masterDivId)?.name ?? ''

  // 通知設定
  const [notif, setNotif] = useState(loadNotifSettings)
  const toggleNotif = (key: keyof typeof DEFAULT_NOTIF) => {
    const next = { ...notif, [key]: !notif[key] }
    setNotif(next)
    saveNotifSettings(next)
    toast.success('通知設定を保存しました')
  }

  const handleSave = async () => {
    if (!name.trim()) { toast.error('氏名を入力してください'); return }
    setSaving(true)
    try {
      if (isSupabaseConfigured() && currentUser) {
        await updateUserName(currentUser.id, name.trim())
      }
      setCurrentUser({ ...currentUser!, name: name.trim() })
      toast.success('プロフィールを保存しました')
    } catch {
      toast.error('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-800">設定</h1>
        {isSuperAdmin && (
          <p className="text-sm text-purple-600 font-medium mt-0.5 flex items-center gap-1.5">
            <Shield size={13} />
            システム管理者としてログイン中
          </p>
        )}
      </div>

      {/* ─── プロフィール ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 font-bold text-gray-700">
            <User size={18} />プロフィール
          </div>
        </CardHeader>
        <CardBody>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">氏名</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50" />
              <p className="text-xs text-gray-400 mt-1">変更後は「保存」を押してください</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
              <input type="email" defaultValue={currentUser?.email ?? ''} disabled
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">権限</label>
              <span className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium', ROLE_COLORS[currentUser?.role ?? 'user'])}>
                {currentUser?.role === 'super_admin' && <Shield size={13} />}
                {ROLE_LABELS[currentUser?.role ?? 'user']}
              </span>
            </div>
            <Button loading={saving} onClick={handleSave} icon={<Save size={14} />}>保存</Button>
          </div>
        </CardBody>
      </Card>

      {/* ─── 所属事業部 ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 font-bold text-gray-700">
            <Building2 size={18} />所属事業部
          </div>
        </CardHeader>
        <CardBody>
          <div className="space-y-2">
            {divisions.map((d) => (
              <div key={d.id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color_code ?? '#6b7280' }} />
                  <span className="text-sm text-gray-700">{d.name}</span>
                </div>
                {activeDivision?.id === d.id && (
                  <span className="text-xs font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">アクティブ</span>
                )}
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* ─── 通知設定 ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 font-bold text-gray-700">
            <Bell size={18} />通知設定
          </div>
        </CardHeader>
        <CardBody>
          <div className="space-y-3">
            <p className="text-xs text-gray-400">ヘッダーの通知ベルに表示する種類を選べます（このブラウザにのみ適用）</p>
            {([
              { key: 'tossup',       label: 'トスアップを受信したとき' },
              { key: 'dealStage',    label: '商談フェーズが変更されたとき' },
              // 以下2種は通知の発生元が未実装。ONにしても何も起きない「飾りのトグル」に
              // ならないよう、準備中として無効化しておく
              { key: 'taskDue',      label: 'タスクの期限が近づいたとき', disabled: true },
              { key: 'teamActivity', label: 'チームメンバーの活動更新',   disabled: true },
            ] as { key: keyof typeof DEFAULT_NOTIF; label: string; disabled?: boolean }[]).map(({ key, label, disabled }) => (
              <div key={key} className="flex items-center justify-between">
                <span className={cn('text-sm', disabled ? 'text-gray-400' : 'text-gray-700')}>
                  {label}
                  {disabled && <span className="ml-2 text-[10px] font-medium text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">準備中</span>}
                </span>
                <button
                  onClick={() => toggleNotif(key)}
                  disabled={disabled}
                  aria-pressed={notif[key]}
                  aria-label={label}
                  className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                    disabled ? 'cursor-not-allowed opacity-40' : '',
                    notif[key] ? 'bg-orange-500' : 'bg-gray-200')}
                >
                  {/* 表示は保存値と一致させる（準備中でも保存値がONならON位置。見た目と実際の設定のズレを作らない） */}
                  <span className={cn('inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                    notif[key] ? 'translate-x-5' : 'translate-x-0.5')} />
                </button>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* ─── 管理者専用 ─── */}
      {isSuperAdmin && (
        <>
          <div className="flex items-center gap-2 pt-2">
            <div className="flex-1 h-px bg-purple-100" />
            <span className="text-xs font-bold text-purple-500 uppercase tracking-widest flex items-center gap-1.5">
              <Shield size={11} />管理者設定
            </span>
            <div className="flex-1 h-px bg-purple-100" />
          </div>

          <AccountsPanel />
          <DivisionsPanel />

          {/* ─── マスタ管理の対象事業部（以下のパネル共通） ─── */}
          <Card className="border-orange-200 ring-1 ring-orange-100">
            <CardHeader>
              <div className="flex items-center gap-2 font-bold text-gray-700">
                <Building2 size={18} className="text-orange-500" />マスタ管理の対象事業部
              </div>
            </CardHeader>
            <CardBody>
              <p className="text-xs text-gray-500 mb-3">
                ここで選んだ事業部に対して、以下のマスタ設定
                （パイプラインステージ・カスタム項目・商品・資料カテゴリ・ナレッジカテゴリ・タスクカンバン）
                をまとめて編集します。
              </p>
              <select
                value={masterDivId}
                onChange={(e) => { setMasterDivId(e.target.value); setMasterDivTouched(true) }}
                aria-label="マスタ管理の対象事業部"
                className="w-full px-3 py-2.5 text-sm font-bold text-gray-700 border-2 border-orange-200 rounded-lg
                  focus:outline-none focus:ring-2 focus:ring-orange-500 bg-orange-50/50 cursor-pointer"
              >
                {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </CardBody>
          </Card>

          {/* 対象事業部が変わったらパネルの内部状態（編集途中のフォーム等）ごと作り直す */}
          <DivisionStagesPanel key={`stages-${masterDivId}`} divisionId={masterDivId} divisionName={masterDivName} />
          <DivisionFieldsPanel key={`fields-${masterDivId}`} divisionId={masterDivId} divisionName={masterDivName} />
          <ProductsPanel key={`products-${masterDivId}`} divisionId={masterDivId} divisionName={masterDivName} />
          <DocTypesPanel key={`doctypes-${masterDivId}`} divisionId={masterDivId} divisionName={masterDivName} />
          <KnowledgeCategoriesPanel key={`knowledge-${masterDivId}`} divisionId={masterDivId} divisionName={masterDivName} />
          <MemoCategoriesPanel key={`memo-${masterDivId}`} divisionId={masterDivId} divisionName={masterDivName} />
          <TaskStagesPanel key={`tasks-${masterDivId}`} divisionId={masterDivId} divisionName={masterDivName} />
          <NotificationSettingsPanel key={`notif-${masterDivId}`} divisionId={masterDivId} divisionName={masterDivName} />
        </>
      )}

      {/* ─── マネージャー設定（Slack通知のみ。修正6） ───
          division_notification_settings_manage RLSはsuper_adminと当該事業部のmanagerの
          両方を許可しているが、以前はUIがsuper_admin専用ブロックの中にしかなく
          managerが到達できなかった。managerは自分の所属事業部のみ設定できるようにする */}
      {isManager && !isSuperAdmin && managerDivisions.length > 0 && (
        <>
          <div className="flex items-center gap-2 pt-2">
            <div className="flex-1 h-px bg-orange-100" />
            <span className="text-xs font-bold text-orange-500 uppercase tracking-widest flex items-center gap-1.5">
              <Send size={11} />マネージャー設定
            </span>
            <div className="flex-1 h-px bg-orange-100" />
          </div>

          {managerDivisions.length > 1 && (
            <Card className="border-orange-200 ring-1 ring-orange-100">
              <CardHeader>
                <div className="flex items-center gap-2 font-bold text-gray-700">
                  <Building2 size={18} className="text-orange-500" />対象事業部
                </div>
              </CardHeader>
              <CardBody>
                <p className="text-xs text-gray-500 mb-3">
                  Slack通知設定を編集する事業部を選んでください（あなたが所属する事業部のみ選択できます）。
                </p>
                <select
                  value={managerNotifDivId}
                  onChange={(e) => setManagerNotifDivId(e.target.value)}
                  aria-label="Slack通知設定の対象事業部"
                  className="w-full px-3 py-2.5 text-sm font-bold text-gray-700 border-2 border-orange-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-orange-500 bg-orange-50/50 cursor-pointer"
                >
                  {managerDivisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </CardBody>
            </Card>
          )}

          {managerNotifDivId && (
            <NotificationSettingsPanel
              key={`notif-mgr-${managerNotifDivId}`}
              divisionId={managerNotifDivId}
              divisionName={managerNotifDivName}
            />
          )}
        </>
      )}
    </div>
  )
}

// マスタ管理パネル共通のprops（対象事業部はページ上部のセレクタで一括選択）
interface MasterPanelProps {
  divisionId: string
  divisionName: string
}

// ─── アカウント管理 ───────────────────────────────────────────────
const EMPTY_CREATE = { name: '', email: '', password: '', role: 'user' as Role, divisionIds: [] as string[] }
const EMPTY_EDIT   = { name: '', role: 'user' as Role, divisionIds: [] as string[] }
const EMPTY_PW     = ''

function PwInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'パスワード'}
        autoComplete="new-password"
        className="w-full px-2.5 py-1.5 pr-8 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
      />
      <button type="button" onClick={() => setShow((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
        {show ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  )
}

function AccountsPanel() {
  const { currentUser, divisions } = useAppStore()
  const [users,       setUsers]       = useState<UserType[]>([])
  const [loading,     setLoading]     = useState(false)
  const [showCreate,  setShowCreate]  = useState(false)
  const [createForm,  setCreateForm]  = useState(EMPTY_CREATE)
  const [saving,      setSaving]      = useState(false)
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [editForm,    setEditForm]    = useState(EMPTY_EDIT)
  const [pwResetId,   setPwResetId]   = useState<string | null>(null)
  const [newPw,       setNewPw]       = useState(EMPTY_PW)

  const reload = () => {
    if (!isSupabaseConfigured()) return
    setLoading(true)
    fetchAllUsers().then(setUsers).finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, []) // eslint-disable-line

  const handleCreate = async () => {
    if (!createForm.name.trim()) { toast.error('氏名を入力してください'); return }
    if (!createForm.email.trim()) { toast.error('メールアドレスを入力してください'); return }
    if (createForm.password.length < 6) { toast.error('パスワードは6文字以上で入力してください'); return }
    setSaving(true)
    try {
      await createUserAdmin(createForm)
      toast.success(`${createForm.name} を追加しました`)
      setCreateForm(EMPTY_CREATE)
      setShowCreate(false)
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally { setSaving(false) }
  }

  const handleEdit = async (id: string) => {
    if (!editForm.name.trim()) { toast.error('氏名を入力してください'); return }
    setSaving(true)
    try {
      await updateUserAdmin(id, { name: editForm.name.trim(), role: editForm.role, divisionIds: editForm.divisionIds })
      toast.success('更新しました')
      setEditingId(null)
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally { setSaving(false) }
  }

  const openEdit = async (user: UserType) => {
    const divIds = await fetchUserDivisionIds(user.id)
    setEditingId(user.id)
    setEditForm({ name: user.name, role: user.role as Role, divisionIds: divIds })
    setPwResetId(null)
  }

  const toggleDivision = (form: typeof EMPTY_EDIT, divId: string) =>
    form.divisionIds.includes(divId)
      ? form.divisionIds.filter((id) => id !== divId)
      : [...form.divisionIds, divId]

  const handlePwReset = async (id: string) => {
    if (newPw.length < 6) { toast.error('パスワードは6文字以上で入力してください'); return }
    setSaving(true)
    try {
      await updateUserAdmin(id, { password: newPw })
      toast.success('パスワードを変更しました')
      setPwResetId(null)
      setNewPw(EMPTY_PW)
    } catch (e) {
      toast.error((e as Error).message)
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`「${name}」を削除しますか？\nこの操作は元に戻せません。`)) return
    setSaving(true)
    try {
      await deleteUserAdmin(id)
      toast.success(`${name} を削除しました`)
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally { setSaving(false) }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-gray-700">
            <Users size={18} />アカウント管理
          </div>
          {isSupabaseConfigured() && (
            <Button size="sm" icon={<Plus size={14} />} onClick={() => { setShowCreate((v) => !v); setEditingId(null); setPwResetId(null) }}>
              ユーザーを追加
            </Button>
          )}
        </div>
      </CardHeader>
      <CardBody>
        {/* ─── 新規作成フォーム ─── */}
        {showCreate && (
          <div className="mb-4 p-4 bg-orange-50 rounded-xl border border-orange-100 space-y-3">
            <p className="text-xs font-bold text-gray-600">新しいユーザーを追加</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">氏名 <span className="text-red-500">*</span></label>
                <input type="text" value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="田中 太郎"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">メールアドレス <span className="text-red-500">*</span></label>
                <input type="email" value={createForm.email} onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="taro@example.com"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">パスワード <span className="text-red-500">*</span></label>
                <PwInput value={createForm.password} onChange={(v) => setCreateForm((f) => ({ ...f, password: v }))} placeholder="6文字以上" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">権限</label>
                <select value={createForm.role} onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as Role }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white">
                  <option value="user">ユーザー</option>
                  <option value="manager">マネージャー</option>
                  <option value="super_admin">システム管理者</option>
                </select>
              </div>
            </div>
            {createForm.role !== 'super_admin' && divisions.length > 0 && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">所属事業部</label>
                <div className="flex flex-wrap gap-3">
                  {divisions.map((div) => (
                    <label key={div.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createForm.divisionIds.includes(div.id)}
                        onChange={() => setCreateForm((f) => ({ ...f, divisionIds: toggleDivision(f, div.id) }))}
                        className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                      />
                      <span className="text-gray-700">{div.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2 items-center">
              <div className="flex items-start gap-1.5 flex-1 text-xs text-gray-400">
                <Info size={12} className="flex-shrink-0 mt-0.5" />
                <span>パスワードは本人に共有してください。後からリセット可能です。</span>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setShowCreate(false)}>キャンセル</Button>
              <Button size="sm" loading={saving} onClick={handleCreate} icon={<Check size={13} />}>追加</Button>
            </div>
          </div>
        )}

        {/* ─── ユーザーリスト ─── */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">ユーザーが見つかりません</p>
        ) : (
          <div className="space-y-2">
            {users.map((user) => {
              const isMe = user.id === currentUser?.id
              return (
                <div key={user.id} className="border border-gray-100 rounded-xl overflow-hidden">
                  {/* 通常表示 */}
                  {editingId !== user.id && (
                    <div className="flex items-center gap-3 p-3">
                      <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-sm flex-shrink-0">
                        {getInitials(user.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-700">
                          {user.name}
                          {isMe && <span className="ml-1.5 text-xs text-orange-500 font-normal">（あなた）</span>}
                        </p>
                        <p className="text-xs text-gray-400 truncate">{user.email}</p>
                      </div>
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0', ROLE_COLORS[user.role as Role])}>
                        {ROLE_LABELS[user.role as Role] ?? user.role}
                      </span>
                      {!isMe && isSupabaseConfigured() && (
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            onClick={() => { setPwResetId(pwResetId === user.id ? null : user.id); setNewPw(''); setEditingId(null) }}
                            className="p-1.5 text-gray-300 hover:text-blue-500 rounded-lg transition-colors" title="パスワードをリセット">
                            <KeyRound size={13} />
                          </button>
                          <button
                            onClick={() => openEdit(user)}
                            className="p-1.5 text-gray-300 hover:text-orange-500 rounded-lg transition-colors" title="編集">
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => handleDelete(user.id, user.name)}
                            className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg transition-colors" title="削除">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* パスワードリセットパネル */}
                  {pwResetId === user.id && (
                    <div className="px-3 pb-3 pt-0 bg-blue-50 border-t border-blue-100 space-y-2">
                      <p className="text-xs font-medium text-blue-700 pt-2">パスワードをリセット — {user.name}</p>
                      <div className="flex gap-2 items-center">
                        <div className="flex-1">
                          <PwInput value={newPw} onChange={setNewPw} placeholder="新しいパスワード（6文字以上）" />
                        </div>
                        <button onClick={() => { setPwResetId(null); setNewPw('') }}
                          className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white">
                          <X size={13} />
                        </button>
                        <button onClick={() => handlePwReset(user.id)} disabled={saving}
                          className="flex items-center gap-1 text-xs text-white bg-blue-500 hover:bg-blue-600 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50">
                          <Check size={12} />変更
                        </button>
                      </div>
                    </div>
                  )}

                  {/* インライン編集 */}
                  {editingId === user.id && (
                    <div className="p-3 bg-orange-50 border-t border-orange-100 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-500 mb-0.5">氏名</label>
                          <input type="text" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                            className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-0.5">権限</label>
                          <select value={editForm.role} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as Role }))}
                            className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white">
                            <option value="user">ユーザー</option>
                            <option value="manager">マネージャー</option>
                            <option value="super_admin">システム管理者</option>
                          </select>
                        </div>
                      </div>
                      {editForm.role !== 'super_admin' && divisions.length > 0 && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">所属事業部</label>
                          <div className="flex flex-wrap gap-3">
                            {divisions.map((div) => (
                              <label key={div.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={editForm.divisionIds.includes(div.id)}
                                  onChange={() => setEditForm((f) => ({ ...f, divisionIds: toggleDivision(f, div.id) }))}
                                  className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                                />
                                <span className="text-gray-700">{div.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setEditingId(null)}
                          className="flex items-center gap-1 text-xs text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-100">
                          <X size={11} />キャンセル
                        </button>
                        <button onClick={() => handleEdit(user.id)} disabled={saving}
                          className="flex items-center gap-1 text-xs text-white bg-orange-500 px-2.5 py-1.5 rounded-lg hover:bg-orange-600 font-medium disabled:opacity-50">
                          <Check size={11} />保存
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ─── 事業部管理 ───────────────────────────────────────────────────
const EMPTY_DIVISION_CREATE = { name: '', colorCode: '#6b7280' }
const EMPTY_DIVISION_EDIT   = { name: '', colorCode: '#6b7280' }

function DivisionsPanel() {
  const { divisions, setDivisions } = useAppStore()
  const [list,        setList]        = useState<Division[]>(divisions)
  const [loading,     setLoading]     = useState(false)
  const [showCreate,  setShowCreate]  = useState(false)
  const [createForm,  setCreateForm]  = useState(EMPTY_DIVISION_CREATE)
  const [saving,      setSaving]      = useState(false)
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [editForm,    setEditForm]    = useState(EMPTY_DIVISION_EDIT)

  const reload = () => {
    if (!isSupabaseConfigured()) { setList(divisions); return }
    setLoading(true)
    fetchDivisions()
      .then((next) => { setList(next); setDivisions(next) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, []) // eslint-disable-line

  const handleCreate = async () => {
    if (!createForm.name.trim()) { toast.error('事業部名を入力してください'); return }
    setSaving(true)
    try {
      await createDivision({ name: createForm.name.trim(), colorCode: createForm.colorCode })
      toast.success(`${createForm.name.trim()} を追加しました`)
      setCreateForm(EMPTY_DIVISION_CREATE)
      setShowCreate(false)
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally { setSaving(false) }
  }

  const openEdit = (division: Division) => {
    setEditingId(division.id)
    setEditForm({ name: division.name, colorCode: division.color_code ?? '#6b7280' })
    setShowCreate(false)
  }

  const handleEdit = async (id: string) => {
    if (!editForm.name.trim()) { toast.error('事業部名を入力してください'); return }
    setSaving(true)
    try {
      await updateDivision(id, { name: editForm.name.trim(), colorCode: editForm.colorCode })
      toast.success('更新しました')
      setEditingId(null)
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally { setSaving(false) }
  }

  const handleDelete = async (division: Division) => {
    setSaving(true)
    try {
      const refs = await checkDivisionReferences(division.id)
      if (!refs.deletable) {
        const parts: string[] = []
        if (refs.contacts > 0) parts.push(`顧客${refs.contacts}件`)
        if (refs.deals > 0) parts.push(`商談${refs.deals}件`)
        if (refs.tossups > 0) parts.push(`トスアップ${refs.tossups}件`)
        toast.error(`この事業部には${parts.join('・')}が紐づいているため削除できません`)
        return
      }
      if (!window.confirm(`「${division.name}」を削除しますか？\nこの操作は元に戻せません。関連するパイプラインステージ・カスタムフィールドも削除されます。`)) return
      await deleteDivision(division.id)
      toast.success(`${division.name} を削除しました`)
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally { setSaving(false) }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-gray-700">
            <Building2 size={18} />事業部管理
          </div>
          {isSupabaseConfigured() && (
            <Button size="sm" icon={<Plus size={14} />} onClick={() => { setShowCreate((v) => !v); setEditingId(null) }}>
              事業部を追加
            </Button>
          )}
        </div>
      </CardHeader>
      <CardBody>
        {/* ─── 新規作成フォーム ─── */}
        {showCreate && (
          <div className="mb-4 p-4 bg-orange-50 rounded-xl border border-orange-100 space-y-3">
            <p className="text-xs font-bold text-gray-600">新しい事業部を追加</p>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-0.5">事業部名 <span className="text-red-500">*</span></label>
                <input type="text" value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="例：ITソリューション事業部"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">カラー</label>
                <input type="color" value={createForm.colorCode} onChange={(e) => setCreateForm((f) => ({ ...f, colorCode: e.target.value }))}
                  className="w-10 h-8 border border-gray-200 rounded-lg cursor-pointer bg-white" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="secondary" onClick={() => setShowCreate(false)}>キャンセル</Button>
              <Button size="sm" loading={saving} onClick={handleCreate} icon={<Check size={13} />}>追加</Button>
            </div>
          </div>
        )}

        {/* ─── 事業部リスト ─── */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : list.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">事業部が見つかりません</p>
        ) : (
          <div className="space-y-2">
            {list.map((division) => (
              <div key={division.id} className="border border-gray-100 rounded-xl overflow-hidden">
                {editingId !== division.id ? (
                  <div className="flex items-center gap-3 p-3">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: division.color_code ?? '#6b7280' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700">{division.name}</p>
                    </div>
                    {isSupabaseConfigured() && (
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          onClick={() => openEdit(division)}
                          className="p-1.5 text-gray-300 hover:text-orange-500 rounded-lg transition-colors" title="編集">
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(division)}
                          disabled={saving}
                          className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg transition-colors disabled:opacity-50" title="削除">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-orange-50 border-t border-orange-100 space-y-2">
                    <div className="flex gap-3 items-end">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-0.5">事業部名</label>
                        <input type="text" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">カラー</label>
                        <input type="color" value={editForm.colorCode} onChange={(e) => setEditForm((f) => ({ ...f, colorCode: e.target.value }))}
                          className="w-10 h-8 border border-gray-200 rounded-lg cursor-pointer bg-white" />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingId(null)}
                        className="flex items-center gap-1 text-xs text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-100">
                        <X size={11} />キャンセル
                      </button>
                      <button onClick={() => handleEdit(division.id)} disabled={saving}
                        className="flex items-center gap-1 text-xs text-white bg-orange-500 px-2.5 py-1.5 rounded-lg hover:bg-orange-600 font-medium disabled:opacity-50">
                        <Check size={11} />保存
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ─── 事業部別パイプラインステージ ────────────────────────────────
function DivisionStagesPanel({ divisionId, divisionName }: MasterPanelProps) {
  const { divisionStages, setDivisionStages, setDivisionTabs } = useAppStore()
  const selectedDivId = divisionId
  const [stages, setStages] = useState<DivisionStage[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [newStage, setNewStage] = useState({ name: '', isWon: false, isLost: false })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', isWon: false, isLost: false })

  // パイプラインタブ（任意、事業部ごとにカンバンを複数系統に分ける機能）
  const [tabs, setTabs] = useState<PipelineTab[]>([])
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null)
  const [showTabForm, setShowTabForm] = useState(false)
  const [newTabName, setNewTabName] = useState('')
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editTabName, setEditTabName] = useState('')
  const [tabSaving, setTabSaving] = useState(false)

  const visibleStages = tabs.length > 0 ? stages.filter((s) => s.tabId === selectedTabId) : stages

  // 選択事業部が変わったらステージを読み込む
  useEffect(() => {
    if (!selectedDivId) return
    if (isSupabaseConfigured()) {
      setLoading(true)
      fetchPipelineStages(selectedDivId).then((raw) => {
        const mapped: DivisionStage[] = (raw as { id: string; name: string; sort_order: number; is_won: boolean; is_lost: boolean; tab_id: string | null }[]).map((s) => ({
          id: s.id, name: s.name, sortOrder: s.sort_order, isWon: s.is_won, isLost: s.is_lost, tabId: s.tab_id ?? null,
        }))
        setStages(mapped)
        setDivisionStages(selectedDivId, mapped)
      }).finally(() => setLoading(false))
    } else {
      setStages(divisionStages[selectedDivId] ?? DEFAULT_DIVISION_STAGES[selectedDivId] ?? [])
    }
    setShowForm(false)
    setEditingId(null)
  }, [selectedDivId]) // eslint-disable-line

  // 選択事業部が変わったらタブを読み込む（デモモードはM&A等の新規タブ対象外＝常に空）
  useEffect(() => {
    if (!selectedDivId) return
    if (isSupabaseConfigured()) {
      fetchPipelineTabs(selectedDivId).then((raw) => {
        const mapped: PipelineTab[] = (raw as { id: string; division_id: string; name: string; sort_order: number }[]).map((r) => ({
          id: r.id, divisionId: r.division_id, name: r.name, sortOrder: r.sort_order,
        }))
        setTabs(mapped)
        setDivisionTabs(selectedDivId, mapped)
        setSelectedTabId(mapped[0]?.id ?? null)
      })
    } else {
      setTabs([])
      setSelectedTabId(null)
    }
    setShowTabForm(false)
    setEditingTabId(null)
  }, [selectedDivId]) // eslint-disable-line

  const reloadTabs = async () => {
    const raw = await fetchPipelineTabs(selectedDivId) as { id: string; division_id: string; name: string; sort_order: number }[]
    const mapped: PipelineTab[] = raw.map((r) => ({ id: r.id, divisionId: r.division_id, name: r.name, sortOrder: r.sort_order }))
    setTabs(mapped)
    setDivisionTabs(selectedDivId, mapped)
    return mapped
  }

  const handleAddTab = async () => {
    if (!newTabName.trim()) { toast.error('タブ名を入力してください'); return }
    const isFirstTab = tabs.length === 0
    setTabSaving(true)
    try {
      const newTabId = await createPipelineTab(selectedDivId, newTabName.trim(), tabs.length)
      if (isFirstTab) {
        // その事業部にとって最初のタブを作る場合のみ：既存の tab_id=NULL なステージ
        // （＝既存商談が stage_id で参照中）を新タブへ一括で付け替える。
        // ステージのUUIDは維持されるため deals.stage_id は壊れず、Kanban/DealModalから
        // 見えなくなる「孤児」ステージは発生しない。2つ目以降のタブ追加では
        // 未タブ化ステージは既に解消済みのはずなので実行しない。
        await migrateUntabbedStagesToTab(selectedDivId, newTabId)
        const raw = await fetchPipelineStages(selectedDivId) as { id: string; name: string; sort_order: number; is_won: boolean; is_lost: boolean; tab_id: string | null }[]
        const refreshed: DivisionStage[] = raw.map((s) => ({ id: s.id, name: s.name, sortOrder: s.sort_order, isWon: s.is_won, isLost: s.is_lost, tabId: s.tab_id ?? null }))
        setStages(refreshed)
        setDivisionStages(selectedDivId, refreshed)
      }
      await reloadTabs()
      setSelectedTabId(newTabId)
      toast.success(`タブ「${newTabName.trim()}」を追加しました`)
      setNewTabName('')
      setShowTabForm(false)
    } catch (e) {
      toast.error((e as Error).message ?? 'タブの追加に失敗しました')
    } finally {
      setTabSaving(false)
    }
  }

  const handleEditTab = async (id: string) => {
    if (!editTabName.trim()) { toast.error('タブ名を入力してください'); return }
    setTabSaving(true)
    try {
      await updatePipelineTab(id, { name: editTabName.trim() })
      await reloadTabs()
      setEditingTabId(null)
      toast.success('タブを更新しました')
    } catch (e) {
      toast.error((e as Error).message ?? 'タブの更新に失敗しました')
    } finally {
      setTabSaving(false)
    }
  }

  const handleDeleteTab = async (id: string, name: string) => {
    if (!window.confirm(`「${name}」タブを削除しますか？`)) return
    setTabSaving(true)
    try {
      await deletePipelineTab(id)
      const mapped = await reloadTabs()
      if (selectedTabId === id) setSelectedTabId(mapped[0]?.id ?? null)
      toast.success('タブを削除しました')
    } catch {
      toast.error('このタブにはステージが設定されているため削除できません。先にステージを削除してください。')
    } finally {
      setTabSaving(false)
    }
  }

  const handleMoveTab = (idx: number, dir: -1 | 1) => {
    const reordered = moveItem(tabs, idx, dir).map((t, i) => ({ ...t, sortOrder: i }))
    setTabs(reordered)
    setDivisionTabs(selectedDivId, reordered)
    if (isSupabaseConfigured()) {
      for (const t of reordered) {
        updatePipelineTab(t.id, { sortOrder: t.sortOrder }).catch(() => {})
      }
    }
  }

  const saveToDb = async (next: DivisionStage[]) => {
    setSaving(true)
    try {
      if (isSupabaseConfigured()) {
        if (tabs.length > 0 && selectedTabId) {
          await upsertPipelineStagesForTab(selectedDivId, selectedTabId, next.map((s, i) => ({
            name: s.name, sort_order: i, is_won: s.isWon, is_lost: s.isLost,
          })))
        } else {
          await upsertPipelineStages(selectedDivId, next.map((s, i) => ({
            name: s.name, sort_order: i, is_won: s.isWon, is_lost: s.isLost,
          })))
        }
        // DBから再取得してIDを更新
        const raw = await fetchPipelineStages(selectedDivId) as { id: string; name: string; sort_order: number; is_won: boolean; is_lost: boolean; tab_id: string | null }[]
        const refreshed: DivisionStage[] = raw.map((s) => ({ id: s.id, name: s.name, sortOrder: s.sort_order, isWon: s.is_won, isLost: s.is_lost, tabId: s.tab_id ?? null }))
        setStages(refreshed)
        setDivisionStages(selectedDivId, refreshed)
      } else {
        const withOrder = next.map((s, i) => ({ ...s, sortOrder: i }))
        setStages(withOrder)
        setDivisionStages(selectedDivId, withOrder)
      }
    } catch {
      toast.error('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = async () => {
    if (!newStage.name.trim()) { toast.error('ステージ名を入力してください'); return }
    const next = [...visibleStages, {
      id: `ds-${Date.now()}`, name: newStage.name.trim(), sortOrder: visibleStages.length,
      isWon: newStage.isWon, isLost: newStage.isLost, tabId: tabs.length > 0 ? selectedTabId : null,
    }]
    await saveToDb(next)
    toast.success(`ステージ「${newStage.name}」を追加しました`)
    setNewStage({ name: '', isWon: false, isLost: false })
    setShowForm(false)
  }

  const handleEdit = async (id: string) => {
    if (!editForm.name.trim()) { toast.error('ステージ名を入力してください'); return }
    const next = visibleStages.map((s) => s.id === id ? { ...s, ...editForm, name: editForm.name.trim() } : s)
    await saveToDb(next)
    setEditingId(null)
    toast.success('ステージを更新しました')
  }

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`「${name}」を削除しますか？`)) return
    await saveToDb(visibleStages.filter((s) => s.id !== id))
    toast.success('ステージを削除しました')
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-gray-700"><Settings2 size={18} />パイプラインステージ（{divisionName}）</div>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => { setShowForm((v) => !v); setEditingId(null) }}>ステージ追加</Button>
        </div>
      </CardHeader>
      <CardBody>
        <p className="text-xs text-gray-500 mb-3">商談カンバンの列（フェーズ）を設定します。「受注」「失注」として扱う列もここで指定できます。</p>

        {/* ─── パイプラインタブ（任意） ─── */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">パイプラインタブ（任意）</label>
          {tabs.length === 0 ? (
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
              <p className="text-xs text-gray-400 mb-2">このアイテムにタブは設定されていません。タブを使うとカンバンを複数の系統（例: 売主／買主）に分けて表示できます。</p>
              {!showTabForm ? (
                <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setShowTabForm(true)}>タブを追加</Button>
              ) : (
                <div className="flex gap-2 items-center">
                  <input type="text" value={newTabName} onChange={(e) => setNewTabName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddTab()}
                    placeholder="タブ名（例: 売主）"
                    className="flex-1 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
                  <button onClick={() => setShowTabForm(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white"><X size={13} /></button>
                  <button onClick={handleAddTab} disabled={tabSaving}
                    className="flex items-center gap-1 text-xs text-white bg-orange-500 px-3 py-1.5 rounded-lg hover:bg-orange-600 font-medium disabled:opacity-50">
                    <Check size={12} />追加
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 items-center">
                {tabs.map((t, i) => (
                  <div key={t.id} className="flex items-center gap-1 bg-gray-50 border border-gray-100 rounded-full pl-2 pr-1 py-1">
                    {editingTabId === t.id ? (
                      <>
                        <input type="text" value={editTabName} onChange={(e) => setEditTabName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleEditTab(t.id)}
                          className="w-24 px-1.5 py-0.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-orange-500 bg-white" />
                        <button onClick={() => setEditingTabId(null)} className="p-1 text-gray-300 hover:text-gray-500"><X size={11} /></button>
                        <button onClick={() => handleEditTab(t.id)} className="p-1 text-orange-500 hover:text-orange-600"><Check size={11} /></button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => handleMoveTab(i, -1)} disabled={i === 0}
                          className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20"><ArrowUp size={11} /></button>
                        <button onClick={() => handleMoveTab(i, 1)} disabled={i === tabs.length - 1}
                          className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20"><ArrowDown size={11} /></button>
                        <span className="text-xs font-medium text-gray-700 px-0.5">{t.name}</span>
                        <button onClick={() => { setEditingTabId(t.id); setEditTabName(t.name) }} className="p-1 text-gray-300 hover:text-orange-500"><Edit2 size={11} /></button>
                        <button onClick={() => handleDeleteTab(t.id, t.name)} className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={11} /></button>
                      </>
                    )}
                  </div>
                ))}
                {!showTabForm ? (
                  <button onClick={() => setShowTabForm(true)}
                    className="flex items-center gap-1 text-xs text-gray-500 border border-dashed border-gray-300 rounded-full px-3 py-1.5 hover:border-orange-400 hover:text-orange-500">
                    <Plus size={12} />タブを追加
                  </button>
                ) : (
                  <div className="flex gap-2 items-center">
                    <input type="text" value={newTabName} onChange={(e) => setNewTabName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddTab()}
                      placeholder="タブ名"
                      className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
                    <button onClick={() => setShowTabForm(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white"><X size={13} /></button>
                    <button onClick={handleAddTab} disabled={tabSaving}
                      className="flex items-center gap-1 text-xs text-white bg-orange-500 px-3 py-1.5 rounded-lg hover:bg-orange-600 font-medium disabled:opacity-50">
                      <Check size={12} />追加
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">表示するタブ（下のステージ一覧の対象）</label>
                <select value={selectedTabId ?? ''} onChange={(e) => setSelectedTabId(e.target.value || null)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50">
                  {tabs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        {showForm && (
          <div className="mb-4 p-3 bg-orange-50 rounded-xl border border-orange-100 space-y-3">
            <input type="text" value={newStage.name} onChange={(e) => setNewStage((s) => ({ ...s, name: e.target.value }))}
              placeholder="ステージ名"
              className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={newStage.isWon}
                  onChange={(e) => setNewStage((s) => ({ ...s, isWon: e.target.checked, isLost: false }))} className="w-4 h-4 accent-green-500" />
                受注ステージ
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={newStage.isLost}
                  onChange={(e) => setNewStage((s) => ({ ...s, isLost: e.target.checked, isWon: false }))} className="w-4 h-4 accent-red-400" />
                失注ステージ
              </label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>キャンセル</Button>
              <Button size="sm" loading={saving} onClick={handleAdd} icon={<Check size={13} />}>追加</Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-1">
            {visibleStages.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">ステージが未設定です</p>
            ) : visibleStages.map((s, i) => (
              <div key={s.id} className="border border-gray-100 rounded-xl overflow-hidden">
                {editingId === s.id ? (
                  <div className="p-3 bg-orange-50 space-y-2">
                    <input type="text" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer text-xs">
                        <input type="checkbox" checked={editForm.isWon}
                          onChange={(e) => setEditForm((f) => ({ ...f, isWon: e.target.checked, isLost: false }))} className="w-3.5 h-3.5 accent-green-500" />受注
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-xs">
                        <input type="checkbox" checked={editForm.isLost}
                          onChange={(e) => setEditForm((f) => ({ ...f, isLost: e.target.checked, isWon: false }))} className="w-3.5 h-3.5 accent-red-400" />失注
                      </label>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingId(null)} className="flex items-center gap-1 text-xs text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-100"><X size={11} />キャンセル</button>
                      <button onClick={() => handleEdit(s.id)} className="flex items-center gap-1 text-xs text-white bg-orange-500 px-2.5 py-1.5 rounded-lg hover:bg-orange-600 font-medium">
                        <Check size={11} />保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <div className="flex flex-col gap-0.5 flex-shrink-0">
                      <button onClick={() => saveToDb(moveItem(visibleStages, i, -1))} disabled={i === 0 || saving}
                        className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20"><ArrowUp size={12} /></button>
                      <button onClick={() => saveToDb(moveItem(visibleStages, i, 1))} disabled={i === visibleStages.length - 1 || saving}
                        className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20"><ArrowDown size={12} /></button>
                    </div>
                    <span className="text-xs text-gray-300 w-4 flex-shrink-0">{i + 1}</span>
                    <span className="text-sm text-gray-700 flex-1 font-medium">{s.name}</span>
                    {s.isWon && <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full">受注</span>}
                    {s.isLost && <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">失注</span>}
                    <button onClick={() => { setEditingId(s.id); setEditForm({ name: s.name, isWon: s.isWon, isLost: s.isLost }) }}
                      className="p-1 text-gray-300 hover:text-orange-500 rounded-lg transition-colors"><Edit2 size={13} /></button>
                    <button onClick={() => handleDelete(s.id, s.name)}
                      className="p-1 text-gray-300 hover:text-red-500 rounded-lg transition-colors"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ─── 事業部別カスタムフィールド ──────────────────────────────────
function DivisionFieldsPanel({ divisionId, divisionName }: MasterPanelProps) {
  const { divisionCustomFields, setDivisionCustomFields } = useAppStore()
  const selectedDivId = divisionId
  const [fields, setFields] = useState<DivisionCustomField[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [newField, setNewField] = useState({ label: '', fieldType: 'text' as DivisionCustomField['fieldType'], options: '' })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ label: '', fieldType: 'text' as DivisionCustomField['fieldType'], options: '' })

  const loadFields = async (divId: string) => {
    if (!divId) return
    if (isSupabaseConfigured()) {
      setLoading(true)
      const data = await fetchDivisionCustomFields(divId)
      const resolved = data.length > 0 ? data : (divisionCustomFields[divId] ?? DEFAULT_DIVISION_CUSTOM_FIELDS[divId] ?? [])
      setFields(resolved)
      setDivisionCustomFields(divId, resolved)
      setLoading(false)
    } else {
      setFields(divisionCustomFields[divId] ?? DEFAULT_DIVISION_CUSTOM_FIELDS[divId] ?? [])
    }
    setShowForm(false)
    setEditingId(null)
  }

  useEffect(() => { loadFields(selectedDivId) }, [selectedDivId]) // eslint-disable-line

  const updateStore = (next: DivisionCustomField[]) => {
    setFields(next)
    setDivisionCustomFields(selectedDivId, next)
  }

  const handleAdd = async () => {
    if (!newField.label.trim()) { toast.error('表示名を入力してください'); return }
    const opts = newField.fieldType === 'select' ? newField.options.split(',').map((s) => s.trim()).filter(Boolean) : undefined
    try {
      if (isSupabaseConfigured()) {
        const id = await createDivisionCustomField({
          divisionId: selectedDivId,
          name: newField.label.trim().toLowerCase().replace(/[\s　]+/g, '_'),
          label: newField.label.trim(),
          fieldType: newField.fieldType,
          options: opts,
          sortOrder: fields.length,
        })
        const added: DivisionCustomField = { id, name: newField.label.trim().toLowerCase().replace(/[\s　]+/g, '_'), label: newField.label.trim(), fieldType: newField.fieldType, options: opts, required: false, sortOrder: fields.length }
        updateStore([...fields, added])
      } else {
        const added: DivisionCustomField = { id: `dcf-${Date.now()}`, name: newField.label.trim().toLowerCase().replace(/[\s　]+/g, '_'), label: newField.label.trim(), fieldType: newField.fieldType, options: opts, required: false, sortOrder: fields.length }
        updateStore([...fields, added])
      }
      toast.success(`フィールド「${newField.label}」を追加しました`)
      setNewField({ label: '', fieldType: 'text', options: '' })
      setShowForm(false)
    } catch { toast.error('追加に失敗しました') }
  }

  const handleEdit = async (id: string) => {
    if (!editForm.label.trim()) { toast.error('表示名を入力してください'); return }
    const opts = editForm.fieldType === 'select' ? editForm.options.split(',').map((s) => s.trim()).filter(Boolean) : undefined
    const idx = fields.findIndex((f) => f.id === id)
    try {
      if (isSupabaseConfigured() && !id.startsWith('dcf-')) {
        await updateDivisionCustomField(id, { label: editForm.label.trim(), fieldType: editForm.fieldType, options: opts, sortOrder: idx })
      }
      updateStore(fields.map((f) => f.id === id ? { ...f, label: editForm.label.trim(), fieldType: editForm.fieldType, options: opts } : f))
      setEditingId(null)
      toast.success('フィールドを更新しました')
    } catch { toast.error('更新に失敗しました') }
  }

  const handleDelete = async (id: string, label: string) => {
    if (!window.confirm(`「${label}」を削除しますか？\nこのフィールドに入力されたすべての値も削除されます。`)) return
    try {
      if (isSupabaseConfigured() && !id.startsWith('dcf-')) {
        await deleteDivisionCustomField(id)
      }
      updateStore(fields.filter((f) => f.id !== id).map((f, i) => ({ ...f, sortOrder: i })))
      toast.success('フィールドを削除しました')
    } catch { toast.error('削除に失敗しました') }
  }

  const handleMove = async (idx: number, dir: -1 | 1) => {
    const next = moveItem(fields, idx, dir).map((f, i) => ({ ...f, sortOrder: i }))
    updateStore(next)
    if (isSupabaseConfigured()) {
      for (const f of next) {
        if (!f.id.startsWith('dcf-')) {
          updateDivisionCustomField(f.id, { label: f.label, fieldType: f.fieldType, options: f.options, sortOrder: f.sortOrder }).catch(() => {})
        }
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-gray-700"><Tag size={18} />カスタムフィールド（{divisionName}）</div>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => { setShowForm((v) => !v); setEditingId(null) }}>フィールド追加</Button>
        </div>
      </CardHeader>
      <CardBody>
        <p className="text-xs text-gray-500 mb-3">顧客情報に事業部固有の入力項目を追加します。顧客詳細画面に表示され、顧客一覧の絞り込み条件にも使用できます。</p>

        {showForm && (
          <div className="mb-4 p-3 bg-orange-50 rounded-xl border border-orange-100 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">表示名 <span className="text-red-500">*</span></label>
                <input type="text" value={newField.label} onChange={(e) => setNewField((f) => ({ ...f, label: e.target.value }))} placeholder="例: 業種"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">フィールド型</label>
                <select value={newField.fieldType} onChange={(e) => setNewField((f) => ({ ...f, fieldType: e.target.value as DivisionCustomField['fieldType'] }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white">
                  <option value="text">テキスト</option>
                  <option value="select">選択（プルダウン）</option>
                  <option value="number">数値</option>
                </select>
              </div>
            </div>
            {newField.fieldType === 'select' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">選択肢（カンマ区切り）</label>
                <input type="text" value={newField.options} onChange={(e) => setNewField((f) => ({ ...f, options: e.target.value }))} placeholder="例: IT, 製造, 医療"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>キャンセル</Button>
              <Button size="sm" onClick={handleAdd} icon={<Check size={13} />}>追加</Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-1">
            {fields.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">フィールドが未設定です</p>
            ) : fields.map((f, i) => (
              <div key={f.id} className="border border-gray-100 rounded-xl overflow-hidden">
                {editingId === f.id ? (
                  <div className="p-3 bg-orange-50 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">表示名</label>
                        <input type="text" value={editForm.label} onChange={(e) => setEditForm((x) => ({ ...x, label: e.target.value }))}
                          className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">フィールド型</label>
                        <select value={editForm.fieldType} onChange={(e) => setEditForm((x) => ({ ...x, fieldType: e.target.value as DivisionCustomField['fieldType'] }))}
                          className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white">
                          <option value="text">テキスト</option>
                          <option value="select">選択</option>
                          <option value="number">数値</option>
                        </select>
                      </div>
                    </div>
                    {editForm.fieldType === 'select' && (
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">選択肢（カンマ区切り）</label>
                        <input type="text" value={editForm.options} onChange={(e) => setEditForm((x) => ({ ...x, options: e.target.value }))} placeholder="例: IT, 製造"
                          className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
                      </div>
                    )}
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingId(null)} className="flex items-center gap-1 text-xs text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-100"><X size={11} />キャンセル</button>
                      <button onClick={() => handleEdit(f.id)} className="flex items-center gap-1 text-xs text-white bg-orange-500 px-2.5 py-1.5 rounded-lg hover:bg-orange-600 font-medium"><Check size={11} />保存</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <div className="flex flex-col gap-0.5 flex-shrink-0">
                      <button onClick={() => handleMove(i, -1)} disabled={i === 0}
                        className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20"><ArrowUp size={12} /></button>
                      <button onClick={() => handleMove(i, 1)} disabled={i === fields.length - 1}
                        className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20"><ArrowDown size={12} /></button>
                    </div>
                    <span className="text-sm text-gray-700 flex-1 font-medium">{f.label}</span>
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">{FIELD_TYPE_LABEL[f.fieldType]}</span>
                    {f.options && f.options.length > 0 && (
                      <span className="text-xs text-gray-400 truncate max-w-24">{f.options.join(' / ')}</span>
                    )}
                    <button onClick={() => { setEditingId(f.id); setEditForm({ label: f.label, fieldType: f.fieldType, options: f.options?.join(', ') ?? '' }) }}
                      className="p-1 text-gray-300 hover:text-orange-500 rounded-lg transition-colors flex-shrink-0"><Edit2 size={13} /></button>
                    <button onClick={() => handleDelete(f.id, f.label)}
                      className="p-1 text-gray-300 hover:text-red-500 rounded-lg transition-colors flex-shrink-0"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ─── 商品マスタ管理 ───────────────────────────────────────────────
function ProductsPanel({ divisionId, divisionName }: MasterPanelProps) {
  const { divisionProducts, setDivisionProducts, divisionProductsEnabled, setDivisionProductsEnabled } = useAppStore()
  const selectedDivId = divisionId

  const products = divisionProducts[selectedDivId] ?? DEFAULT_DIVISION_PRODUCTS[selectedDivId] ?? []
  const enabled = divisionProductsEnabled[selectedDivId] ?? false
  const [newProduct, setNewProduct] = useState('')
  // 010マイグレーション（division_products）適用済みか。未適用ならローカル保存にフォールバック
  const [dbReady, setDbReady] = useState(!isSupabaseConfigured())
  // 初回読み込みが終わるまで操作をブロック（読み込み前の追加が後から届いた
  // フェッチ結果に上書きされて静かに消えるのを防ぐ）
  const [productsLoading, setProductsLoading] = useState(isSupabaseConfigured())
  const [saving, setSaving] = useState(false)

  // 事業部を切り替えたらDBから商品マスタを読み込む（真実源はDB）
  useEffect(() => {
    if (!selectedDivId || !isSupabaseConfigured()) return
    setProductsLoading(true)
    fetchDivisionProductsData(selectedDivId).then((data) => {
      if (data) {
        setDbReady(true)
        setDivisionProducts(selectedDivId, data.products)
        setDivisionProductsEnabled(selectedDivId, data.enabled)
      } else {
        setDbReady(false)
      }
    }).finally(() => setProductsLoading(false))
  }, [selectedDivId]) // eslint-disable-line

  const handleAdd = async () => {
    const trimmed = newProduct.trim()
    if (!trimmed) return
    if (products.includes(trimmed)) { toast.error('同じ商品名がすでに存在します'); return }
    setSaving(true)
    try {
      if (isSupabaseConfigured() && dbReady) {
        await addDivisionProduct(selectedDivId, trimmed, products.length)
      }
      setDivisionProducts(selectedDivId, [...products, trimmed])
      setNewProduct('')
      toast.success(`「${trimmed}」を追加しました`)
    } catch {
      toast.error('商品の保存に失敗しました')
    } finally { setSaving(false) }
  }

  const handleRemove = async (name: string) => {
    setSaving(true)
    try {
      if (isSupabaseConfigured() && dbReady) {
        await removeDivisionProduct(selectedDivId, name)
      }
      setDivisionProducts(selectedDivId, products.filter((x) => x !== name))
    } catch {
      toast.error('商品の削除に失敗しました')
    } finally { setSaving(false) }
  }

  const handleToggleEnabled = async () => {
    const next = !enabled
    try {
      if (isSupabaseConfigured() && dbReady) {
        await saveDivisionProductsEnabled(selectedDivId, next)
      }
      setDivisionProductsEnabled(selectedDivId, next)
      toast.success(next ? '商品選択を有効にしました' : '商品選択を無効にしました')
    } catch {
      toast.error('設定の保存に失敗しました')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 font-bold text-gray-700">
          <Tag size={18} />商品マスタ管理（{divisionName}）
        </div>
      </CardHeader>
      <CardBody>
        <p className="text-xs text-gray-500 mb-4">商談登録画面で選択できる提案商品・サービスを管理します。</p>

        {isSupabaseConfigured() && !dbReady && (
          <div className="mb-4 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
            商品マスタのDBテーブル（010_products.sql）が未適用のため、この端末のローカル保存で動作しています。
            他のユーザー・端末には共有されません。
          </div>
        )}

        {/* 表示ON/OFFトグル */}
        <div className="flex items-center justify-between mb-4 p-3 bg-gray-50 rounded-xl border border-gray-100">
          <div>
            <p className="text-sm font-medium text-gray-700">商談画面に商品選択を表示する</p>
            <p className="text-xs text-gray-400 mt-0.5">ONにすると商談登録・編集時に商品を選択できます</p>
          </div>
          <button
            onClick={handleToggleEnabled}
            disabled={productsLoading}
            className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 disabled:opacity-50',
              enabled ? 'bg-orange-500' : 'bg-gray-200')}
          >
            <span className={cn('inline-block h-4 w-4 rounded-full bg-white transition-transform',
              enabled ? 'translate-x-6' : 'translate-x-1')} />
          </button>
        </div>

        {/* 商品リスト */}
        <div className="space-y-1.5 mb-3">
          {products.length === 0 && <p className="text-xs text-gray-400 py-2 text-center">商品がまだ登録されていません</p>}
          {products.map((p) => (
            <div key={p} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
              <span className="flex-1 text-sm text-gray-700">{p}</span>
              <button onClick={() => handleRemove(p)} disabled={saving || productsLoading}
                className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input type="text" value={newProduct} onChange={(e) => setNewProduct(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="商品名を入力（例: assiST）"
            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <button onClick={handleAdd} disabled={saving || productsLoading}
            className="flex items-center gap-1 px-3 py-1.5 bg-orange-500 text-white text-xs font-medium rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50">
            <Plus size={13} />追加
          </button>
        </div>
      </CardBody>
    </Card>
  )
}

// ─── 資料カテゴリ管理 ─────────────────────────────────────────────
function DocTypesPanel({ divisionId, divisionName }: MasterPanelProps) {
  const selectedDivId = divisionId
  const [docTypes, setDocTypes] = useState<DivisionDocType[]>([])
  // 013マイグレーション（division_document_types）が利用可能か
  const [dbReady, setDbReady] = useState(false)
  const [docsLoading, setDocsLoading] = useState(false)
  const [docSaving, setDocSaving] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')

  const reload = async (divId: string) => {
    const types = await fetchDivisionDocTypes(divId)
    setDocTypes(types)
  }

  useEffect(() => {
    if (!selectedDivId || !isSupabaseConfigured()) return
    setDocsLoading(true)
    reload(selectedDivId)
      .then(() => setDbReady(true))
      .catch(() => setDbReady(false))
      .finally(() => setDocsLoading(false))
  }, [selectedDivId]) // eslint-disable-line

  const handleAddType = async () => {
    const trimmed = newTypeName.trim()
    if (!trimmed) return
    if (docTypes.some((t) => t.name === trimmed)) { toast.error('同じカテゴリ名がすでに存在します'); return }
    setDocSaving(true)
    try {
      await createDivisionDocType({ divisionId: selectedDivId, name: trimmed, sortOrder: docTypes.length, isPinned: false })
      await reload(selectedDivId)
      setNewTypeName('')
      toast.success(`「${trimmed}」を追加しました`)
    } catch {
      toast.error('カテゴリの追加に失敗しました')
    } finally { setDocSaving(false) }
  }

  const handleTogglePin = async (t: DivisionDocType) => {
    setDocSaving(true)
    try {
      await updateDivisionDocType(t.id, { isPinned: !t.is_pinned })
      await reload(selectedDivId)
    } catch {
      toast.error('更新に失敗しました')
    } finally { setDocSaving(false) }
  }

  const handleDeleteType = async (t: DivisionDocType) => {
    if (!window.confirm(`カテゴリ「${t.name}」を削除しますか？\n（登録済み資料は削除されず、カテゴリ名だけが残ります）`)) return
    setDocSaving(true)
    try {
      await deleteDivisionDocType(t.id)
      await reload(selectedDivId)
      toast.success(`「${t.name}」を削除しました`)
    } catch {
      toast.error('削除に失敗しました')
    } finally { setDocSaving(false) }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 font-bold text-gray-700">
          <FileText size={18} />資料カテゴリ管理（{divisionName}）
        </div>
      </CardHeader>
      <CardBody>
        <p className="text-xs text-gray-500 mb-4">
          商談の「資料（Driveリンク）」で選択できるカテゴリを管理します。
          「常設」にしたカテゴリは、資料が未登録でも商談画面に枠が常に表示されます（例: ノンネームシート・IMシート）。
        </p>

        {isSupabaseConfigured() && !dbReady && !docsLoading && (
          <div className="mb-4 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
            資料管理のDBテーブル（013_deal_documents.sql）が未適用のため利用できません。
          </div>
        )}

        <div className="space-y-1.5 mb-3">
          {docTypes.length === 0 && !docsLoading && dbReady && (
            <p className="text-xs text-gray-400 py-2 text-center">
              カテゴリ未設定（既定の「契約書・提案資料・その他」が使われます）
            </p>
          )}
          {docTypes.map((t) => (
            <div key={t.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
              <span className="flex-1 text-sm text-gray-700">{t.name}</span>
              <button
                onClick={() => handleTogglePin(t)}
                disabled={docSaving || docsLoading}
                aria-pressed={t.is_pinned}
                aria-label={`${t.name}を常設${t.is_pinned ? '解除' : 'に設定'}`}
                className={cn(
                  'px-2 py-0.5 text-[11px] font-medium rounded-full border transition-colors disabled:opacity-50',
                  t.is_pinned
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-gray-400 border-gray-200 hover:border-orange-300'
                )}
              >
                常設
              </button>
              <button onClick={() => handleDeleteType(t)} disabled={docSaving || docsLoading}
                aria-label={`${t.name}を削除`}
                className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input type="text" value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddType()}
            placeholder="カテゴリ名を入力（例: 契約書）"
            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <button onClick={handleAddType} disabled={docSaving || docsLoading || !dbReady}
            className="flex items-center gap-1 px-3 py-1.5 bg-orange-500 text-white text-xs font-medium rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50">
            <Plus size={13} />追加
          </button>
        </div>
      </CardBody>
    </Card>
  )
}

// ─── Slack通知設定（M&A事業部要望⑧） ─────────────────────────────
// division_document_types_manage と同じ権限パターン（super_admin or 当該事業部manager）。
// Webhook URLは機密情報のためRLSでもmanager/super_adminのみ閲覧可能に絞っている。
function NotificationSettingsPanel({ divisionId, divisionName }: MasterPanelProps) {
  const selectedDivId = divisionId
  const [dbReady, setDbReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [mention, setMention] = useState('')
  const [daysBefore, setDaysBefore] = useState(1)
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (!selectedDivId || !isSupabaseConfigured()) return
    setLoading(true)
    fetchNotificationSettings(selectedDivId)
      .then((s) => {
        setWebhookUrl(s?.slack_webhook_url ?? '')
        setMention(s?.slack_mention ?? '')
        setDaysBefore(s?.days_before ?? 1)
        setEnabled(s?.enabled ?? false)
        setDbReady(true)
      })
      .catch(() => setDbReady(false))
      .finally(() => setLoading(false))
  }, [selectedDivId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (webhookUrl && !/^https?:\/\//i.test(webhookUrl)) {
      toast.error('Webhook URLは http:// または https:// で始めてください')
      return
    }
    setSaving(true)
    try {
      await upsertNotificationSettings(selectedDivId, {
        slackWebhookUrl: webhookUrl.trim() || null,
        slackMention: mention.trim() || null,
        daysBefore,
        enabled,
      })
      toast.success('Slack通知設定を保存しました')
    } catch {
      toast.error('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 font-bold text-gray-700">
          <Send size={18} />Slack通知設定（{divisionName}）
        </div>
      </CardHeader>
      <CardBody>
        <p className="text-xs text-gray-500 mb-4">
          対応期日（マイルストーン・クロージング予定日）の指定日数前になると、
          Slackへ自動通知します。通知は毎朝（JST 7:00頃）にまとめて送信されます。
        </p>

        {isSupabaseConfigured() && !dbReady && !loading && (
          <div className="mb-4 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
            通知設定のDBテーブル（022_deal_milestones_and_slack.sql）が未適用のため利用できません。
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Slack通知を有効にする</span>
            <button
              onClick={() => setEnabled((v) => !v)}
              disabled={!dbReady || saving || loading}
              aria-pressed={enabled}
              aria-label="Slack通知の有効/無効"
              className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50',
                enabled ? 'bg-orange-500' : 'bg-gray-200')}
            >
              <span className={cn('inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                enabled ? 'translate-x-5' : 'translate-x-0.5')} />
            </button>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Slack Incoming Webhook URL</label>
            <input type="text" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)}
              disabled={!dbReady || saving || loading}
              placeholder="https://hooks.slack.com/services/..."
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">メンション文字列（任意）</label>
            <input type="text" value={mention} onChange={(e) => setMention(e.target.value)}
              disabled={!dbReady || saving || loading}
              placeholder="例: <!channel> や <@U0123456>"
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">何日前に通知するか</label>
            <input type="number" min={0} max={30} value={daysBefore}
              onChange={(e) => setDaysBefore(Math.max(0, parseInt(e.target.value, 10) || 0))}
              disabled={!dbReady || saving || loading}
              className="w-24 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50" />
          </div>
          <Button size="sm" loading={saving} disabled={!dbReady || loading} onClick={handleSave} icon={<Save size={13} />}>
            保存する
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

// ─── 事業部別カテゴリ管理の共通パネル ─────────────────────────────
// ナレッジ（018）・活動メモ（020）のカテゴリ管理はUI・挙動が同一のため共通化。
// 資料カテゴリ（013）は「常設」トグルがあるため別実装（DocTypesPanel）のまま
interface DivisionCategoryPanelProps extends MasterPanelProps {
  title: string
  icon: React.ReactNode
  description: string
  /** マイグレーション未適用時の案内文 */
  migrationHint: string
  /** カテゴリ0件時の案内文（既定カテゴリの説明） */
  emptyText: string
  placeholder: string
  fetchCategories: (divisionId: string) => Promise<{ id: string; name: string }[]>
  createCategory: (input: { divisionId: string; name: string; sortOrder: number }) => Promise<void>
  deleteCategory: (id: string) => Promise<void>
}

function DivisionCategoryPanel({
  divisionId, divisionName, title, icon, description, migrationHint, emptyText, placeholder,
  fetchCategories, createCategory, deleteCategory,
}: DivisionCategoryPanelProps) {
  const selectedDivId = divisionId
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  // 対象マイグレーションが適用済みか（テーブル不在なら取得が失敗する）
  const [dbReady, setDbReady] = useState(false)
  // 事業部はkey付きマウントで固定なので、取得が走るかどうかは初期値で決まる
  const [catLoading, setCatLoading] = useState(Boolean(divisionId) && isSupabaseConfigured())
  const [catSaving, setCatSaving] = useState(false)
  const [newCatName, setNewCatName] = useState('')

  const reload = async (divId: string) => {
    const data = await fetchCategories(divId)
    setCategories(data)
  }

  useEffect(() => {
    if (!selectedDivId || !isSupabaseConfigured()) return
    let cancelled = false
    fetchCategories(selectedDivId)
      .then((data) => { if (!cancelled) { setCategories(data); setDbReady(true) } })
      .catch(() => { if (!cancelled) setDbReady(false) })
      .finally(() => { if (!cancelled) setCatLoading(false) })
    return () => { cancelled = true }
  }, [selectedDivId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    // Enterキー経由の呼び出しはボタンのdisabledを迂回するため、ここでもガードする
    if (!dbReady || catSaving || catLoading) return
    const trimmed = newCatName.trim()
    if (!trimmed) return
    if (categories.some((c) => c.name === trimmed)) { toast.error('同じカテゴリ名がすでに存在します'); return }
    setCatSaving(true)
    try {
      await createCategory({ divisionId: selectedDivId, name: trimmed, sortOrder: categories.length })
      await reload(selectedDivId)
      setNewCatName('')
      toast.success(`「${trimmed}」を追加しました`)
    } catch {
      toast.error('カテゴリの追加に失敗しました')
    } finally { setCatSaving(false) }
  }

  const handleDelete = async (c: { id: string; name: string }) => {
    if (!window.confirm(`カテゴリ「${c.name}」を削除しますか？\n（登録済みのデータは削除されず、カテゴリ名だけが残ります）`)) return
    setCatSaving(true)
    try {
      await deleteCategory(c.id)
      await reload(selectedDivId)
      toast.success(`「${c.name}」を削除しました`)
    } catch {
      toast.error('削除に失敗しました')
    } finally { setCatSaving(false) }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 font-bold text-gray-700">
          {icon}{title}（{divisionName}）
        </div>
      </CardHeader>
      <CardBody>
        <p className="text-xs text-gray-500 mb-4">{description}</p>

        {isSupabaseConfigured() && !dbReady && !catLoading && (
          <div className="mb-4 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
            {migrationHint}
          </div>
        )}

        <div className="space-y-1.5 mb-3">
          {categories.length === 0 && !catLoading && dbReady && (
            <p className="text-xs text-gray-400 py-2 text-center">{emptyText}</p>
          )}
          {categories.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
              <span className="flex-1 text-sm text-gray-700">{c.name}</span>
              <button onClick={() => handleDelete(c)} disabled={catSaving || catLoading}
                aria-label={`${c.name}を削除`}
                className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          {/* IMEの変換確定Enterで誤送信しないようisComposing中は無視する */}
          <input type="text" value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleAdd() }}
            placeholder={placeholder}
            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <button onClick={handleAdd} disabled={catSaving || catLoading || !dbReady}
            className="flex items-center gap-1 px-3 py-1.5 bg-orange-500 text-white text-xs font-medium rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50">
            <Plus size={13} />追加
          </button>
        </div>
      </CardBody>
    </Card>
  )
}

// ─── ナレッジカテゴリ管理 ─────────────────────────────────────────
function KnowledgeCategoriesPanel(props: MasterPanelProps) {
  return (
    <DivisionCategoryPanel
      {...props}
      title="ナレッジカテゴリ管理"
      icon={<BookOpen size={18} />}
      description="ナレッジページの投稿で選択できるカテゴリを管理します。"
      migrationHint="ナレッジベースのDBテーブル（018_knowledge_base.sql）が未適用のため利用できません。"
      emptyText="カテゴリ未設定（既定の「ナレッジ・研修資料・ニュース」が使われます）"
      placeholder="カテゴリ名を入力（例: 業界レポート）"
      fetchCategories={fetchDivisionKnowledgeCategories}
      createCategory={createDivisionKnowledgeCategory}
      deleteCategory={deleteDivisionKnowledgeCategory}
    />
  )
}

// ─── 活動メモカテゴリ管理（⑰） ───────────────────────────────────
function MemoCategoriesPanel(props: MasterPanelProps) {
  return (
    <DivisionCategoryPanel
      {...props}
      title="活動メモカテゴリ管理"
      icon={<Activity size={18} />}
      description="活動の記録（電話・メール・面談・メモ・タスク）に付けられる用途別カテゴリを管理します。活動履歴ページでカテゴリごとに絞り込めます。"
      migrationHint="活動メモカテゴリのDBテーブル（020_memo_categories.sql）が未適用のため利用できません。"
      emptyText="カテゴリ未設定（既定の「顧客・案件・面談・契約」が使われます）"
      placeholder="カテゴリ名を入力（例: クレーム対応）"
      fetchCategories={fetchDivisionMemoCategories}
      createCategory={createDivisionMemoCategory}
      deleteCategory={deleteDivisionMemoCategory}
    />
  )
}

// ─── タスクカンバンステージ管理 ────────────────────────────────────
const STAGE_COLOR_OPTIONS = [
  { value: 'gray',   label: 'グレー'   },
  { value: 'blue',   label: 'ブルー'   },
  { value: 'yellow', label: 'イエロー' },
  { value: 'orange', label: 'オレンジ' },
  { value: 'green',  label: 'グリーン' },
  { value: 'red',    label: 'レッド'   },
  { value: 'purple', label: 'パープル' },
]
const COLOR_DOT: Record<string, string> = {
  gray: 'bg-gray-400', blue: 'bg-blue-500', yellow: 'bg-yellow-500',
  orange: 'bg-orange-500', green: 'bg-green-500', red: 'bg-red-500', purple: 'bg-purple-500',
}

function TaskStagesPanel({ divisionId, divisionName }: MasterPanelProps) {
  const { divisionTaskStages, setDivisionTaskStages } = useAppStore()
  const divId = divisionId
  const stages: TaskKanbanStage[] = divisionTaskStages[divId] ?? DEFAULT_DIVISION_TASK_STAGES[divId] ?? []
  const [newName, setNewName]   = useState('')
  const [newColor, setNewColor] = useState('blue')

  const handleAdd = () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    if (stages.some((s) => s.name === trimmed)) { toast.error('同じ名前の列がすでに存在します'); return }
    setDivisionTaskStages(divId, [...stages, { id: `stage-${Date.now()}`, name: trimmed, color: newColor }])
    setNewName('')
    toast.success(`列「${trimmed}」を追加しました`)
  }

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...stages]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setDivisionTaskStages(divId, next)
  }

  return (
    <Card>
      <CardHeader><div className="flex items-center gap-2"><Settings2 size={16} /><span className="font-bold text-gray-800">タスクカンバン設定（{divisionName}）</span></div></CardHeader>
      <CardBody>
        {/* 何を設定する画面かをUIだけで理解できるよう、対象と操作方法を明示する */}
        <div className="mb-4 p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs text-gray-500 space-y-2">
          <p>
            サイドバーの<span className="font-bold text-gray-700">「タスク管理」ページに表示されるカンバンの列（＝タスクの進行段階）</span>を編集します。
            タスクはカンバン上でドラッグして列間を移動できます。
          </p>
          {/* 列並びのイメージ */}
          <div className="flex items-center gap-1.5 flex-wrap" aria-hidden="true">
            <span className="text-gray-400">例:</span>
            {['未着手', '対応中', '完了'].map((label, i) => (
              <span key={label} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-gray-300">→</span>}
                <span className="px-2 py-0.5 bg-white border border-gray-200 rounded-md text-gray-600 font-medium">{label}</span>
              </span>
            ))}
          </div>
          <ul className="list-disc pl-4 space-y-0.5 text-gray-400">
            <li>下の入力欄で色と列名を決めて「追加」</li>
            <li><ArrowUp size={10} className="inline" /><ArrowDown size={10} className="inline" /> で列の並び順を変更、ゴミ箱アイコンで削除</li>
            <li>変更はこの事業部のタスクカンバンに即時反映されます</li>
          </ul>
          <p className="text-gray-400">財務支援では補助金フロー用の列（例: 申請中）がデフォルト設定されています。</p>
        </div>

        <p className="text-xs font-medium text-gray-500 mb-1.5">現在の列（上から順にカンバンの左→右に並びます）</p>
        <div className="space-y-1.5 mb-3">
          {stages.length === 0 && (
            <p className="text-xs text-gray-400 py-2 text-center">列が未設定です。下から追加してください</p>
          )}
          {stages.map((s, idx) => (
            <div key={s.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
              <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', COLOR_DOT[s.color] ?? 'bg-gray-400')} />
              <span className="flex-1 text-sm text-gray-700">{s.name}</span>
              <div className="flex gap-0.5">
                <button onClick={() => move(idx, -1)} disabled={idx === 0} aria-label={`${s.name}を上へ`}
                  className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20"><ArrowUp size={12} /></button>
                <button onClick={() => move(idx, 1)} disabled={idx === stages.length - 1} aria-label={`${s.name}を下へ`}
                  className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20"><ArrowDown size={12} /></button>
              </div>
              <button onClick={() => setDivisionTaskStages(divId, stages.filter((x) => x.id !== s.id))}
                aria-label={`${s.name}を削除`}
                className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <p className="text-xs font-medium text-gray-500 mb-1.5">列を追加</p>
        <div className="flex gap-2">
          <select value={newColor} onChange={(e) => setNewColor(e.target.value)} aria-label="列の色"
            className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white">
            {STAGE_COLOR_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleAdd() }}
            placeholder="列名（例: 申請中）"
            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <button onClick={handleAdd}
            className="flex items-center gap-1 px-3 py-1.5 bg-orange-500 text-white text-xs font-medium rounded-lg hover:bg-orange-600 transition-colors">
            <Plus size={13} />追加
          </button>
        </div>
      </CardBody>
    </Card>
  )
}
