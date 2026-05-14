'use client'

import { useState } from 'react'
import { useAppStore } from '@/store/appStore'
import type { AdminUserRecord, DivisionCustomField, DivisionStage } from '@/store/appStore'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { DeleteConfirmModal } from '@/components/settings/DeleteConfirmModal'
import {
  Save, User, Building2, Bell, Shield, Users,
  Settings2, Layers, Tag, Trash2, Plus, Eye, EyeOff,
  Check, X, ChevronDown, ChevronUp, ArrowUp, ArrowDown, Edit2,
} from 'lucide-react'
import { MOCK_TEAM_MEMBERS, MOCK_DIVISIONS, DEFAULT_DIVISION_CUSTOM_FIELDS, DEFAULT_DIVISION_STAGES } from '@/lib/mock-data'
import type { Role } from '@/types/database'
import { cn, getInitials } from '@/lib/utils'
import toast from 'react-hot-toast'

const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'システム管理者',
  manager: 'マネージャー',
  user: 'ユーザー',
}
const ROLE_COLORS: Record<Role, string> = {
  super_admin: 'bg-purple-100 text-purple-700',
  manager: 'bg-orange-100 text-orange-700',
  user: 'bg-gray-100 text-gray-600',
}
const PRESET_COLORS = [
  '#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ec4899',
  '#ef4444', '#f59e0b', '#14b8a6', '#6366f1', '#64748b',
]

// ─── 削除確認状態 ────────────────────────────────────────────────
type DeleteTarget = { id: string; name: string; type: string; warning?: string } | null

export default function SettingsPage() {
  const store = useAppStore()
  const { currentUser, setCurrentUser, activeDivision, divisions } = store
  const isSuperAdmin = currentUser?.role === 'super_admin'

  const [name, setName] = useState(currentUser?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null)

  const handleSave = async () => {
    if (!name.trim()) { toast.error('氏名を入力してください'); return }
    setSaving(true)
    await new Promise((r) => setTimeout(r, 400))
    setCurrentUser({ ...currentUser!, name: name.trim() })
    setSaving(false)
    toast.success('プロフィールを保存しました')
  }

  const confirmDelete = (target: DeleteTarget) => {
    if (!target) return
    if (target.type === 'division') store.removeExtraDivision(target.id)
    else if (target.type === 'builtinDivision') store.removeExtraDivision(target.id)
    else if (target.type === 'stage') store.removeExtraStage(target.id)
    else if (target.type === 'builtinStage') store.removeExtraStage(target.id)
    else if (target.type === 'field') store.removeExtraCustomField(target.id)
    else if (target.type === 'user') store.removeAdminUser(target.id)
    setDeleteTarget(null)
    toast.success(`「${target.name}」を削除しました`)
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
            <User size={18} />
            プロフィール
          </div>
        </CardHeader>
        <CardBody>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">氏名</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                  focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50"
              />
              <p className="text-xs text-gray-400 mt-1">変更後は「保存」を押してください。サイドバーの名前も更新されます。</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
              <input
                type="email"
                defaultValue={currentUser?.email ?? ''}
                disabled
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">権限</label>
              <span className={cn('inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium', ROLE_COLORS[currentUser?.role ?? 'user'])}>
                {currentUser?.role === 'super_admin' && <Shield size={13} />}
                {ROLE_LABELS[currentUser?.role ?? 'user']}
              </span>
            </div>
            <Button loading={saving} onClick={handleSave} icon={<Save size={14} />}>
              保存
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ─── 所属事業部 ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 font-bold text-gray-700">
            <Building2 size={18} />
            所属事業部
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
            <Bell size={18} />
            通知設定
          </div>
        </CardHeader>
        <CardBody>
          <div className="space-y-3">
            {[
              { label: 'トスアップを受信したとき', defaultChecked: true },
              { label: '商談フェーズが変更されたとき', defaultChecked: true },
              { label: 'タスクの期限が近づいたとき', defaultChecked: true },
              { label: 'チームメンバーの活動更新', defaultChecked: false },
            ].map(({ label, defaultChecked }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-sm text-gray-700">{label}</span>
                <input type="checkbox" defaultChecked={defaultChecked} className="w-4 h-4 accent-orange-500" />
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
              <Shield size={11} />
              管理者設定
            </span>
            <div className="flex-1 h-px bg-purple-100" />
          </div>

          <AccountsPanel onDeleteRequest={setDeleteTarget} />
          <DivisionsPanel onDeleteRequest={setDeleteTarget} />
          <DivisionStagesPanel />
          <DivisionFieldsPanel />
        </>
      )}

      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => confirmDelete(deleteTarget)}
        itemName={deleteTarget?.name ?? ''}
        warning={deleteTarget?.warning}
      />
    </div>
  )
}

