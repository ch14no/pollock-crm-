-- ============================================================
-- 035: パイプラインのステージ一括保存をトランザクション化
-- ============================================================
-- 背景（2026-07-24・タスクカンバンの同期バグ調査中に発見した同種の別バグ）:
--   設定画面のステージ保存は upsertPipelineStages / upsertPipelineStagesForTab で
--   「その事業部/タブのステージを全DELETE → 新しい配列を一括INSERT」していた。
--   しかしDELETEとINSERTが別々のリクエスト（別トランザクション）だったため、
--   INSERTが1件でも失敗（name NOT NULL違反等）すると、DELETEだけ確定して
--   その事業部/タブのステージ定義が全消えし、商談カンバンが壊れる不具合があった
--   （task_metaの一括upsertと同じ「wipe-then-fail」構造）。
--
-- 方針:
--   DELETE+INSERTを1つの関数にまとめる。関数本体は単一トランザクションで
--   実行されるため、INSERTが失敗すればDELETEも巻き戻り、空のまま残らない。
--   SECURITY INVOKER（既定）とすることで、DELETE/INSERTには呼び出し元の権限で
--   既存のRLS（stages_manage: 同一事業部のmanager/super_admin のみ）がそのまま
--   適用される。権限述語を関数内に再実装しないため、判定漏れ・三値論理バグの
--   混入リスクが無い。
-- ============================================================

CREATE OR REPLACE FUNCTION public.replace_pipeline_stages(
  p_division_id UUID,
  p_tab_id      UUID,   -- NULL = 未タブ化（division直下）のステージ群
  p_stages      JSONB   -- [{ "name", "sort_order", "is_won", "is_lost" }, ...]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_tab_id IS NULL THEN
    DELETE FROM public.pipeline_stages
      WHERE division_id = p_division_id AND tab_id IS NULL;
  ELSE
    DELETE FROM public.pipeline_stages
      WHERE tab_id = p_tab_id;
  END IF;

  INSERT INTO public.pipeline_stages (division_id, tab_id, name, sort_order, is_won, is_lost)
  SELECT
    p_division_id,
    p_tab_id,
    s->>'name',
    (s->>'sort_order')::int,
    (s->>'is_won')::boolean,
    (s->>'is_lost')::boolean
  FROM jsonb_array_elements(COALESCE(p_stages, '[]'::jsonb)) AS s;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_pipeline_stages(UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_pipeline_stages(UUID, UUID, JSONB) TO authenticated;
