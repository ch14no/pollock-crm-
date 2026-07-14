'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, X, Users, UserCircle, Building2 } from 'lucide-react'
import { MOCK_USER } from '@/lib/mock-data'
import { isSupabaseConfigured } from '@/lib/db/client'
import { fetchUsersWithDivision } from '@/lib/db/users'
import { fetchContactById } from '@/lib/db/contacts'
import { ContactSearchPopup } from '@/components/ui/ContactPicker'
import { cn, getInitials } from '@/lib/utils'
import type { Contact, ReferrerContact, ReferrerType, ReferrerUser } from '@/types/database'

// 紹介者欄（M&A事業部要望④）。社内は users、社外は既存の contacts に紐づける
// （新規入力フォームは作らず、事前登録済みの担当者情報を参照する運用）。

export interface ReferrerValue {
  type?: ReferrerType
  userId?: string
  contactId?: string
}

// 選択が確定した瞬間に渡す表示用のフルオブジェクト（修正9: 呼び出し元が
// join結果の再取得を待たずに表示名を即時反映できるようにするため）。
// クリア時（onChange({}) 呼び出し時）は渡されない（undefined）。
// 社内側はReferrerUser（id/nameのみ。修正2でfetchUsersWithDivisionがemail等を
// 返さなくなったことに合わせている）
export interface ReferrerSelectDetail {
  user?: ReferrerUser
  contact?: ReferrerContact
}

interface ReferrerPickerProps {
  value: ReferrerValue
  onChange: (value: ReferrerValue, detail?: ReferrerSelectDetail) => void
  label?: string
  disabled?: boolean
  /** 社外検索（既存contacts検索）の絞り込み対象事業部 */
  filterDivisionId?: string
}

function normalize(str: string): string {
  return str.toLowerCase().normalize('NFKC').replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60)
  )
}

type UserWithDivision = ReferrerUser & { primaryDivisionName?: string }

