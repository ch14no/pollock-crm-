# pollock-crm 引継ぎメモ（.claude/CLAUDE.md）

> コーディング規約・検証コマンドはリポジトリ直下の `CLAUDE.md`（＋`AGENTS.md`）が正。
> システム全体像は `docs/handover-report.md`、M&A要望24項目は `docs/ma-feedback-progress-report.md` が正。
> 本ファイルは「マイグレーション適用状況・最近の変更・残タスク・デプロイ方法」の引継ぎ用。

## デプロイ
- GitHub `ch14no/pollock-crm-` に push → Vercel が自動デプロイ（本番: https://pollock-crm.vercel.app ）。
- **DBマイグレーションは自動適用されない**。`supabase/migrations/NNN_*.sql` を書いても、Supabaseダッシュボード → SQL Editor に手動で貼って実行する運用。frontendのpushとSQL適用は別手順（コード先行 or SQL先行かは変更内容による）。
- service_roleキーはPostgREST/Auth用でDDL（CREATE POLICY/FUNCTION等）は実行不可。ポリシー/関数変更は必ずSQL Editorでユーザーに実行してもらう。

## マイグレーション適用状況（2026-07-24時点）
- **001〜035まで全て本番適用済み**。
- 主要な近年分:
  - 025 タスクカンバン列のDB共有化（`task_kanban_stages` + RPC `replace_task_kanban_stages`）
  - 026 activities_delete ポリシー新設（削除がRLSで無音0行だった不具合）
  - 027/028 activities_select を同一事業部で相互閲覧可に（`shares_division_with` SECURITY DEFINER関数）
  - 029 タスク担当再アサイン（`reassign_task` / `list_division_members`）
  - 030 activities_update・task_meta_select/update を同一事業部メンバーに開放
  - 031 task_meta.sort_order（列内並び替え）
  - 032 user_divisions.show_as_task_assignee（super_adminのタスク看板担当候補opt-in）
  - 033 task_meta.updated_at + BEFOREトリガ（DBタイムスタンプ再同期用）
  - 034 未担当（user_id IS NULL）タスクのRLS修正（`shares_division_with_activity_target`）
  - 035 `replace_pipeline_stages`（パイプラインステージ保存のトランザクション化）

## 2026-07-24セッションの変更（要点）
タスクカンバン同期の連続不具合を根本修正。
1. 列内ドラッグ並び替え追加（`@dnd-kit/sortable` の `arrayMove`。`canReorder=scope==='team'` のときのみ永続化）。
2. 未担当タスクがsuper_admin以外に操作不能だった重大RLSバグを034で修正。
3. 削除済みタスクが列全体の一括upsertを巻き添えにする不具合を修正（`upsertTaskOrders` を `Promise.allSettled` で1行ずつ独立化し `{failedIds}` を返す。呼び出し側は失敗行のみロールバック/報告）。
4. 失敗トーストに `formatErrorDetail`（`lib/utils.ts`）でエラー詳細を表示。
5. DBタイムスタンプ再同期（`hydrateTaskMeta` / `taskMetaUpdatedAt`）。
6. 調査副産物: 同種の「一括書き込みall-or-nothing」バグ2件を修正 — `api/admin/users/route.ts`（user_divisions一括insertエラー未チェック→無所属化。PUTをupsert→不要行削除に変更）／`lib/db/divisions.ts` のパイプラインステージ保存を035 RPCへ委譲。

## 残タスク・待ち
- 実機確認: 石川/香奈で「削除→別の人が同期」がエラーにならないか。管理者でステージ保存・ユーザー事業部編集が正常か。
- 齋藤PCで山﨑アカウント→設定→タスクカンバン設定「列構成を全メンバーに共有」を押す（他PCが先に列編集すると齋藤PCのローカル構成が失われるため順番厳守。継続中）。
- レスポンシブUI総点検（依頼済み・未着手）。2026-07-12 UX調査の既知課題の対応方針決定。
- 低優先: `api/admin/users/route.ts` POSTロールバック時の `deleteUser` エラー未チェック（既存パターン・極端な縁）。

## RLS/SECURITY DEFINER の再発しやすい罠（このプロジェクト固有の教訓）
- **NULL三値論理**: `IF NOT (a OR b OR c)` は operand がNULLだと素通りする。roleやuser_id比較がNULLになりうる経路を必ず潰す（`COALESCE(...,FALSE)`・明示的 `IS NOT NULL` ガード）。
- **RETURNS TABLE の列名衝突**: 出力列名（id/role等）と本文の無修飾カラム参照が衝突すると実行時 `42702`。テーブルエイリアスで修飾する。CREATE時は通り実行時のみ失敗する。
- **ポリシー式から他のRLS有効テーブルを参照**すると、その参照にも相手のRLSがかかる。事業部横断の所属判定は必ずSECURITY DEFINER関数（`shares_division_with` / `shares_division_with_activity_target`）に閉じ込める。
- 「Success」表示だけでは関数が動く保証にならない。適用後に一度呼ぶか、フロントでRPCエラーをthrow/toastする。
- 一括書き込み（配列 `.upsert`/`.insert`、delete→insert）は1件の失敗で全体が巻き添えになる。行別化（allSettled）か単一トランザクション（RPC）にする。
