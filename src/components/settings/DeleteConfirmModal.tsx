'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { AlertTriangle } from 'lucide-react'

interface DeleteConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  itemName: string
  warning?: string
}

export function DeleteConfirmModal({ isOpen, onClose, onConfirm, itemName, warning }: DeleteConfirmModalProps) {
  const [step, setStep] = useState<1 | 2>(1)

  const handleClose = () => {
    setStep(1)
    onClose()
  }

  const handleStep1 = () => setStep(2)

  const handleFinalDelete = () => {
    setStep(1)
    onConfirm()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="削除の確認" size="sm">
      {step === 1 ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-yellow-50 rounded-xl">
            <AlertTriangle size={18} className="text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-800">
                「{itemName}」を削除しますか？
              </p>
              {warning && (
                <p className="text-xs text-yellow-700 mt-1">{warning}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={handleClose}>
              キャンセル
            </Button>
            <Button
              className="flex-1 !bg-yellow-500 hover:!bg-yellow-600"
              onClick={handleStep1}
            >
              次へ
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-red-50 rounded-xl border border-red-200">
            <AlertTriangle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-700">この操作は元に戻せません</p>
              <p className="text-xs text-red-600 mt-1">
                「{itemName}」を完全に削除します。関連するデータに影響が出る可能性があります。
                本当に削除してよろしいですか？
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={handleClose}>
              キャンセル
            </Button>
            <Button
              className="flex-1 !bg-red-500 hover:!bg-red-600"
              onClick={handleFinalDelete}
            >
              完全に削除する
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
