'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/appStore'
import type { DivisionCustomField, DivisionStage } from '@/store/appStore'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import {
  Save, User, Building2, Bell, Shield, Users,
  Settings2, Tag, Trash2, Plus, ExternalLink,
  Check, X, ArrowUp, ArrowDown, Edit2, Info,
} from 'lucide-react'
import { DEFAULT_DIVISION_CUSTOM_FIELDS, DEFAULT_DIVISION_STAGES } from '@/lib/mock-data'
import type { Role } from '@/types/database'
import { cn, getInitials } from '@/lib/utils'
import { isSupabaseConfigured } from '@/lib/db/client'
import { updateUserName, fetchAllUsers } from '@/lib/db/users'
import {
  fetchPipelineStages, upsertPipelineStages,
  fetchDivisionCustomFields,
  createDivisionCustomField, updateDivisionCustomField, deleteDivisionCustomField,
} from '@/lib/db/divisions'
import type { User as UserType } from '@/types/database'
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

// ─── ローカルストレージへの通知設定保存 ──────────────────────────
const NOTIF_KEY = 'pollock-notif-settings'
const DEFAULT_NOTIF = { tossup: true, dealStage: true, taskDue: true, teamActivity: false }
function loadNotifSettings() {
  try { return { ...DEFAULT_NOTIF, ...JSON.parse(localStorage.getItem(NOTIF_KEY) ?? '{}') } } catch { return DEFAULT_NOTIF }
}

// ─── メインページ ─────────────────────────────────────────────────
export default function SettingsPage() {
  const { currentUser, setCurrentUser, activeDivision, divisions } = useAppStore()
  const isSuperAdmin = currentUser?.role === 'super_admin'

  const [name, setName] = useState(currentUser?.name ?? '')
  const [saving, setSaving] = useState(false)

  // 通知設定
  const [notif, setNotif] = useState(loadNotifSettings)
  const toggleNotif = (key: keyof typeof DEFAULT_NOTIF) => {
    const next = { ...notif, [key]: !notif[key] }
    setNotif(next)
    localStorage.setItem(NOTIF_KEY, JSON.stringify(next))
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
            {([
              { key: 'tossup',       label: 'トスアップを受信したとき' },
              { key: 'dealStage',    label: '商談フェーズが変更されたとき' },
              { key: 'taskDue',      label: 'タスクの期限が近づいたとき' },
              { key: 'teamActivity', label: 'チームメンバーの活動更新' },
            ] as { key: keyof typeof DEFAULT_NOTIF; label: string }[]).map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-sm text-gray-700">{label}</span>
                <button
                  onClick={() => toggleNotif(key)}
                  className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                    notif[key] ? 'bg-orange-500' : 'bg-gray-200')}
                >
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
          <DivisionStagesPanel />
          <DivisionFieldsPanel />
        </>
      )}
    </div>
  )
}

