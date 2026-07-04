@AGENTS.md

## コーディング規約
- TypeScript strict mode（tsconfig.jsonで`"strict": true`）
- anyは原則禁止、型アサーション（as）は最小限
- コンポーネントはfunction宣言、Propsの型はinterfaceで定義
- importは絶対パス（`@/components/...`）
- ファイル名：PascalCase（コンポーネント）/ camelCase（hooks・utils）
- エラーハンドリングを明示的に実装（try/catch・ErrorBoundary）
- アクセシビリティ対応（aria属性・キーボード操作）

## 検証（完了報告の前に必須）
- `npx tsc --noEmit` に加えて **必ず `npm run build` も実行する**。
  型チェックは通るがビルド時の静的生成でのみ失敗するケースがある（useSearchParams＋Suspense境界なし等）。
