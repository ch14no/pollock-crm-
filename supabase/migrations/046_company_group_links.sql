-- ============================================================
-- 046: グループ会社の紐づけ（M&A事業部・酒田さん依頼 フェーズ1）
-- ============================================================
-- 「グループ会社の欄を追加し、CRMに登録されている顧客からレコードを
-- 紐づける運用にしたい」という依頼。親子関係が一方向に確定しない
-- ケース（共同持株・兄弟会社・親会社が未登録等）があるため、
-- 自己参照FK（parent_company_id）ではなく無向のペアを表す中間テーブルにする。
--
-- companiesと同じ「全社共有マスタ」の思想で、閲覧・追加・削除は
-- 全ログインユーザーに開放する（019のcompanies_updateと同じ方針）。
-- ============================================================

CREATE TABLE public.company_group_links (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  related_company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  note               VARCHAR(255),   -- 「親会社」「持株会社」等の関係メモ（任意・自由入力）
  created_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (company_id <> related_company_id)
);
-- 逆向き重複（A→BとB→A）を1本に制限する
CREATE UNIQUE INDEX uq_company_group_pair ON public.company_group_links
  (LEAST(company_id, related_company_id), GREATEST(company_id, related_company_id));
CREATE INDEX idx_cgl_company ON public.company_group_links(company_id);
CREATE INDEX idx_cgl_related ON public.company_group_links(related_company_id);

ALTER TABLE public.company_group_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cgl_select" ON public.company_group_links FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "cgl_insert" ON public.company_group_links FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "cgl_delete" ON public.company_group_links FOR DELETE USING (auth.uid() IS NOT NULL);
GRANT SELECT, INSERT, DELETE ON public.company_group_links TO authenticated;
GRANT SELECT ON public.company_group_links TO service_role;
