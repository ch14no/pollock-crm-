'use client'

import { Modal } from '@/components/ui/Modal'
import type { Contact } from '@/types/database'

interface ContactSelectModalProps {
  isOpen: boolean
  title: string
  contacts: Contact[]
  onSelect: (contact: Contact) => void
  onClose: () => void
}

// 会社に担当者が複数いるとき「どの担当者の案件か」を選ぶ
export function ContactSelectModal({ isOpen, title, contacts, onSelect, onClose }: ContactSelectModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <div className="space-y-2">
        {contacts.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c)}
            className="w-full text-left px-3 py-2.5 rounded-xl border border-gray-100 hover:bg-orange-50 hover:border-orange-200 transition-colors"
          >
            <span className="text-sm font-medium text-gray-800">{c.name}</span>
            {c.position && <span className="text-xs text-gray-500 ml-2">{c.position}</span>}
          </button>
        ))}
      </div>
    </Modal>
  )
}