// ─── アカウント管理 ───────────────────────────────────────────────
function AccountsPanel() {
  const { currentUser } = useAppStore()
  const [users, setUsers] = useState<UserType[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured()) return
    setLoading(true)
    fetchAllUsers().then(setUsers).finally(() => setLoading(false))
  }, [])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-gray-700">
            <Users size={18} />アカウント管理
          </div>
          {isSupabaseConfigured() && (
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-orange-600 hover:text-orange-700 font-medium px-3 py-1.5 border border-orange-200 rounded-lg hover:bg-orange-50 transition-colors"
            >
              <ExternalLink size={12} />
              Supabaseでユーザーを招待
            </a>
          )}
        </div>
      </CardHeader>
      <CardBody>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">ユーザーが見つかりません</p>
        ) : (
          <>
            <div className="space-y-1">
              {users.map((user) => (
                <div key={user.id} className="flex items-center gap-3 p-3 border border-gray-100 rounded-xl">
                  <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-sm flex-shrink-0">
                    {getInitials(user.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700">
                      {user.name}
                      {user.id === currentUser?.id && (
                        <span className="ml-1.5 text-xs text-orange-500 font-normal">（あなた）</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400 truncate">{user.email}</p>
                  </div>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', ROLE_COLORS[user.role as Role])}>
                    {ROLE_LABELS[user.role as Role] ?? user.role}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-2 mt-3 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
              <Info size={13} className="flex-shrink-0 mt-0.5" />
              <span>ユーザーの招待・ロール変更はSupabaseダッシュボードの Authentication → Users で行います</span>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}

// ─── 事業部別パイプラインステージ ────────────────────────────────
function DivisionStagesPanel() {
  const { divisions, divisionStages, setDivisionStages } = useAppStore()
  const [selectedDivId, setSelectedDivId] = useState(divisions[0]?.id ?? '')
  const [stages, setStages] = useState<DivisionStage[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [newStage, setNewStage] = useState({ name: '', isWon: false, isLost: false })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', isWon: false, isLost: false })

  // 選択事業部が変わったらステージを読み込む
  useEffect(() => {
    if (!selectedDivId) return
    if (isSupabaseConfigured()) {
      setLoading(true)
      fetchPipelineStages(selectedDivId).then((raw) => {
        const mapped: DivisionStage[] = (raw as { id: string; name: string; sort_order: number; is_won: boolean; is_lost: boolean }[]).map((s) => ({
          id: s.id, name: s.name, sortOrder: s.sort_order, isWon: s.is_won, isLost: s.is_lost,
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

  const saveToDb = async (next: DivisionStage[]) => {
    setSaving(true)
    try {
      if (isSupabaseConfigured()) {
        await upsertPipelineStages(selectedDivId, next.map((s, i) => ({
          name: s.name, sort_order: i, is_won: s.isWon, is_lost: s.isLost,
        })))
        // DBから再取得してIDを更新
        const raw = await fetchPipelineStages(selectedDivId) as { id: string; name: string; sort_order: number; is_won: boolean; is_lost: boolean }[]
        const refreshed: DivisionStage[] = raw.map((s) => ({ id: s.id, name: s.name, sortOrder: s.sort_order, isWon: s.is_won, isLost: s.is_lost }))
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
    const next = [...stages, { id: `ds-${Date.now()}`, name: newStage.name.trim(), sortOrder: stages.length, isWon: newStage.isWon, isLost: newStage.isLost }]
    await saveToDb(next)
    toast.success(`ステージ「${newStage.name}」を追加しました`)
    setNewStage({ name: '', isWon: false, isLost: false })
    setShowForm(false)
  }

  const handleEdit = async (id: string) => {
    if (!editForm.name.trim()) { toast.error('ステージ名を入力してください'); return }
    const next = stages.map((s) => s.id === id ? { ...s, ...editForm, name: editForm.name.trim() } : s)
    await saveToDb(next)
    setEditingId(null)
    toast.success('ステージを更新しました')
  }

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`「${name}」を削除しますか？`)) return
    await saveToDb(stages.filter((s) => s.id !== id))
    toast.success('ステージを削除しました')
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
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">対象事業部</label>
          <select value={selectedDivId} onChange={(e) => setSelectedDivId(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50">
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
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
            {stages.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">ステージが未設定です</p>
            ) : stages.map((s, i) => (
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
                      <button onClick={() => saveToDb(moveItem(stages, i, -1))} disabled={i === 0 || saving}
                        className="p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-20"><ArrowUp size={12} /></button>
                      <button onClick={() => saveToDb(moveItem(stages, i, 1))} disabled={i === stages.length - 1 || saving}
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
function DivisionFieldsPanel() {
  const { divisions, divisionCustomFields, setDivisionCustomFields } = useAppStore()
  const [selectedDivId, setSelectedDivId] = useState(divisions[0]?.id ?? '')
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
          <div className="flex items-center gap-2 font-bold text-gray-700"><Tag size={18} />事業部別カスタムフィールド</div>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => { setShowForm((v) => !v); setEditingId(null) }}>フィールド追加</Button>
        </div>
      </CardHeader>
      <CardBody>
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">対象事業部</label>
          <select value={selectedDivId} onChange={(e) => setSelectedDivId(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50">
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

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
