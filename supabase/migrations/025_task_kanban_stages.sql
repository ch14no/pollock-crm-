-- ============================================================
-- タスクカンバンの列定義をDBで共有する（不具合修正）
-- ============================================================
-- これまでタスクカンバンの列（divisionTaskStages）はブラウザの
-- localStorageにのみ保存されており、設定画面で責任者が列を編集しても
-- 同じPCの他アカウントには見える一方、他のPCには一切反映されなかった。
-- 商談パイプライン（pipeline_stages）と同様にDBを真実源にする。
--
-- id はUUIDではなくTEXT。既存のクライアント生成ID
-- （'todo' / 'making' / 'stage-<timestamp>' 等）が task_meta.kanban_stage_id
-- と各端末の localStorage（taskStageMap）に保存済みのため、
-- 同じIDをそのまま保持して既存のタスク⇔列の紐付けを壊さない。
-- ============================================================

CREATE TABLE public.task_kanban_stages (
  division_id UUID         NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  id          TEXT         NOT NULL,
  name        VARCHAR(100) NOT NULL,
  color       VARCHAR(20)  NOT NULL DEFAULT 'gray',
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (division_id, id)
);

ALTER TABLE public.task_kanban_stages ENABLE ROW LEVEL SECURITY;

-- 読み取りは全ログインユーザー。
-- 管理は「super_admin（所属不問） OR 当該事業部所属のmanager」。
-- ※001の旧stages_manage（super_adminにも所属を要求）ではなく、
--   006_super_admin_rls_bypass.sql で修正された現行パターンに合わせる。
--   設定画面のタスクカンバン設定パネルはsuper_adminが全事業部を
--   選択して操作するため、所属を要求すると書き込みが全滅する。
CREATE POLICY "task_kanban_stages_select" ON public.task_kanban_stages
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "task_kanban_stages_manage" ON public.task_kanban_stages
  FOR ALL USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      division_id IN (
        SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid()
      )
      AND (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
    )
  );

-- RLS以前のpermission deniedを防ぐ（009_pipeline_tabs_grants.sqlと同じ教訓）
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_kanban_stages TO authenticated;

CREATE INDEX idx_task_kanban_stages_division
  ON public.task_kanban_stages(division_id, sort_order);

-- ─── 列リストの原子的な置換関数 ─────────────────────────────────
-- クライアントからの delete→insert 2リクエスト方式は、insertだけ失敗すると
-- 事業部の列定義が丸ごと消える・連打で交錯して重複PKエラーになる欠陥があるため、
-- 1トランザクションで置換するRPCにまとめる。
-- SECURITY DEFINERなので冒頭で権限を明示チェックする（上のRLSポリシーと同条件）。
-- 権限が無い場合はサイレントに0件更新せず、必ず例外で失敗を伝える。
CREATE OR REPLACE FUNCTION public.replace_task_kanban_stages(
  p_division_id UUID,
  p_stages      JSONB  -- [{"id","name","color","sort_order"}, ...]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = auth.uid();
  -- v_role IS NULL（users行が無い認証ユーザー）をIF NOT (...)のNULL評価で
  -- 素通りさせないよう、NULLを明示的に拒否する（RLSのNULL＝拒否と極性を揃える）
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
    RAISE EXCEPTION 'permission denied: task kanban stages can only be managed by super_admin or a manager of the division';
  END IF;

  -- 空リストでの全削除は「未設定」と区別できず他端末に伝播しないため禁止
  -- （クライアント側の最後の1列削除ガードの二重防御）
  IF p_stages IS NULL OR jsonb_array_length(p_stages) = 0 THEN
    RAISE EXCEPTION 'stages must not be empty';
  END IF;

  DELETE FROM public.task_kanban_stages WHERE division_id = p_division_id;
  INSERT INTO public.task_kanban_stages (division_id, id, name, color, sort_order)
  SELECT
    p_division_id,
    s->>'id',
    s->>'name',
    COALESCE(s->>'color', 'gray'),
    COALESCE((s->>'sort_order')::int, 0)
  FROM jsonb_array_elements(p_stages) AS s;
END $$;

REVOKE ALL ON FUNCTION public.replace_task_kanban_stages(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_task_kanban_stages(UUID, JSONB) TO authenticated;

-- task_meta.kanban_stage_id はコード上参照されているが、これを作成する
-- マイグレーションが存在しなかった（本番では手動追加されている可能性がある）。
-- 未追加の環境でも動くようここで保証する。
ALTER TABLE public.task_meta ADD COLUMN IF NOT EXISTS kanban_stage_id TEXT;
