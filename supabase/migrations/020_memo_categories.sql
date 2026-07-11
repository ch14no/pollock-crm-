-- ============================================================
-- 020: 活動メモの用途別カテゴリ（M&A事業部要望⑰）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- 方針:
--   活動（電話・メール・面談・メモ・タスク）に任意のカテゴリを付けられるようにし、
--   活動履歴をカテゴリで絞り込めるようにする。
--   カテゴリは事業部ごとに設定可能（013の資料カテゴリ・018のナレッジカテゴリと同じ構造）。
--   既存の活動はカテゴリなし（NULL）のまま表示され、影響を受けない。
-- ============================================================

-- 事業部ごとのメモカテゴリ
CREATE TABLE public.division_memo_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (division_id, name)
);
CREATE INDEX idx_division_memo_categories_division
  ON public.division_memo_categories(division_id);

-- 活動へのカテゴリ列追加（任意・名前参照。カテゴリ削除時も活動側の値は残す）
ALTER TABLE public.activities
  ADD COLUMN memo_category VARCHAR(100);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.division_memo_categories ENABLE ROW LEVEL SECURITY;

-- カテゴリ: 閲覧は全認証ユーザー、管理はsuper_adminまたは当該事業部のmanager
-- （013 division_document_types / 018 division_knowledge_categories と同方針）
CREATE POLICY "division_memo_categories_select" ON public.division_memo_categories
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "division_memo_categories_manage" ON public.division_memo_categories
  FOR ALL USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    )
  );

-- GRANT（009の教訓: RLS以前のpermission denied防止）
GRANT SELECT, INSERT, UPDATE, DELETE ON public.division_memo_categories TO authenticated;

-- ============================================================
-- M&A事業部向けカテゴリのシード（013/018と同じ名前解決パターン。
-- 該当事業部が見つからない場合は何もしない）
-- ※ 事業部名は全角アンパサンドの「M＆A事業部」
-- ============================================================
DO $$
DECLARE
  ma_division_id UUID;
BEGIN
  SELECT id INTO ma_division_id FROM public.divisions WHERE name = 'M＆A事業部' LIMIT 1;
  IF ma_division_id IS NULL THEN
    RAISE NOTICE 'M＆A事業部 が見つからないためカテゴリのシードをスキップしました';
    RETURN;
  END IF;

  INSERT INTO public.division_memo_categories (division_id, name, sort_order) VALUES
    (ma_division_id, '顧客', 0),
    (ma_division_id, '案件', 1),
    (ma_division_id, '面談', 2),
    (ma_division_id, '契約', 3)
  ON CONFLICT (division_id, name) DO NOTHING;
END $$;
