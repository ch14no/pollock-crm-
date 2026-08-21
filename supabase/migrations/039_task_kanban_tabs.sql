-- ============================================================
-- 039: タスクカンバンタブ（任意、事業部ごと）
-- ============================================================
-- 商談カンバンの「パイプラインタブ」（007_pipeline_tabs.sql）と同じ考え方を
-- タスクカンバンにも追加する。tab_id はNULL許容で、タブ0件の事業部は
-- 現状の挙動そのもの（完全に追加・opt-in機能、既存事業部への影響ゼロ）。
--
-- pipeline_stages→pipeline_tabsは単一列FK＋複合FKの2本構成だが、同一
-- ターゲットテーブルへの複数FKはPostgRESTのembedでPGRST201衝突を起こす
-- 構造（2026-08-20にdeals→contactsの2本FKで全事業部の商談取得が全滅した
-- 実例あり）。task_kanban_stages→task_kanban_tabsは複合FK1本のみとし、
-- 危険な構造自体を持ち込まない。
-- ============================================================

-- ─── タブテーブル ────────────────────────────────────────────
CREATE TABLE public.task_kanban_tabs (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID         NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (division_id, name),
  UNIQUE (id, division_id)   -- 複合FKの参照先
);

CREATE INDEX idx_task_kanban_tabs_division ON public.task_kanban_tabs(division_id, sort_order);

ALTER TABLE public.task_kanban_tabs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_kanban_tabs_select" ON public.task_kanban_tabs
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- 025/037と同一パターン: super_admin（所属不問） OR 当該事業部所属のmanager
CREATE POLICY "task_kanban_tabs_manage" ON public.task_kanban_tabs
  FOR ALL USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
      AND (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
    )
  );

-- RLS以前のpermission denied防止（009/025の教訓）。
-- service_roleへのSELECT GRANTも付与（025・037で漏れて本番調査時に42501になった教訓）
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_kanban_tabs TO authenticated;
GRANT SELECT ON public.task_kanban_tabs TO service_role;

-- ─── task_kanban_stages への tab_id 列追加 ────────────────────
-- 複合FK1本のみ。tab_id=NULLの行はFK検査対象外（MATCH SIMPLE）＝未タブ化として合法
ALTER TABLE public.task_kanban_stages
  ADD COLUMN tab_id UUID;

ALTER TABLE public.task_kanban_stages
  ADD CONSTRAINT task_kanban_stages_tab_division_fk
  FOREIGN KEY (tab_id, division_id) REFERENCES public.task_kanban_tabs(id, division_id);
  -- ON DELETE指定なし（NO ACTION）＝配下に列が残るタブは削除できない（pipeline_stagesのRESTRICTと同等の効果）

CREATE INDEX idx_task_kanban_stages_tab ON public.task_kanban_stages(tab_id);

-- 既存の037テーブルにservice_role SELECTグラントが漏れていたので併せて解消
GRANT SELECT ON public.task_stage_user_visibility TO service_role;
GRANT SELECT ON public.task_kanban_stages TO service_role;