// ─── アカウント管理 ───────────────────────────────────────────────
function AccountsPanel({ onDeleteRequest }: { onDeleteRequest: (t: DeleteTarget) => void }) {
  const store = useAppStore()
  const { adminUsers, roleOverrides, setRoleOverride, userDivisionMap, setUserDivisionMap } = store
  const allBuiltinUsers = [
    ...MOCK_TEAM_MEMBERS,
    { id: 'user-azuma', name: '東 千代之介', email: 'azuma_c@pollock.co.jp', role: 'super_admin' as Role, created_at: '2026-01-01' },
  ]
  const allUsers = [...allBuiltinUsers, ...adminUsers]

  const [showAddForm, setShowAddForm] = useState(false)
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-gray-700">
            <Users size={18} />
            アカウント管理
          </div>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowAddForm(true)}>
            アカウントを追加
          </Button>
        </div>
      </CardHeader>
      <CardBody>
        <div className="space-y-1">
          {allUsers.map((user) => {
            const effectiveRole = roleOverrides[user.id] ?? user.role
            const divAssignment = userDivisionMap[user.id]
            const isExpanded = expandedUserId === user.id
            const isAdmin = adminUsers.find((u) => u.id === user.id)
            return (
              <div key={user.id} className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 p-3">
                  <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-sm flex-shrink-0">
                    {getInitials(user.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700">{user.name}</p>
                    <p className="text-xs text-gray-400 truncate">{user.email}</p>
                  </div>
                  {/* 権限変更 */}
                  <select
                    value={effectiveRole}
                    onChange={(e) => {
                      setRoleOverride(user.id, e.target.value as Role)
                      toast.success(`${user.name}の権限を変更しました`)
                    }}
                    className="text-xs px-2 py-1 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="user">ユーザー</option>
                    <option value="manager">マネージャー</option>
                    <option value="super_admin">システム管理者</option>
                  </select>
                  {/* 事業部展開ボタン */}
                  <button
                    onClick={() => setExpandedUserId(isExpanded ? null : user.id)}
                    className="text-gray-400 hover:text-gray-600 p-1 rounded transition-colors"
                    title="事業部設定"
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {/* 削除（追加済みアカウントのみ） */}
                  {isAdmin && (
                    <button
                      onClick={() => onDeleteRequest({ id: user.id, name: user.name, type: 'user', warning: 'このアカウントに紐づく活動データは保持されます。' })}
                      className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                {/* 事業部所属設定 */}
                {isExpanded && (
                  <DivisionAssignmentRow
                    currentAssignment={divAssignment}
                    onSave={(ids, primaryId) => {
                      setUserDivisionMap(user.id, ids, primaryId)
                      toast.success(`${user.name}の事業部を設定しました`)
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </CardBody>

      {showAddForm && (
        <AddUserModal onClose={() => setShowAddForm(false)} />
      )}
    </Card>
  )
}

function DivisionAssignmentRow({
  currentAssignment, onSave,
}: {
  currentAssignment?: { ids: string[]; primaryId: string }
  onSave: (ids: string[], primaryId: string) => void
}) {
  const { extraDivisions, removedDivisionIds } = useAppStore()
  const allDivisions = [
    ...MOCK_DIVISIONS.filter((d) => !removedDivisionIds.includes(d.id)),
    ...extraDivisions.map((d) => ({ id: d.id, name: d.name, color_code: d.colorCode, created_at: '' })),
  ]
  const [selectedIds, setSelectedIds] = useState<string[]>(currentAssignment?.ids ?? [])
  const [primaryId, setPrimaryId] = useState(currentAssignment?.primaryId ?? allDivisions[0]?.id ?? '')

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  return (
    <div className="border-t border-gray-100 bg-gray-50 p-3">
      <p className="text-xs font-medium text-gray-500 mb-2">所属事業部（複数選択可）</p>
      <div className="grid grid-cols-2 gap-1.5 mb-3">
        {allDivisions.map((d) => {
          const isSelected = selectedIds.includes(d.id)
          return (
            <button
              key={d.id}
              onClick={() => toggle(d.id)}
              className={cn(
                'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left text-xs transition-all',
                isSelected ? 'border-orange-400 bg-orange-50' : 'border-gray-200 bg-white hover:bg-gray-50'
              )}
            >
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color_code ?? '#6b7280' }} />
              <span className={cn('flex-1 truncate', isSelected ? 'text-orange-700 font-medium' : 'text-gray-600')}>
                {d.name}
              </span>
              {isSelected && <Check size={11} className="text-orange-500 flex-shrink-0" />}
            </button>
          )
        })}
      </div>
      {selectedIds.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium text-gray-500 mb-1.5">デフォルト表示事業部</p>
          <div className="flex flex-wrap gap-1.5">
            {selectedIds.map((id) => {
              const d = allDivisions.find((x) => x.id === id)
              return (
                <button
                  key={id}
                  onClick={() => setPrimaryId(id)}
                  className={cn(
                    'text-xs px-2.5 py-1 rounded-full border transition-all',
                    primaryId === id ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300'
                  )}
                >
                  {d?.name}
                </button>
              )
            })}
          </div>
        </div>
      )}
      <Button
        size="sm"
        onClick={() => onSave(selectedIds, primaryId)}
        icon={<Save size={12} />}
      >
        保存
      </Button>
    </div>
  )
}

function AddUserModal({ onClose }: { onClose: () => void }) {
  const { addAdminUser, extraDivisions, removedDivisionIds } = useAppStore()
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'user' as Role, divisionIds: [] as string[], primaryId: '' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)

  const allDivisions = [
    ...MOCK_DIVISIONS.filter((d) => !removedDivisionIds.includes(d.id)),
    ...extraDivisions.map((d) => ({ id: d.id, name: d.name, color_code: d.colorCode, created_at: '' })),
  ]

  const toggleDiv = (id: string) => {
    setForm((f) => ({
      ...f,
      divisionIds: f.divisionIds.includes(id) ? f.divisionIds.filter((x) => x !== id) : [...f.divisionIds, id],
    }))
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast.error('氏名を入力してください'); return }
    if (!form.email.trim()) { toast.error('メールアドレスを入力してください'); return }
    if (!form.password.trim()) { toast.error('パスワードを入力してください'); return }
    if (form.divisionIds.length === 0) { toast.error('所属事業部を選択してください'); return }
    setLoading(true)
    await new Promise((r) => setTimeout(r, 400))
    const newUser: AdminUserRecord = {
      id: `user-${Date.now()}`,
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      role: form.role,
      divisionIds: form.divisionIds,
      primaryDivisionId: form.primaryId || form.divisionIds[0],
      created_at: new Date().toISOString(),
    }
    addAdminUser(newUser)
    setLoading(false)
    toast.success(`${form.name}のアカウントを作成しました`)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="font-bold text-gray-800">アカウントを追加</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">氏名 <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="田中 花子"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス <span className="text-red-500">*</span></label>
            <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="hanako@pollock.co.jp"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">パスワード <span className="text-red-500">*</span></label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'} value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
                className="w-full px-3 py-2 pr-10 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50" />
              <button type="button" onClick={() => setShowPw((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">権限</label>
            <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50">
              <option value="user">ユーザー</option>
              <option value="manager">マネージャー</option>
              <option value="super_admin">システム管理者</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">所属事業部 <span className="text-red-500">*</span></label>
            <div className="grid grid-cols-2 gap-1.5">
              {allDivisions.map((d) => {
                const isSelected = form.divisionIds.includes(d.id)
                return (
                  <button key={d.id} type="button" onClick={() => toggleDiv(d.id)}
                    className={cn('flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-all',
                      isSelected ? 'border-orange-400 bg-orange-50 text-orange-700 font-medium' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50')}>
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color_code ?? '#6b7280' }} />
                    <span className="flex-1 truncate">{d.name}</span>
                    {isSelected && <Check size={11} className="text-orange-500" />}
                  </button>
                )
              })}
            </div>
          </div>
          {form.divisionIds.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">デフォルト表示事業部</label>
              <div className="flex flex-wrap gap-1.5">
                {form.divisionIds.map((id) => {
                  const d = allDivisions.find((x) => x.id === id)
                  return (
                    <button key={id} type="button" onClick={() => setForm((f) => ({ ...f, primaryId: id }))}
                      className={cn('text-xs px-2.5 py-1 rounded-full border transition-all',
                        form.primaryId === id ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300')}>
                      {d?.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>キャンセル</Button>
            <Button loading={loading} className="flex-1" onClick={handleSubmit} icon={<Plus size={14} />}>
              アカウントを作成
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── 事業部マスタ ─────────────────────────────────────────────────
function DivisionsPanel({ onDeleteRequest }: { onDeleteRequest: (t: DeleteTarget) => void }) {
  const { extraDivisions, removedDivisionIds, addExtraDivision } = useAppStore()
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])

  const activeMockDivisions = MOCK_DIVISIONS.filter((d) => !removedDivisionIds.includes(d.id))

  const handleAdd = () => {
    if (!newName.trim()) { toast.error('事業部名を入力してください'); return }
    addExtraDivision({ id: `div-custom-${Date.now()}`, name: newName.trim(), colorCode: newColor })
    toast.success(`事業部「${newName}」を追加しました`)
    setNewName('')
    setNewColor(PRESET_COLORS[0])
    setShowForm(false)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-gray-700">
            <Layers size={18} />
            事業部マスタ
          </div>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowForm((v) => !v)}>
            事業部を追加
          </Button>
        </div>
      </CardHeader>
      <CardBody>
        {showForm && (
          <div className="mb-4 p-3 bg-orange-50 rounded-xl border border-orange-100 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">事業部名</label>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="例: マーケティング"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">カラー</label>
              <div className="flex gap-2 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button key={c} onClick={() => setNewColor(c)}
                    className={cn('w-6 h-6 rounded-full border-2 transition-transform hover:scale-110',
                      newColor === c ? 'border-gray-700 scale-125' : 'border-transparent')}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => { setShowForm(false); setNewName('') }}>キャンセル</Button>
              <Button size="sm" onClick={handleAdd} icon={<Check size={13} />}>追加</Button>
            </div>
          </div>
        )}
        <div className="space-y-1">
          {[...activeMockDivisions, ...extraDivisions.map((d) => ({ id: d.id, name: d.name, color_code: d.colorCode, created_at: '' }))].map((d) => {
            const isExtra = extraDivisions.some((x) => x.id === d.id)
            return (
              <div key={d.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: d.color_code ?? '#6b7280' }} />
                <span className="text-sm text-gray-700 flex-1">{d.name}</span>
                {isExtra && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">追加済み</span>}
                <button
                  onClick={() => onDeleteRequest({
                    id: d.id,
                    name: d.name,
                    type: isExtra ? 'division' : 'builtinDivision',
                    warning: isExtra
                      ? 'この事業部に所属する顧客・商談のデータに影響が出る可能性があります。'
                      : '⚠️ これはシステム組み込みの事業部です。削除すると復旧できません。この事業部の顧客・商談・活動データが表示されなくなります。',
                  })}
                  className="text-red-400 hover:text-red-600 p-1 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      </CardBody>
    </Card>
  )
}

const FIELD_TYPE_LABEL: Record<string, string> = { text: 'テキスト', number: '数値', boolean: 'チェック', select: '選択' }

// ─── 共通：事業部リスト取得 ──────────────────────────────────────
function useDivisionList() {
  const { extraDivisions, removedDivisionIds } = useAppStore()
  return [
    ...MOCK_DIVISIONS.filter((d) => !removedDivisionIds.includes(d.id)),
    ...extraDivisions.map((d) => ({ id: d.id, name: d.name, color_code: d.colorCode, created_at: '' })),
  ]
}

// ─── 共通：並び替えヘルパー ──────────────────────────────────────
function moveItem<T>(arr: T[], idx: number, dir: -1 | 1): T[] {
  const next = [...arr]
  const target = idx + dir
  if (target < 0 || target >= next.length) return next
  ;[next[idx], next[target]] = [next[target], next[idx]]
  return next
}

// ─── 事業部別パイプラインステージ ────────────────────────────────
function DivisionStagesPanel() {
  const { divisionStages, setDivisionStages } = useAppStore()
  const allDivisions = useDivisionList()
  const [selectedDivId, setSelectedDivId] = useState(allDivisions[0]?.id ?? '')
  const [showForm, setShowForm] = useState(false)
  const [newStage, setNewStage] = useState({ name: '', isWon: false, isLost: false })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', isWon: false, isLost: false })

  const stages: DivisionStage[] = divisionStages[selectedDivId] ?? DEFAULT_DIVISION_STAGES[selectedDivId] ?? []
  const save = (next: DivisionStage[]) => setDivisionStages(selectedDivId, next.map((s, i) => ({ ...s, sortOrder: i })))

  const handleAdd = () => {
    if (!newStage.name.trim()) { toast.error('ステージ名を入力してください'); return }
    save([...stages, { id: `ds-${Date.now()}`, name: newStage.name.trim(), sortOrder: stages.length, isWon: newStage.isWon, isLost: newStage.isLost }])
    toast.success(`ステージ「${newStage.name}」を追加しました`)
    setNewStage({ name: '', isWon: false, isLost: false })
    setShowForm(false)
  }

  const startEdit = (s: DivisionStage) => { setEditingId(s.id); setEditForm({ name: s.name, isWon: s.isWon, isLost: s.isLost }) }

  const saveEdit = (id: string) => {
    if (!editForm.name.trim()) { toast.error('ステージ名を入力してください'); return }
    save(stages.map((s) => s.id === id ? { ...s, ...editForm, name: editForm.name.trim() } : s))
    setEditingId(null)
    toast.success('ステージを更新しました')
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-gray-700"><Settings2 size={18} />事業部別パイプラインステージ</div>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => { setShowForm((v) => !v); setEditingId(null) }}>ステージ追加</Button>
        </div>
      </CardHeader>
      <CardBody>
        {/* 事業部セレクター */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">対象事業部</label>
          <select value={selectedDivId} onChange={(e) => { setSelectedDivId(e.target.value); setShowForm(false); setEditingId(null) }}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50">
            {allDivisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        {/* 追加フォーム */}
        {showForm && (
          <div className="mb-4 p-3 bg-orange-50 rounded-xl border border-orange-100 space-y-3">
            <input type="text" value={newStage.name} onChange={(e) => setNewStage((s) => ({ ...s, name: e.target.value }))}
              placeholder="ステージ名"
              className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={newStage.isWon} onChange={(e) => setNewStage((s) => ({ ...s, isWon: e.target.checked, isLost: false }))} className="w-4 h-4 accent-green-500" />受注ステージ
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={newStage.isLost} onChange={(e) => setNewStage((s) => ({ ...s, isLost: e.target.checked, isWon: false }))} className="w-4 h-4 accent-red-400" />失注ステージ
              </label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>キャンセル</Button>
              <Button size="sm" onClick={handleAdd} icon={<Check size={13} />}>追加</Button>
            </div>
          </div>
        )}

        {/* ステージ一覧 */}
        <div className="space-y-1">
          {stages.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">ステージが未設定です</p>
          ) : stages.map((s, i) => (
            <div key={s.id} className="border border-gray-100 rounded-xl overflow-hidden">
              {editingId === s.id ? (
                /* インライン編集フォーム */
                <div className="p-3 bg-orange-50 space-y-2">
                  <input type="text" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" />
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer text-xs">
                      <input type="checkbox" checked={editForm.isWon} onChange={(e) => setEditForm((f) => ({ ...f, isWon: e.target.checked, isLost: false }))} className="w-3.5 h-3.5 accent-green-500" />受注
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-xs">
                      <input type="checkbox" checked={editForm.isLost} onChange={(e) => setEditForm((f) => ({ ...f, isLost: e.target.checked, isWon: false }))} className="w-3.5 h-3.5 accent-red-400" />失注
                    </label>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditingId(null)} className="flex items-center gap-1 text-xs text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-100"><X size={11} />キャンセル</button>
                    <button onClick={() => saveEdit(s.id)} className="flex items-center gap-1 text-xs text-white bg-orange-500 px-2.5 py-1.5 rounded-lg hover:bg-orange-600 font-medium"><Check size={11} />保存</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2.5">
                  {/* 並び替えボタン */}
                  <div className="flex flex-col gap-0.5 flex-shrink-0">
                    <button onClick={() => save(moveItem(stages, i, -1))} disabled={i === 0}
                      className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20 transition-colors"><ArrowUp size={12} /></button>
                    <button onClick={() => save(moveItem(stages, i, 1))} disabled={i === stages.length - 1}
                      className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20 transition-colors"><ArrowDown size={12} /></button>
                  </div>
                  <span className="text-xs text-gray-300 w-4 flex-shrink-0">{i + 1}</span>
                  <span className="text-sm text-gray-700 flex-1 font-medium">{s.name}</span>
                  {s.isWon && <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full">受注</span>}
                  {s.isLost && <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">失注</span>}
                  <button onClick={() => startEdit(s)} className="p-1 text-gray-300 hover:text-orange-500 rounded-lg transition-colors"><Edit2 size={13} /></button>
                  <button onClick={() => { save(stages.filter((x) => x.id !== s.id)); toast.success('ステージを削除しました') }}
                    className="p-1 text-gray-300 hover:text-red-500 rounded-lg transition-colors"><Trash2 size={13} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}

// ─── 事業部別カスタムフィールド ──────────────────────────────────
function DivisionFieldsPanel() {
  const { divisionCustomFields, setDivisionCustomFields } = useAppStore()
  const allDivisions = useDivisionList()
  const [selectedDivId, setSelectedDivId] = useState(allDivisions[0]?.id ?? '')
  const [showForm, setShowForm] = useState(false)
  const [newField, setNewField] = useState<{ label: string; fieldType: DivisionCustomField['fieldType']; options: string }>({ label: '', fieldType: 'text', options: '' })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ label: string; fieldType: DivisionCustomField['fieldType']; options: string }>({ label: '', fieldType: 'text', options: '' })

  const fields: DivisionCustomField[] = divisionCustomFields[selectedDivId] ?? DEFAULT_DIVISION_CUSTOM_FIELDS[selectedDivId] ?? []
  const save = (next: DivisionCustomField[]) => setDivisionCustomFields(selectedDivId, next.map((f, i) => ({ ...f, sortOrder: i })))

  const handleAdd = () => {
    if (!newField.label.trim()) { toast.error('表示名を入力してください'); return }
    const opts = newField.fieldType === 'select' ? newField.options.split(',').map((s) => s.trim()).filter(Boolean) : undefined
    save([...fields, { id: `dcf-${Date.now()}`, name: newField.label.trim().toLowerCase().replace(/[\s　]+/g, '_'), label: newField.label.trim(), fieldType: newField.fieldType, options: opts, required: false, sortOrder: fields.length }])
    toast.success(`フィールド「${newField.label}」を追加しました`)
    setNewField({ label: '', fieldType: 'text', options: '' })
    setShowForm(false)
  }

  const startEdit = (f: DivisionCustomField) => { setEditingId(f.id); setEditForm({ label: f.label, fieldType: f.fieldType, options: f.options?.join(', ') ?? '' }) }

  const saveEdit = (id: string) => {
    if (!editForm.label.trim()) { toast.error('表示名を入力してください'); return }
    const opts = editForm.fieldType === 'select' ? editForm.options.split(',').map((s) => s.trim()).filter(Boolean) : undefined
    save(fields.map((f) => f.id === id ? { ...f, label: editForm.label.trim(), fieldType: editForm.fieldType, options: opts } : f))
    setEditingId(null)
    toast.success('フィールドを更新しました')
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-gray-700"><Tag size={18} />事業部別カスタムフィールド</div>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => { setShowForm((v) => !v); setEditingId(null) }}>フィールド追加</Button>
        </div>
      </CardHeader>
      <CardBody>
        {/* 事業部セレクター */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">対象事業部</label>
          <select value={selectedDivId} onChange={(e) => { setSelectedDivId(e.target.value); setShowForm(false); setEditingId(null) }}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50">
            {allDivisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        {/* 追加フォーム */}
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

        {/* フィールド一覧 */}
        <div className="space-y-1">
          {fields.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">フィールドが未設定です</p>
          ) : fields.map((f, i) => (
            <div key={f.id} className="border border-gray-100 rounded-xl overflow-hidden">
              {editingId === f.id ? (
                /* インライン編集フォーム */
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
                    <button onClick={() => saveEdit(f.id)} className="flex items-center gap-1 text-xs text-white bg-orange-500 px-2.5 py-1.5 rounded-lg hover:bg-orange-600 font-medium"><Check size={11} />保存</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2.5">
                  {/* 並び替えボタン */}
                  <div className="flex flex-col gap-0.5 flex-shrink-0">
                    <button onClick={() => save(moveItem(fields, i, -1))} disabled={i === 0}
                      className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20 transition-colors"><ArrowUp size={12} /></button>
                    <button onClick={() => save(moveItem(fields, i, 1))} disabled={i === fields.length - 1}
                      className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20 transition-colors"><ArrowDown size={12} /></button>
                  </div>
                  <span className="text-sm text-gray-700 flex-1 font-medium">{f.label}</span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">{FIELD_TYPE_LABEL[f.fieldType]}</span>
                  {f.options && <span className="text-xs text-gray-400 truncate max-w-[6rem]">{f.options.join(' / ')}</span>}
                  <button onClick={() => startEdit(f)} className="p-1 text-gray-300 hover:text-orange-500 rounded-lg transition-colors flex-shrink-0"><Edit2 size={13} /></button>
                  <button onClick={() => { save(fields.filter((x) => x.id !== f.id)); toast.success('フィールドを削除しました') }}
                    className="p-1 text-gray-300 hover:text-red-500 rounded-lg transition-colors flex-shrink-0"><Trash2 size={13} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}
