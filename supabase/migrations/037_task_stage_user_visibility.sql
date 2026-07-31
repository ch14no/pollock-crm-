-- ============================================================
-- 037: 個人ビューでの担当外タスクカンバン列の表示制御
-- ============================================================
-- 背景（2026-07-31・財務支援事業部からの要望）:
--   「個人」を選択したとき、その人が普段触らない列（例: 融資担当者にとっての
--   補助金列）が表示され続けスクロールが必要で使いづらい、という報告。
--   管理者（super_admin/manager）が事後的に「このユーザーの個人ビューでは
--   この列だけ表示する」というallowlistを設定できるようにする。
--
--   設定行が1件も無いユーザーはfail-open（全列表示）とする。「行が無い＝
--   隠す」にすると設定漏れでタスクが見えなくなる事故になるため
--   （034で踏んだ「NULLの解釈を誤ると権限判定がおかしくなる」教訓と同種の
--   注意が必要な箇所）。
--
--   この絞り込みは純粋にUIの利便機能であり、セキュリティ境界ではない
--   （タスク自体のRLSは既存のactivities_select/task_meta_selectのまま不変）。
-- ============================================================

CREATE TABLE public.task_stage_user_visibility (
  division_id UUID        NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  stage_id    TEXT        NOT NULL,
  user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (division_id, stage_id, user_id),
  FOREIGN KEY (division_id, stage_id) REFERENCES public.task_kanban_stages(division_id, id) ON DELETE CASCADE
);

ALTER TABLE public.task_stage_user_visibility ENABLE ROW LEVEL SECURITY;

-- 読み取りは全ログインユーザー（自分の設定・同僚の設定を見ること自体に実害はない）
CREATE POLICY "task_stage_user_visibility_select" ON public.task_stage_user_visibility
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- 管理はtask_kanban_stages_manage（025）と同じ基準: super_admin（所属不問）
-- または当該事業部所属のmanager
CREATE POLICY "task_stage_user_visibility_manage" ON public.task_stage_user_visibility
  FOR ALL USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      division_id IN (
        SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid()
      )
      AND (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
    )
  );

-- RLS以前のpermission deniedを防ぐ（009/025と同じ教訓）
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_stage_user_visibility TO authenticated;

CREATE INDEX idx_task_stage_user_visibility_division_user
  ON public.task_stage_user_visibility(division_id, user_id);

-- ─── 特定ユーザー×事業部のallowlistを原子的に置換するRPC ─────────
-- クライアントからのdelete→insert 2リクエスト方式は、insertだけ失敗すると
-- 設定が消えたまま（＝fail-openで全列表示に戻る、実害は小さいが）中途半端に
-- なりうるため、025のreplace_task_kanban_stagesと同じ方針で1トランザクションにする。
CREATE OR REPLACE FUNCTION public.replace_task_stage_visibility(
  p_division_id UUID,
  p_user_id     UUID,
  p_stage_ids   TEXT[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = auth.uid();
  -- v_role IS NULLをIF NOT(...)のNULL評価で素通りさせないよう明示的に拒否する
  IF v_role IS NULL OR NOT (
    v_role = 'super_admin'
    OR (
      v_role = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.user_divisions
        WHERE user_id = auth.uid() AND division_id = p_division_id
      )
    )
  ) THEN
    RAISE EXCEPTION 'permission denied: stage visibility can only be managed by super_admin or a manager of the division';
  END IF;

  DELETE FROM public.task_stage_user_visibility
  WHERE division_id = p_division_id AND user_id = p_user_id;

  -- 空配列/NULLは「制限なし（全列表示）」を意味し、行を作らないだけでよい
  IF p_stage_ids IS NOT NULL AND array_length(p_stage_ids, 1) > 0 THEN
    INSERT INTO public.task_stage_user_visibility (division_id, stage_id, user_id)
    SELECT p_division_id, s, p_user_id FROM unnest(p_stage_ids) AS s;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_task_stage_visibility(UUID, UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_task_stage_visibility(UUID, UUID, TEXT[]) TO authenticated;

-- Realtime対象にも追加（設定画面での変更を他端末の個人ビューへ即座に反映するため）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'task_stage_user_visibility'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_stage_user_visibility;
  END IF;
END $$;
