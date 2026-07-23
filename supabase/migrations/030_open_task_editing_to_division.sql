-- ============================================================
-- 030: タスクの編集・カンバン移動を同一事業部メンバーに開放
-- ============================================================
-- 背景（2026-07-23・財務支援事業部の実テストで発覚）:
--   029でタスクの「担当変更」だけを同一事業部メンバーに開放したが、
--   カードのドラッグ移動（カンバンステージ変更）とタイトル・メモ・期限の編集は
--   引き続き本人限定のままだった。実際に他メンバーへ再アサインされたタスクを
--   別の同僚がドラッグ移動しようとすると「ステージの同期に失敗しました」と
--   なった（task_meta_update が activity_id IN (本人のactivities) 限定だったため）。
--   ユーザーから「タスク自体を他の担当が編集できるようにしてほしい」と要望が
--   あり、本マイグレーションで対応する。
--
-- 変更点:
--   1. activities_update: 本人 or super_admin 限定だったUSING句に
--      shares_division_with(user_id) を追加し、同一事業部メンバーの
--      タイトル・メモ・期限・ステータス編集を許可する（027/028のSELECT・
--      026のDELETEと同じ「同一事業部なら閲覧・削除・編集可」という方針に揃える）。
--   2. task_meta_select / task_meta_update: 本人（+manager/super_admin）限定
--      だったのを同一事業部メンバーに広げる。これにより、他メンバーのタスクの
--      カンバンステージ（kanban_stage_id）が正しく読み書きできるようになる。
--      これが直っていなかったため、userロールのメンバーが同僚のタスクを見ると
--      実際のステージに関わらず常に先頭列に表示される副作用もあった
--      （fetchTaskKanbanStagesがRLSで0件になり、未設定＝先頭列フォールバックに
--      落ちていたため）。
--
-- 注意（意図的に対応しないスコープ）:
--   activities_update のUSING句を広げると、この行に対するUPDATE操作全般が
--   許可される。フロントエンドは updateActivityFields（title/memo/due_date
--   のみ）と reassign_task RPC（user_id専用、事業部一致等の追加検証あり）を
--   使い分けているため通常の利用では問題にならないが、理論上は同一事業部
--   メンバーが生のAPI呼び出しで user_id を直接書き換え、reassign_task の
--   追加チェック（新担当者も事業部を共有している必要がある等）を経由せずに
--   済ませることが可能ではある。社内向けツールでUIからその経路は提供されて
--   おらず、対象はもともとactivities_select（027/028）で閲覧可能な同一事業部
--   内に限られるため、実害は限定的と判断し許容する。カラム単位の権限分離
--   （GRANT UPDATE (title, memo, ...) と対になるトリガー等）は本マイグレーションの
--   スコープ外とし、必要になれば別途対応する。
-- ============================================================

DROP POLICY IF EXISTS "activities_update" ON public.activities;
CREATE POLICY "activities_update" ON public.activities
  FOR UPDATE USING (
    user_id = auth.uid()
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR public.shares_division_with(user_id)
  );

DROP POLICY IF EXISTS "task_meta_select" ON public.task_meta;
CREATE POLICY "task_meta_select" ON public.task_meta
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.id = task_meta.activity_id
        AND (
          a.user_id = auth.uid()
          OR public.shares_division_with(a.user_id)
          OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
        )
    )
  );

DROP POLICY IF EXISTS "task_meta_update" ON public.task_meta;
CREATE POLICY "task_meta_update" ON public.task_meta
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.id = task_meta.activity_id
        AND (
          a.user_id = auth.uid()
          OR public.shares_division_with(a.user_id)
          OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
        )
    )
  );
