-- ============================================================
-- 036: sort_orderのfractional indexing化 + タスクカンバンのRealtime有効化
-- ============================================================
-- 背景（2026-07-31・財務支援事業部からの要望）:
--   これまでカードを1枚動かすたびに「移動先の列全体」を連番(0,1,2,...)で
--   振り直してupsertしていた。この方式は複数人が同じ列を同時に操作すると、
--   互いの振り直しが競合し、片方の変更がもう片方の書き込みで巻き戻される
--   （「同時に編集していて内容が消える」という報告の一因）。
--
--   sort_orderをINTEGERからNUMERICに変え、カード移動時は「移動したカード
--   1枚分」だけを前後2枚の中間値として計算・書き込む（フロント側対応と対）。
--   これにより日常操作が1行書き込みになり、他人の同時編集と競合する面積が
--   大幅に小さくなる。
--
--   あわせてtask_meta / task_kanban_stagesをsupabase_realtimeパブリケーションに
--   追加し、フロントのpostgres_changes購読で他ユーザーの変更を手動リロードなしに
--   反映できるようにする。
-- ============================================================

ALTER TABLE public.task_meta ALTER COLUMN sort_order TYPE NUMERIC USING sort_order::NUMERIC;

-- ─── 並び順の正規化RPC ──────────────────────────────────────────
-- fractional indexingで隙間が枯渇した列を復旧する。DBに現存する行だけを
-- 見て等間隔（1024刻み）に振り直す。ローカルキャッシュは一切参照しないため、
-- 旧・復旧ボタン（ローカルの状態をまとめてpushしていた）とは異なり、
-- 他ユーザーの直近の変更を巻き戻すことがない。
CREATE OR REPLACE FUNCTION public.normalize_task_kanban_sort_order(p_stage_id TEXT, p_division_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_super_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- NULL三値論理の教訓（過去に複数回踏んだ罠）: is_super_adminはCOALESCEで
  -- 確定boolean化し、IF NOT(...)がNULLで素通りしないようにする
  is_super_admin := COALESCE(
    (SELECT usr.role = 'super_admin' FROM public.users usr WHERE usr.id = auth.uid()),
    FALSE
  );

  IF NOT (
    is_super_admin
    OR EXISTS (
      SELECT 1 FROM public.user_divisions ud
      WHERE ud.user_id = auth.uid() AND ud.division_id = p_division_id
    )
  ) THEN
    RAISE EXCEPTION 'not permitted to normalize this division''s task kanban';
  END IF;

  WITH ordered AS (
    SELECT tm.activity_id,
           ROW_NUMBER() OVER (ORDER BY tm.sort_order NULLS LAST, tm.updated_at) AS rn
    FROM public.task_meta tm
    JOIN public.activities a ON a.id = tm.activity_id
    WHERE tm.kanban_stage_id = p_stage_id
      AND (
        (a.target_type = 'contact' AND EXISTS (
          SELECT 1 FROM public.contacts c WHERE c.id = a.target_id AND c.division_id = p_division_id
        ))
        OR (a.target_type = 'deal' AND EXISTS (
          SELECT 1 FROM public.deals d WHERE d.id = a.target_id AND d.division_id = p_division_id
        ))
      )
  )
  UPDATE public.task_meta tm
  SET sort_order = ordered.rn * 1024
  FROM ordered
  WHERE tm.activity_id = ordered.activity_id;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_task_kanban_sort_order(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_task_kanban_sort_order(TEXT, UUID) TO authenticated;

-- ─── Realtime有効化 ──────────────────────────────────────────────
-- postgres_changesで購読できるようにする。RLSは既存のtask_meta_select /
-- task_kanban_stages_selectがそのまま適用される想定だが、Supabaseプロジェクトの
-- 設定・プランによって挙動が異なりうるため、本番適用後に必ず2アカウントで
-- 実機確認すること（同事業部/他事業部/未担当タスク/担当変更直後の4ケース）。
-- 既にダッシュボードのトグル等で登録済みの場合に「already member of
-- publication」で本マイグレーション全体が失敗しないよう、未登録の場合のみ追加する。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'task_meta'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_meta;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'task_kanban_stages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_kanban_stages;
  END IF;
END $$;
