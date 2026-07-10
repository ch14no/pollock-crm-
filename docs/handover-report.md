# Pollock Core CRM 引き継ぎレポート

**作成日**: 2026-07-10
**対象読者**: 本プロジェクトに参加していないClaude（Claude.aiプロジェクト等）および開発関係者
**目的**: 改修要件の整理・Claude Code向け改修指示書の作成に必要な、システムの全体像を提供する

---

## 1. システム概要

**Pollock Core CRM**は、株式会社ポロック（SES・人材派遣・介護医療人材・財務支援・M&A等を営むグループ企業）の**グループ横断・事業部制CRM**。顧客（リード）・商談・活動・タスクを事業部単位で管理し、事業部間で顧客を引き継ぐ「**トスアップ**」機能を中核に持つ。

- **リポジトリ**: `C:\Users\azuma\pollock-crm\`（GitHub: `ch14no/pollock-crm-`）
- **デプロイ**: Vercel（GitHubのmainへのpushで自動デプロイ）。本番URL: Vercelダッシュボード参照（リポジトリ内に記録なし）
- **状態**: 本番運用中。実Supabaseに接続済みで、社内から実際のバグ報告・要望が届く段階（docs/bug-report-*.md参照）

### 兄弟システム（グループアプリ）
サイドバーから相互リンクしている別システム：
| アプリ | URL | 関係 |
|---|---|---|
| タレントマネジメント | company-management-app-v2.vercel.app | リンクのみ |
| ポロック杯 | pollock-cup.vercel.app | **事業部マスタをWebhookで同期**（後述） |
| ポータル | pollock-portal.vercel.app | リンクのみ |

---

## 2. 技術スタック

| 領域 | 採用技術 | 備考 |
|---|---|---|
| フレームワーク | **Next.js 16.2.6**（App Router）+ React 19.2.4 + TypeScript strict | Next.js 16は破壊的変更あり（§9参照） |
| DB/認証 | **Supabase**（PostgreSQL + Auth + RLS） | `@supabase/ssr` 0.10 + `supabase-js` 2.105 |
| 状態管理 | **Zustand 5**（persistでlocalStorage永続化、キー名 `pollock-crm`） | |
| スタイル | Tailwind CSS 4 + lucide-react + react-hot-toast | |
| その他 | @dnd-kit（カンバンD&D）、papaparse（CSV）、@anthropic-ai/sdk（名刺OCR）、@tanstack/react-virtual、date-fns | |

**検証コマンド**（コード変更後の必須手順）: `npx tsc --noEmit` に加えて **必ず `npm run build`**（型チェック通過でもビルド時静的生成のみで失敗するケースがあるため）。

---

## 3. ユーザーとロール

`users.role` で3段階:

| ロール | 権限 |
|---|---|
| `super_admin` | 全事業部の閲覧・編集、ユーザー管理・事業部管理・パイプライン/カスタムフィールド/商品マスタの設定（/settings内）。事業部未所属でも書き込み可（RLSにバイパス条項） |
| `manager` | 所属事業部の編集＋削除権限、ダッシュボードのマネージャービュー |
| `user` | 所属事業部の閲覧・編集（削除不可） |

- ユーザーは `user_divisions` で複数事業部に所属可（`is_primary`あり）。ヘッダーの事業部セレクタで閲覧対象を切替。
- 閲覧（SELECT）は2次マイグレーションで**全認証ユーザーに緩和**済み（contacts/deals/activities/companies）。編集は自事業部のみ。

---

## 4. 画面一覧（全ページ `'use client'`）

| ルート | 機能 |
|---|---|
| `/login` | メール+パスワードログイン（Supabase Auth）。デモモードボタンあり |
| `/dashboard` | ホーム。個人/チーム/マネージャーの3ビュー。KPIカード・デイリーミッション・タイムライン・パイプライン進捗 |
| `/contacts` | 顧客一覧（約1200行の大型ページ）。リスト/カード/会社別ビュー、検索、拠点・ステータス・カスタムフィールドのフィルタ、CSVエクスポート、一括削除、住所→拠点タグ一括付与 |
| `/contacts/new` | 新規顧客登録。手動入力＋**名刺OCR**（表裏画像→Claude Vision APIで8項目抽出） |
| `/contacts/[id]` | 顧客詳細（3ペイン）。プロフィール編集、顧客ステータス（星/ハート/急上昇/ブラックリスト/トロフィー）、タグ、タイムライン、商談・活動、トスアップ起動 |
| `/contacts/company/[id]` | 会社別詳細。会社に紐づく担当者一覧・会社宛活動 |
| `/deals` | 商談カンバン。ステージ別D&D、滞留アラート、受注時紙吹雪。事業部によっては**複数タブ**（例: M&A事業部の売り手/買い手ボード） |
| `/activities` | 活動履歴（電話/メール/面談/タスク/トスアップ/メモ）。自分の作成分のみ編集・削除可 |
| `/tasks` | タスク管理。**アイゼンハワー4象限ビュー**＋カンバンビュー、長期課題（challenges） |
| `/tossups` | トスアップ一覧。全て/受信/送信フィルタ、ステータス（未読→対応中→完了） |
| `/analysis` | 分析。カスタムフィールド別の顧客分布チャート等 |
| `/import` | CSVインポート/エクスポート。3ステップ（アップロード→列マッピング→実行）、重複時スキップ/更新選択 |
| `/settings` | 設定（約1460行の大型ページ）。プロフィール・通知に加え、super_admin向けの**ユーザー管理・事業部管理・パイプラインステージ/タブ・カスタムフィールド・商品マスタ** |

レイアウト: `(app)/layout.tsx` がSidebar/Header/BottomNav（モバイル）＋共通モーダル（トスアップ/活動/商談）を持ち、マウント時にユーザープロフィール・事業部をSupabaseから取得してZustandに投入する。

---

## 5. APIルート

| エンドポイント | 役割 |
|---|---|
| `POST /api/ocr/business-card` | 名刺OCR。Anthropic API（claude-sonnet-5、JSONスキーマ強制出力）で表裏2枚から氏名・会社名等8項目を抽出。Bearerトークン認証、画像は合計32MB上限・JPEG/PNG/GIF/WebP限定 |
| `POST /api/webhooks/division-sync` | **pollock-cup（別Supabaseプロジェクト）からの事業部同期受信**。create/renameのみ（deleteは非伝播）。`x-division-sync-secret`ヘッダー認証、冪等性チェックで無限ループ防止。認証プロキシの対象外 |
| `POST/PUT/DELETE /api/admin/users` | ユーザーCRUD。呼び出し元JWTでsuper_admin確認後、service_roleクライアントでauth.usersと`users`/`user_divisions`を操作 |
| `POST/PUT/GET/DELETE /api/admin/divisions` | 事業部CRUD。削除時はcontacts/deals/tossupsの参照件数をチェックし、参照ありは拒否 |

---

## 6. DBスキーマ（Supabase / PostgreSQL）

### 主要テーブル

| テーブル | 役割 | 主要カラム |
|---|---|---|
| `users` | ユーザー（auth.users挿入時にトリガーで自動作成） | id(=auth.uid), name, email, role |
| `divisions` | 事業部マスタ | id, name, color_code |
| `user_divisions` | ユーザー⇔事業部（多対多） | user_id, division_id, is_primary |
| `companies` | 会社マスタ（全事業部共通） | id, name, corporate_number, website |
| `contacts` | 顧客/リード | company_id, **division_id**, assigned_user_id, name, email, phone, position, tags(TEXT[]), custom_attributes(JSONB), notes, address※, department※ |
| `pipeline_stages` | 事業部別の商談ステージ | division_id, name, sort_order, is_won, is_lost, tab_id |
| `pipeline_tabs` | 事業部内の複数パイプライン系統（例: M&Aの売り手/買い手） | division_id, name, sort_order |
| `deals` | 商談 | contact_id, division_id, title, amount, stage_id, close_date |
| `activities` | 活動ログ | target_type(contact/deal/company), target_id, user_id, activity_type(call/email/meeting/task/tossup/note), title, memo, due_date, status(todo/doing/done) |
| `tossups` | 事業部間引き継ぎ | from_user_id, from_division_id, to_division_id, company_id, contact_id, message, status(unread/in_progress/closed) |
| `task_meta` | タスクの4象限メタ | activity_id(PK), urgency, importance, scope(personal/team), kanban_stage_id※ |
| `challenges` | 長期課題 | division_id, user_id, title, scope, deadline, status |
| `contact_statuses` | 顧客ステータス | contact_id + status(star/heart/rising/blacklist/trophy) 複合PK |
| `division_custom_fields` | 事業部別カスタム項目定義 | division_id, name, label, field_type(text/select/number/boolean), options[] |
| `contact_custom_values` | 顧客のカスタム値 | contact_id + field_id 複合PK, value |

※印: **マイグレーションファイルに未反映の手動ALTER列**（§9-3参照）。

### マイグレーション（`supabase/migrations/001〜009`）
001 初期スキーマ＋シード ／ 002 SELECT全ユーザー緩和 ／ 003 タスク・ステータス・カスタムF拡張 ／ 004 テストデータ ／ 005 事業部同期Webhookトリガー（pg_net、**手動適用・本番適用済み2026-07-02**）／ 006 super_adminのRLSバイパス ／ 007 pipeline_tabs（手動）／ 008 M&Aタブseed（手動・一回限り）／ 009 pipeline_tabsのGRANT修正

**運用上の重要点**: 本番DBへのマイグレーションは**Supabaseダッシュボードでの手動実行**。スキーマ変更を伴う改修では「SQLファイル作成＋手動適用手順の提示」までが成果物。

### RLS概要
- SELECT: contacts/deals/activities/companies/divisions は全認証ユーザー可。tossupsは送受信事業部＋super_adminのみ
- INSERT/UPDATE: 自分の所属事業部のみ（super_adminは無条件許可）。DELETE: super_admin/manager
- トリガー: `handle_new_user`（プロフィール自動作成）、`update_updated_at`、`notify_division_sync`（事業部変更→pollock-cupへWebhook）

---

## 7. アーキテクチャ上の要点

### デモモードと本番モードの2系統
- `NEXT_PUBLIC_SUPABASE_URL` が `https://placeholder.supabase.co` のとき**デモモード**（Supabase不要、`src/lib/mock-data.ts` のモックデータで全画面動作、`pollock-demo-session` Cookieで認証バイパス）
- 実URLなら**本番モード**（Supabase Auth＋実DB）
- 各画面・コンポーネントは `isSupabaseConfigured()` で分岐。**新機能は原則この分岐を両対応させる**のが既存パターン（本番のみでよい場合は要件で明示すること）
- 注意: デモ判定が「完全一致」（proxy.ts、OCR API）と「部分一致」（isSupabaseConfigured）の2実装で混在

