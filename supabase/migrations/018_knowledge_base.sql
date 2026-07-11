-- ============================================================
-- 018: ナレッジベース（M&A事業部要望⑱⑲⑳）＋ 会社のIRリンク欄（⑳後半）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- 方針:
--   事業部内の知見・研修資料・ニュースを共有する投稿型モジュール。
--   カテゴリ（ナレッジ/研修資料/ニュース等）は事業部ごとに設定可能
--   （division_knowledge_categories。013の資料カテゴリと同じ構造）。
--   投稿ごとに公開範囲を「自事業部のみ」「全社公開」から選択できる。
--   本文はMarkdown。参考リンク（Drive・IRページ等のURL）を複数添付できる。
--
-- 閲覧範囲:
--   visibility='division' … 自事業部メンバー＋super_adminのみ
--   visibility='company'  … 全認証ユーザー
-- 編集・削除: 投稿者本人／当該事業部のmanager／super_admin
-- ============================================================

-- 事業部ごとのナレッジカテゴリ
CREATE TABLE public.division_knowledge_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (division_id, name)
);
CREATE INDEX idx_division_knowledge_categories_division
  ON public.division_knowledge_categories(division_id);

-- 添付リンク（JSONB配列 [{"name": "...", "url": "https://..."}]）の妥当性検証。
-- CHECK制約から呼び出し、http/https以外のスキーム（javascript:等）の保存をDBレベルで防ぐ
CREATE OR REPLACE FUNCTION public.knowledge_links_valid(links JSONB)
RETURNS BOOLEAN
IMMUTABLE
LANGUAGE sql AS $$
  SELECT jsonb_typeof(links) = 'array'
    AND COALESCE((
      SELECT bool_and(
        jsonb_typeof(l) = 'object'
        AND COALESCE(l->>'name', '') <> ''
        -- urlキー欠落時に判定がNULLになりbool_andから無視される穴を塞ぐ
        AND COALESCE(l->>'url', '') ~* '^https?://'
      )
      FROM jsonb_array_elements(links) AS l
    ), TRUE)
$$;

-- ナレッジ投稿
CREATE TABLE public.knowledge_posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  category    VARCHAR(100) NOT NULL DEFAULT 'ナレッジ',
  title       VARCHAR(255) NOT NULL,
  body        TEXT NOT NULL DEFAULT '',          -- Markdown
  visibility  VARCHAR(20) NOT NULL DEFAULT 'division'
              CHECK (visibility IN ('division', 'company')),
  links       JSONB NOT NULL DEFAULT '[]'::jsonb
              CHECK (public.knowledge_links_valid(links)),
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_knowledge_posts_division ON public.knowledge_posts(division_id);
-- 全社公開投稿の取得用（visibilityは2値で通常インデックスは選択されないため部分インデックス）
CREATE INDEX idx_knowledge_posts_company ON public.knowledge_posts(updated_at DESC)
  WHERE visibility = 'company';

CREATE TRIGGER update_knowledge_posts_updated_at
  BEFORE UPDATE ON public.knowledge_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.division_knowledge_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_posts ENABLE ROW LEVEL SECURITY;

-- カテゴリ: 閲覧は全認証ユーザー、管理はsuper_adminまたは当該事業部のmanager
-- （013の division_document_types と同方針）
CREATE POLICY "division_knowledge_categories_select" ON public.division_knowledge_categories
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "division_knowledge_categories_manage" ON public.division_knowledge_categories
  FOR ALL USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    )
  );

-- 投稿の閲覧: 全社公開 or 自事業部 or super_admin
CREATE POLICY "knowledge_posts_select" ON public.knowledge_posts
  FOR SELECT USING (
    (visibility = 'company' AND auth.uid() IS NOT NULL)
    OR division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );

-- 投稿の作成: 自事業部宛て＋投稿者は本人のみ（なりすまし防止）。super_adminは任意の事業部へ
CREATE POLICY "knowledge_posts_insert" ON public.knowledge_posts
  FOR INSERT WITH CHECK (
    (
      created_by = auth.uid()
      AND division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    )
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );

-- 投稿の更新・削除: 投稿者本人／当該事業部のmanager／super_admin。
-- WITH CHECKはUSINGと同条件（投稿者本人の枝を欠くと、事業部を異動した投稿者が
-- 自分の投稿を削除はできるのに編集だけできない非対称が生じるため）
CREATE POLICY "knowledge_posts_update" ON public.knowledge_posts
  FOR UPDATE USING (
    created_by = auth.uid()
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    )
  ) WITH CHECK (
    created_by = auth.uid()
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    )
  );
CREATE POLICY "knowledge_posts_delete" ON public.knowledge_posts
  FOR DELETE USING (
    created_by = auth.uid()
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    )
  );

-- GRANT（009の教訓: RLS以前のpermission denied防止）
GRANT SELECT, INSERT, UPDATE, DELETE ON public.division_knowledge_categories TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.knowledge_posts TO authenticated;
-- 投稿の他事業部への付け替えを列レベルで禁止する（division_idをUPDATE対象から除外。
-- updated_atはトリガーが設定するためGRANT不要）
GRANT UPDATE (category, title, body, visibility, links) ON public.knowledge_posts TO authenticated;

-- ============================================================
-- ⑳後半: 会社マスタにIRリンク欄を追加
--   会社詳細ページに表示し、M&Aニュース・IR情報の起点にする。
--   編集は既存の companies_update ポリシー（manager / super_admin）に従う
-- ============================================================
ALTER TABLE public.companies
  ADD COLUMN ir_url TEXT
  CHECK (ir_url IS NULL OR ir_url ~* '^https?://');

-- ============================================================
-- M&A事業部向けカテゴリのシード（013と同じ名前解決パターン。
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

  INSERT INTO public.division_knowledge_categories (division_id, name, sort_order) VALUES
    (ma_division_id, 'ナレッジ',   0),
    (ma_division_id, '研修資料',   1),
    (ma_division_id, 'ニュース',   2)
  ON CONFLICT (division_id, name) DO NOTHING;
END $$;