-- ─── タブ作成RPC（初回タブ作成時の既存ステージ一括移行を原子化） ─────────
-- pipeline版は「createPipelineTab→migrateUntabbedStagesToTab」を2リクエストに
-- 分けており「タブはできたが移行だけ失敗」という中途半端な状態を作り得る
-- （このプロジェクトで複数回踏んだ「多段書き込みの片側失敗」と同種のリスク）。
-- タスク版は作成＋初回移行を1つのRPCに閉じ込める。
--
-- DB行が無く DEFAULT_DIVISION_TASK_STAGES フォールバックで動いている事業部で
-- 初回タブを作る場合は、クライアントが現在表示中の列リストを
-- p_initial_stages として渡し、タブ作成と同時にDB化する。
CREATE OR REPLACE FUNCTION public.create_task_kanban_tab(
  p_division_id    UUID,
  p_name           TEXT,
  p_initial_stages JSONB DEFAULT NULL  -- [{"id","name","color","sort_order"}]
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_tab_id UUID;
  v_is_first BOOLEAN;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = auth.uid();
  -- v_role IS NULLをIF NOT(...)のNULL評価で素通りさせない（025/037と同一の定型ガード）
  IF v_role IS NULL OR NOT (
    v_role = 'super_admin'
    OR (v_role = 'manager' AND EXISTS (
      SELECT 1 FROM public.user_divisions
      WHERE user_id = auth.uid() AND division_id = p_division_id
    ))
  ) THEN
    RAISE EXCEPTION 'permission denied: task kanban tabs can only be managed by super_admin or a manager of the division';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'tab name must not be empty';
  END IF;

  v_is_first := NOT EXISTS (SELECT 1 FROM public.task_kanban_tabs WHERE division_id = p_division_id);

  INSERT INTO public.task_kanban_tabs (division_id, name, sort_order)
  VALUES (
    p_division_id, btrim(p_name),
    COALESCE((SELECT MAX(sort_order) + 1 FROM public.task_kanban_tabs WHERE division_id = p_division_id), 0)
  )
  RETURNING id INTO v_tab_id;

  IF v_is_first THEN
    IF EXISTS (SELECT 1 FROM public.task_kanban_stages WHERE division_id = p_division_id) THEN
      -- 既存のtab_id=NULL列を新タブへ一括付け替え（TEXT idは不変＝task_meta/visibilityは無傷）
      UPDATE public.task_kanban_stages SET tab_id = v_tab_id
      WHERE division_id = p_division_id AND tab_id IS NULL;
    ELSIF p_initial_stages IS NOT NULL AND jsonb_array_length(p_initial_stages) > 0 THEN
      -- デフォルト列フォールバックで動いていた事業部: 表示中の列をこの機会にDB化してタブ配下に置く
      INSERT INTO public.task_kanban_stages (division_id, id, name, color, sort_order, tab_id)
      SELECT p_division_id, s->>'id', s->>'name', COALESCE(s->>'color', 'gray'),
             COALESCE((s->>'sort_order')::int, 0), v_tab_id
      FROM jsonb_array_elements(p_initial_stages) AS s;
    ELSE
      -- タブだけ在って列が1本も無い事業部を作らない（表示・削除ガードの前提が崩れるため）
      RAISE EXCEPTION 'initial stages are required when the division has no kanban stages yet';
    END IF;
  END IF;

  RETURN v_tab_id;
END $$;

REVOKE ALL ON FUNCTION public.create_task_kanban_tab(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_task_kanban_tab(UUID, TEXT, JSONB) TO authenticated;

-- ─── replace_task_kanban_stages改修（p_tab_id追加＋visibility消失バグ修正） ──
-- 【既存バグ修正】task_stage_user_visibility（037）はON DELETE CASCADEで
-- task_kanban_stagesに紐づいており、この関数のDELETE→INSERT（同一idで復元）でも
-- CASCADEが先に発火して消えたままになる。すなわち列を1つ追加・並び替えするたびに
-- その事業部の個人ビュー表示列設定が全ユーザー分サイレントに全消えしていた
-- （fail-open設計のため「なぜか全列表示に戻る」as見え、気づきにくい不具合）。
-- 置換前にスナップショットし、置換後も実在するstage_idの分だけ復元する。
--
-- 同名関数のオーバーロードを残すとPostgRESTがPGRST203（関数解決の曖昧性）で
-- 呼び出しごと失敗するため、DROPしてから3引数版を作る。p_tab_idはDEFAULT NULLとし、
-- デプロイ済みの旧フロントコード（2引数呼び出し）もそのまま動くようにする
-- （＝SQL先行適用が安全になる）。
DROP FUNCTION IF EXISTS public.replace_task_kanban_stages(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.replace_task_kanban_stages(
  p_division_id UUID,
  p_stages      JSONB,
  p_tab_id      UUID DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_vis  JSONB;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = auth.uid();
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

  -- p_tab_idの事業部整合を明示チェック（複合FKでも弾かれるが、エラーメッセージを分かりやすくする）
  IF p_tab_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.task_kanban_tabs WHERE id = p_tab_id AND division_id = p_division_id
  ) THEN
    RAISE EXCEPTION 'tab % does not belong to division %', p_tab_id, p_division_id;
  END IF;

  -- 空リストの扱い:
  --  * p_tab_id IS NULL（従来モード）: 従来どおり禁止（「未設定」と区別不能のため）
  --  * p_tab_id 指定: タブを空にする操作は許可（タブ削除の前提となるため）。
  --    ただし置換後に事業部全体の列が0本になる場合は下の検査でロールバックする
  IF p_tab_id IS NULL AND (p_stages IS NULL OR jsonb_array_length(p_stages) = 0) THEN
    RAISE EXCEPTION 'stages must not be empty';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('stage_id', stage_id, 'user_id', user_id))
    INTO v_vis
  FROM public.task_stage_user_visibility
  WHERE division_id = p_division_id;

  IF p_tab_id IS NULL THEN
    DELETE FROM public.task_kanban_stages WHERE division_id = p_division_id AND tab_id IS NULL;
  ELSE
    DELETE FROM public.task_kanban_stages WHERE division_id = p_division_id AND tab_id = p_tab_id;
  END IF;

  INSERT INTO public.task_kanban_stages (division_id, id, name, color, sort_order, tab_id)
  SELECT p_division_id, s->>'id', s->>'name', COALESCE(s->>'color', 'gray'),
         COALESCE((s->>'sort_order')::int, 0), p_tab_id
  FROM jsonb_array_elements(COALESCE(p_stages, '[]'::jsonb)) AS s;

  IF NOT EXISTS (SELECT 1 FROM public.task_kanban_stages WHERE division_id = p_division_id) THEN
    RAISE EXCEPTION 'division must keep at least one kanban stage';
  END IF;

  INSERT INTO public.task_stage_user_visibility (division_id, stage_id, user_id)
  SELECT p_division_id, e->>'stage_id', (e->>'user_id')::uuid
  FROM jsonb_array_elements(COALESCE(v_vis, '[]'::jsonb)) AS e
  WHERE EXISTS (
    SELECT 1 FROM public.task_kanban_stages s
    WHERE s.division_id = p_division_id AND s.id = e->>'stage_id'
  )
  ON CONFLICT (division_id, stage_id, user_id) DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public.replace_task_kanban_stages(UUID, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_task_kanban_stages(UUID, JSONB, UUID) TO authenticated;

-- ─── Realtime publication追加 ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'task_kanban_tabs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_kanban_tabs;
  END IF;
END $$;