### 認証ミドルウェア
Next.js 16では middleware が `src/proxy.ts`（`export function proxy`）にリネームされている。未ログイン→/loginリダイレクト、`/api/webhooks`は認証スキップ。

### 状態管理の二重構造（最重要の設計負債）
`src/store/appStore.ts`（約560行）がDBのミラー＋ローカル差分を大量に保持する（localActivities/localDeals/localTossups、taskMeta、contactStatuses、各種マスタ…）。**DBとlocalStorageに同種データが併存**し、「DB取得結果＋ローカル分をID重複除去して結合」するパターンが各所にある。過去バグ（活動2重表示、カンバン初期表示ずれ等）の温床。**データ表示系の改修では、どちらを正とするかを要件段階で決めること。**

### データアクセス層
`src/lib/db/*.ts` にドメイン別のfetch/create/update/delete関数（activities, companies, contacts, deals, divisions, tossups, users, challenges）。型は `src/lib/supabase/types.ts`（DB型）と `src/types/database.ts`（アプリ用ドメイン型）の2層。

---

## 8. 環境変数（キー名のみ）

| キー | 用途 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase接続（placeholderならデモモード） |
| `SUPABASE_SERVICE_ROLE_KEY` | ユーザー管理API用（サーバー専用、Vercel側のみ設定） |
| `DIVISION_SYNC_SECRET` | pollock-cupとの事業部同期Webhook共有シークレット（Vercel側のみ） |
| `ANTHROPIC_API_KEY` | 名刺OCR（Claude Vision）用 |

