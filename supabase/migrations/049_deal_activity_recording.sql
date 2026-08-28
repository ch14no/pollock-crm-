-- ============================================================
-- 049: 商談記録フォームの拡張（M&A事業部・酒田さん依頼 フェーズ4）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- 方針:
--   ①商談日時: 開始日時と終了日時を選べるようにしたい、という依頼。
--     既存の action_date（001から存在し全事業部の並び替え・絞り込みの基準として
--     広く使われている）を「開始日時」として引き続き使い、新たに end_at（終了日時、
--     任意）を追加する（action_dateのリネームは影響範囲が大きすぎるため回避）。
--   ②件名→顧客属性: activities は全事業部・全活動タイプ（電話/メール/面談/メモ/タスク）で
--     共有されるテーブルのため、文字通り件名を全廃すると他事業部のタスク作成
--     （タイトル必須・カンバン表示に使用）が壊れる。ユーザー確認の上、
--     「対象が商談 かつ タスク以外」のケースに限り件名を顧客属性に置き換える方針で合意。
--     そのため件名(title)列自体は削除せず、新たに counterpart_type（顧客属性）列を追加し、
--     フロント側でケースに応じて表示を切り替える（020のmemo_categoryと同じ設計）。
--   顧客属性の選択肢は020のdivision_memo_categoriesと同型の事業部別マスタとし、
--   M&A事業部にのみ「売主/買主/提携先」をシードする（他事業部には売主/買主という
--   言葉自体が馴染まないため、グローバルなデフォルト値は用意しない＝設定0件の
--   事業部ではこの項目自体を表示しない）。
-- ============================================================

-- 事業部ごとの顧客属性マスタ（020 division_memo_categories と同型）
CREATE TABLE public.division_counterpart_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (division_id, name)
);
CREATE INDEX idx_division_counterpart_types_division
  ON public.division_counterpart_types(division_id);

-- activitiesへの列追加（いずれも任意・既存データは影響を受けない）
ALTER TABLE public.activities
  ADD COLUMN end_at          TIMESTAMPTZ,   -- 終了日時（開始日時は既存のaction_dateを使用）
  ADD COLUMN counterpart_type VARCHAR(100); -- 顧客属性（名前参照。マスタ削除時も活動側の値は残す）

-- ============================================================
-- RLS（020と同一パターン）
-- ============================================================
ALTER TABLE public.division_counterpart_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "division_counterpart_types_select" ON public.division_counterpart_types
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "division_counterpart_types_manage" ON public.division_counterpart_types
  FOR ALL USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.division_counterpart_types TO authenticated;
GRANT SELECT ON public.division_counterpart_types TO service_role;

-- ============================================================
-- M&A事業部向け顧客属性のシード（020と同じ名前解決パターン）
-- ============================================================
DO $$
DECLARE
  ma_division_id UUID;
BEGIN
  SELECT id INTO ma_division_id FROM public.divisions WHERE name = 'M＆A事業部' LIMIT 1;
  IF ma_division_id IS NULL THEN
    RAISE NOTICE 'M＆A事業部 が見つからないため顧客属性のシードをスキップしました';
    RETURN;
  END IF;

  INSERT INTO public.division_counterpart_types (division_id, name, sort_order) VALUES
    (ma_division_id, '売主', 0),
    (ma_division_id, '買主', 1),
    (ma_division_id, '提携先', 2)
  ON CONFLICT (division_id, name) DO NOTHING;
END $$;
