'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'

// SSR中はuseLayoutEffectが警告を出すため、クライアントでのみlayout effectを使う
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

interface AutoGrowTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** 自動拡張の上限（これを超えると内部スクロール） */
  maxHeightPx?: number
}

// 入力量に応じて高さが自動で広がるテキストエリア。
// 「メモ欄が3行固定で広げられない」問題（M&A事業部要望㉔）への共通部品。
export function AutoGrowTextarea({ maxHeightPx = 400, value, rows = 3, style, ...rest }: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // ペイント前に高さを確定させ、初回表示時に「3行→本来の高さ」へガクつくのを防ぐ
  useIsomorphicLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxHeightPx)}px`
  }, [value, maxHeightPx])

  return (
    <textarea
      ref={ref}
      rows={rows}
      value={value}
      // 高さは自動計算が真実源。手動リサイズは次の入力で上書きされて見えるため無効化する
      style={{ resize: 'none', ...style }}
      {...rest}
    />
  )
}