---

## 9. 既知の罠・技術的負債（改修時に必ず意識すること）

1. **Next.js 16は訓練データと異なる**: middleware→`src/proxy.ts`、`cookies()`は非同期（`await cookies()`）等。リポジトリのAGENTS.mdが「`node_modules/next/dist/docs/` を読め」と指示している。
2. **`npm run build` まで検証必須**: 型チェック通過でも静的生成のみで失敗する事例あり（useSearchParams＋Suspense境界なし等、実際に本番デプロイが失敗し続けた実績がある）。
3. **マイグレーション未反映の手動ALTER列がある**: `contacts.address` / `contacts.department` / `task_meta.kanban_stage_id` は型定義とコードには存在するが、マイグレーションSQLに含まれていない（docs/admin-manual.md・bug-report-0526.mdに手動ALTER手順として記載）。**DB新規構築やスキーマ改修時は要注意。**
4. **pollock-cupとの事業部同期は疎結合**: DBトリガー（pg_net）→HTTP Webhook。create/renameのみ伝播、delete非伝播（孤立レコード許容）。事業部まわりの改修は両システムへの影響を確認すること。
5. **リアルタイム未実装**: 他ユーザーの変更反映はページリロードが必要（既知の残課題）。
6. **巨大ページファイル**: `/contacts`（約1200行）、`/settings`（約1460行）はコンポーネント分割されていない。これらの改修は影響範囲が広くなりやすい。
7. **モックデータに実在メールアドレス**: `mock-data.ts` のMOCK_ADMIN_USERは `azuma_c@pollock.co.jp`（super_admin固定）。
8. **デモモードのCookie設定コードが不明瞭**: `pollock-demo-session` を参照するコードはあるがセットする箇所がsrc内に見当たらない。デモまわりの改修時は実機確認が必要。

