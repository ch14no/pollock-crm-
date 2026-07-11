'use client'

import { ExternalLink, Edit2, Trash2, Globe, Building2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { MarkdownBody } from '@/components/knowledge/MarkdownBody'
import { formatRelativeTime } from '@/lib/utils'
import type { KnowledgePost } from '@/types/database'

interface KnowledgePostDetailModalProps {
  post: KnowledgePost | null
  onClose: () => void
  /** 投稿者本人・当該事業部manager・super_adminのときtrue */
  canEdit: boolean
  onEdit: () => void
  onDelete: () => void
  /** 他事業部からの全社公開投稿のときtrue（事業部名バッジを表示） */
  isOtherDivision: boolean
}

export function KnowledgePostDetailModal({ post, onClose, canEdit, onEdit, onDelete, isOtherDivision }: KnowledgePostDetailModalProps) {
  if (!post) return null
  return (
    <Modal isOpen onClose={onClose} title={post.title} size="lg">
      <div className="space-y-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="orange">{post.category}</Badge>
          {post.visibility === 'company' ? (
            <Badge variant="info" className="gap-1"><Globe size={11} />全社公開</Badge>
          ) : (
            <Badge className="gap-1"><Building2 size={11} />自事業部のみ</Badge>
          )}
          {isOtherDivision && post.divisions && (
            <Badge className="gap-1">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: post.divisions.color_code ?? '#6b7280' }} />
              {post.divisions.name}
            </Badge>
          )}
          <span className="text-xs text-gray-400 ml-auto">
            {post.users?.name ? `${post.users.name} · ` : ''}{formatRelativeTime(post.updated_at)}
          </span>
        </div>

        {post.body.trim() ? (
          <MarkdownBody>{post.body}</MarkdownBody>
        ) : (
          <p className="text-sm text-gray-400">本文はありません</p>
        )}

        {post.links.length > 0 && (
          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">添付リンク</p>
            <div className="space-y-1.5">
              {post.links.map((l, idx) => (
                <a
                  key={idx} href={l.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-700 hover:text-orange-600 hover:bg-orange-50 transition-colors group"
                >
                  <ExternalLink size={13} className="flex-shrink-0 text-gray-400 group-hover:text-orange-500" />
                  <span className="font-medium truncate">{l.name}</span>
                  <span className="text-xs text-gray-400 truncate flex-1 text-right">{l.url}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {canEdit && (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
            <button
              onClick={onDelete}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 size={14} />削除
            </button>
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Edit2 size={14} />編集
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