function UserSearchPopup({
  onSelect,
  onClose,
}: {
  onSelect: (user: UserWithDivision) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<UserWithDivision[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    if (isSupabaseConfigured()) {
      setLoading(true)
      fetchUsersWithDivision().then(setUsers).catch(() => {}).finally(() => setLoading(false))
    } else {
      // デモモードには複数社員のモックがないため、自分自身のみ選択肢として提示する
      setUsers([{ ...MOCK_USER }])
    }
  }, [])

  const candidates = useMemo(() => {
    if (!query.trim()) return users.slice(0, 50)
    const q = normalize(query)
    return users.filter((u) =>
      normalize(u.name).includes(q) || normalize(u.primaryDivisionName ?? '').includes(q)
    )
  }, [query, users])

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-16 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <Search size={16} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="氏名・所属事業部で検索..."
            className="flex-1 text-sm focus:outline-none placeholder-gray-400"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
          <button onClick={onClose}
            className="ml-1 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
          <p className="text-xs text-gray-400">
            {loading ? '読み込み中...' : query ? `「${query}」の検索結果 ${candidates.length}件` : `社員 ${users.length}件`}
          </p>
        </div>

        <div className="overflow-y-auto max-h-80">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <Users size={28} className="mb-2 text-gray-300" />
              <p className="text-sm">一致する社員がいません</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {candidates.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => onSelect(user)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-orange-50 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-orange-100 text-orange-600 font-bold text-sm
                    flex items-center justify-center flex-shrink-0">
                    {getInitials(user.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-gray-800">{user.name}</span>
                    {user.primaryDivisionName && (
                      <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-400">
                        <Building2 size={10} />
                        {user.primaryDivisionName}
                      </div>
                    )}
                  </div>
                  <span className="text-orange-300 text-sm flex-shrink-0">→</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400">クリックで選択 · Esc で閉じる</p>
        </div>
      </div>
    </div>
  )
}

export function ReferrerPicker({ value, onChange, label, disabled, filterDivisionId }: ReferrerPickerProps) {
  const [popup, setPopup] = useState<'user' | 'contact' | null>(null)
  const [selectedUser, setSelectedUser] = useState<UserWithDivision | null>(null)
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  // 社内／社外トグルは「どちらの検索ポップアップを開くか」だけを切り替えるローカルUI状態。
  // 実際に人物/顧客を選ぶ（handleSelectUser/handleSelectContact）まで親のonChangeは呼ばない。
  // トグルだけで onChange({ type }) を呼ぶと、id未選択のまま type だけ確定した状態で
  // 保存され、021マイグレーションのCHECK制約（contacts_referrer_consistency/
  // deals_referrer_consistency）に違反して保存全体が失敗する不具合があったため（修正1）。
  const [pendingType, setPendingType] = useState<ReferrerType | null>(null)

  // 親から渡される value が変わったら（別の商談/顧客を開いた、保存・クリアが確定した等）
  // トグルの未確定状態をリセットする。リセットしないと、直前に触っていたトグルの選択が
  // 次に開いた別レコードの表示に迷い込む。
  // レンダー中にstateを比較・更新する（Reactの推奨パターン）ことでuseEffectの
  // 二度描画を避ける
  const [prevValue, setPrevValue] = useState(value)
  if (prevValue !== value) {
    setPrevValue(value)
    setPendingType(null)
  }

  const effectiveType = pendingType ?? value.type
  const hasSelection = effectiveType === value.type &&
    ((value.type === 'internal' && !!value.userId) || (value.type === 'external' && !!value.contactId))

  // 選択済みIDが変わったら表示用データを取得
  useEffect(() => {
    let cancelled = false
    if (value.type === 'internal' && value.userId) {
      if (isSupabaseConfigured()) {
        fetchUsersWithDivision().then((users) => {
          if (!cancelled) setSelectedUser(users.find((u) => u.id === value.userId) ?? null)
        }).catch(() => { if (!cancelled) setSelectedUser(null) })
      } else if (value.userId === MOCK_USER.id) {
        setSelectedUser({ ...MOCK_USER })
      } else {
        setSelectedUser(null)
      }
    } else {
      setSelectedUser(null)
    }
    return () => { cancelled = true }
  }, [value.type, value.userId])

  useEffect(() => {
    let cancelled = false
    if (value.type === 'external' && value.contactId && isSupabaseConfigured()) {
      fetchContactById(value.contactId).then((c) => { if (!cancelled) setSelectedContact(c) }).catch(() => { if (!cancelled) setSelectedContact(null) })
    } else {
      setSelectedContact(null)
    }
    return () => { cancelled = true }
  }, [value.type, value.contactId])

  const handleTypeChange = (type: ReferrerType) => {
    if (type === effectiveType) return
    // ここでは onChange を呼ばない（=まだ何も確定しない）。実際に検索して
    // 人物/顧客を選ぶまでフォーム側の referrer は「未選択」のまま保つ
    setPendingType(type)
  }

  const handleClear = () => {
    setPendingType(null)
    onChange({})
  }

  const handleSelectUser = (user: UserWithDivision) => {
    setSelectedUser(user)
    setPendingType(null)
    onChange({ type: 'internal', userId: user.id }, { user })
    setPopup(null)
  }

  const handleSelectContact = (contact: Contact) => {
    setSelectedContact(contact)
    setPendingType(null)
    onChange({ type: 'external', contactId: contact.id }, { contact })
    setPopup(null)
  }

  return (
    <div>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}

      {/* 社内／社外トグル */}
      <div className="flex gap-1.5 mb-2 flex-wrap">
        {(['internal', 'external'] as const).map((t) => (
          <button
            key={t}
            type="button"
            disabled={disabled}
            aria-pressed={effectiveType === t}
            onClick={() => handleTypeChange(t)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all disabled:opacity-50',
              effectiveType === t
                ? 'bg-orange-500 text-white border-orange-500'
                : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300'
            )}
          >
            {t === 'internal' ? '社内' : '社外'}
          </button>
        ))}
        {effectiveType && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="px-2 py-1.5 text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            未設定に戻す
          </button>
        )}
      </div>

      {!effectiveType ? (
        <p className="text-xs text-gray-400">「社内」または「社外」を選んで紹介者を検索してください</p>
      ) : effectiveType === 'internal' ? (
        hasSelection && selectedUser ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg">
            <div className="w-6 h-6 rounded-full bg-orange-200 text-orange-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
              {getInitials(selectedUser.name)}
            </div>
            <span className="text-sm font-medium text-orange-700 flex-1 truncate">
              {selectedUser.name}
              {selectedUser.primaryDivisionName && (
                <span className="text-orange-500 font-normal ml-1 text-xs">（{selectedUser.primaryDivisionName}）</span>
              )}
            </span>
            {!disabled && (
              <button type="button" onClick={() => setPopup('user')}
                className="flex-shrink-0 text-xs text-orange-500 hover:text-orange-700 font-medium px-2 py-0.5 rounded hover:bg-orange-100 transition-colors">
                変更
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPopup('user')}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm border rounded-lg text-left transition-all
              border-gray-200 bg-gray-50 text-gray-400 hover:border-orange-400 hover:bg-orange-50 cursor-pointer disabled:opacity-50"
          >
            <Search size={14} className="flex-shrink-0" />
            <span>社内の紹介者を検索...</span>
          </button>
        )
      ) : (
        hasSelection && selectedContact ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg">
            <div className="w-6 h-6 rounded-full bg-orange-200 text-orange-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
              {getInitials(selectedContact.name)}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-orange-700 truncate block">
                {selectedContact.name}
                {selectedContact.companies && (
                  <span className="text-orange-500 font-normal ml-1 text-xs">（{selectedContact.companies.name}）</span>
                )}
              </span>
              {(selectedContact.department || selectedContact.position || selectedContact.email || selectedContact.phone) && (
                <span className="text-xs text-orange-500 flex items-center gap-1 flex-wrap">
                  <UserCircle size={10} />
                  {[selectedContact.department, selectedContact.position, selectedContact.phone || selectedContact.email]
                    .filter(Boolean).join(' / ')}
                </span>
              )}
            </div>
            {!disabled && (
              <button type="button" onClick={() => setPopup('contact')}
                className="flex-shrink-0 text-xs text-orange-500 hover:text-orange-700 font-medium px-2 py-0.5 rounded hover:bg-orange-100 transition-colors">
                変更
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPopup('contact')}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm border rounded-lg text-left transition-all
              border-gray-200 bg-gray-50 text-gray-400 hover:border-orange-400 hover:bg-orange-50 cursor-pointer disabled:opacity-50"
          >
            <Search size={14} className="flex-shrink-0" />
            <span>社外の紹介者（登録済み顧客）を検索...</span>
          </button>
        )
      )}

      {popup === 'user' && <UserSearchPopup onSelect={handleSelectUser} onClose={() => setPopup(null)} />}
      {popup === 'contact' && (
        <ContactSearchPopup
          filterDivisionId={filterDivisionId}
          onSelect={handleSelectContact}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  )
}