---

## 10. ドキュメント・開発運用

| ファイル | 内容 |
|---|---|
| `CLAUDE.md` | コーディング規約（strict、any禁止、`@/`絶対import、PascalCase、検証は`npm run build`必須） |
| `AGENTS.md` | Next.js 16の破壊的変更への警告 |
| `docs/admin-manual.md` | システム管理者マニュアル（権限表、環境変数、マイグレ手順、各種管理操作、FAQ） |
| `docs/bug-report-0526.md` | 2026-05-26受領バグ8件の対応記録 |
| `docs/bug-report-response.md` | バグ12件＋要望8件の対応レポート |

**開発フロー**: 修正完了後は git commit & push まで実施（Vercelが自動デプロイ）。コード変更後は verifier（型チェック＋ビルド）での検証を経てから完了報告する運用。

**コーディング規約要点**: TypeScript strict / any原則禁止 / コンポーネントはfunction宣言＋Propsはinterface / import は `@/` 絶対パス / エラーハンドリング明示 / アクセシビリティ対応（aria・キーボード操作）。

---

## 11. 直近の開発履歴（新しい順・抜粋）

- CSVインポート: 担当者名が空でも会社名があれば企業だけ先行登録
- 名刺OCR: Claude Sonnet 5 Vision APIで本実装（プレビュー90度回転ボタン付き）
- ログイン時に自分の所属事業部を自動選択
- 事業部別パイプラインタブ（M&Aの売り手/買い手ボード）＋本番seed適用
- ナビゲーション進捗インジケータ、設定画面の説明文、RLS修正
- 顧客一覧のクライアントフィルタ・会社詳細ビュー・事業部CRUD・カンバンのスケーラビリティ改善
