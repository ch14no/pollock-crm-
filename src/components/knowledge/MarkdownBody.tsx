'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// react-markdownがカスタムコンポーネントに渡す`node`（hast要素）をDOMへ
// スプレッドしないよう取り除く（そのまま渡すとReactが不正propとして警告する）
function omitNode<T extends { node?: unknown }>(props: T) {
  const { node: _ignored, ...rest } = props
  void _ignored
  return rest
}

// ナレッジ本文（Markdown）の表示部品。
// @tailwindcss/typography は未導入のため、要素ごとにクラスを割り当てて整形する。
// 危険スキーム（javascript:等）のURLは react-markdown の既定のurlTransformで無害化される。
export function MarkdownBody({ children }: { children: string }) {
  return (
    <div className="text-sm text-gray-700 leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => <h1 className="text-lg font-bold text-gray-800 mt-4 mb-2 first:mt-0" {...omitNode(props)} />,
          h2: (props) => <h2 className="text-base font-bold text-gray-800 mt-4 mb-2 first:mt-0" {...omitNode(props)} />,
          h3: (props) => <h3 className="text-sm font-bold text-gray-800 mt-3 mb-1.5 first:mt-0" {...omitNode(props)} />,
          h4: (props) => <h4 className="text-sm font-semibold text-gray-800 mt-3 mb-1 first:mt-0" {...omitNode(props)} />,
          p: (props) => <p className="my-2 first:mt-0 last:mb-0" {...omitNode(props)} />,
          ul: (props) => <ul className="list-disc pl-5 my-2 space-y-1" {...omitNode(props)} />,
          ol: (props) => <ol className="list-decimal pl-5 my-2 space-y-1" {...omitNode(props)} />,
          a: ({ href, ...props }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-600 hover:underline"
              {...omitNode(props)}
            />
          ),
          blockquote: (props) => (
            <blockquote className="border-l-2 border-gray-200 pl-3 my-2 text-gray-500" {...omitNode(props)} />
          ),
          code: ({ className, ...props }) => (
            // ブロックコードは<pre>側で整形するため、ここではインライン相当の見た目のみ
            <code className={`bg-gray-100 rounded px-1 py-0.5 text-[13px] font-mono ${className ?? ''}`} {...omitNode(props)} />
          ),
          pre: (props) => (
            <pre className="bg-gray-50 border border-gray-100 rounded-lg p-3 my-2 overflow-x-auto text-[13px]" {...omitNode(props)} />
          ),
          table: (props) => (
            <div className="overflow-x-auto my-2">
              <table className="text-sm border-collapse" {...omitNode(props)} />
            </div>
          ),
          th: (props) => <th className="border border-gray-200 bg-gray-50 px-2 py-1 text-left font-semibold" {...omitNode(props)} />,
          td: (props) => <td className="border border-gray-200 px-2 py-1 align-top" {...omitNode(props)} />,
          hr: () => <hr className="my-3 border-gray-100" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
