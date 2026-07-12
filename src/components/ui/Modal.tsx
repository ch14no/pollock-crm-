'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
  headerColor?: 'orange' | 'default'
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  headerColor = 'default',
}: ModalProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKey)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          // コンテンツが増えてもビューポートを超えないよう上限を設け、本文側をスクロールさせる
          'relative w-full rounded-2xl bg-white shadow-xl flex flex-col max-h-[85vh]',
          sizeClasses[size]
        )}
      >
        <div
          className={cn(
            'flex-shrink-0 flex items-center justify-between px-5 py-4 rounded-t-2xl',
            headerColor === 'orange'
              ? 'bg-orange-500 text-white'
              : 'border-b border-gray-100'
          )}
        >
          <h2 className="font-bold text-base">{title}</h2>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className={cn(
              'p-1 rounded-lg transition-colors',
              headerColor === 'orange'
                ? 'hover:bg-orange-400 text-white'
                : 'hover:bg-gray-100 text-gray-500'
            )}
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
