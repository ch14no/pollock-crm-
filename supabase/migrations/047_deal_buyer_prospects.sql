-- ============================================================
-- 047: 買手打診リスト（M&A事業部・酒田さん依頼 フェーズ2）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--    （複数Supabaseプロジェクト運用のため、対象が pollock-crm プロジェクトであることを実行前に確認）
--
-- 方針:
--   売り案件（商談）ごとに買手候補の会社を紐づける多行の子テーブル。
--   「CRMに登録されている顧客からレコードを紐づける運用にしたい」という依頼のため、
--   会社情報（企業名・代表者・業種・事業内容・URL等）は company_id join のライブ参照とし、
--   この行が固有に持つデータは所感（note）とネームクリア可否（name_clear）のみにする
--   （044のグループ会社紐づけと同じ「会社マスタを唯一の情報源にする」思想）。
--   上場区分・都道府県は会社固有の属性のため、prospect行ではなく companies 側に追加する。
--   閲覧範囲は013/014/023の全deal子テーブルと同方針（自事業部＋super_admin）。
-- ============================================================

-- (A) companies に打診リスト表示・CSV出力用の会社属性を追加
ALTER TABLE public.companies
  ADD COLUMN listing_status VARCHAR(30)
    CHECK (listing_status IN ('東証プライム', '東証スタンダード', '東証グロース', 'その他上場', '非上場')),
  ADD COLUMN prefecture VARCHAR(10);  -- 都道府県（UI selectで47都道府県に制限、DB側にCHECKは持たない）

-- (B) 買手打診リスト本体
CREATE TABLE public.deal_buyer_prospects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  division_id UUID NOT NULL REFERENCES public.divisions(id), -- トリガーで強制導出
  company_id  UUID REFERENCES public.companies(id) ON DELETE SET NULL, -- 会社削除時も打診履歴は残す（contacts.company_idと同方針）
  note        TEXT,                                            -- 所感
  name_clear  VARCHAR(10) CHECK (name_clear IN ('可', '否')),  -- ネームクリア可否（NULL=未確認）
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dbp_deal     ON public.deal_buyer_prospects(deal_id);
CREATE INDEX idx_dbp_division ON public.deal_buyer_prospects(division_id);
CREATE INDEX idx_dbp_company  ON public.deal_buyer_prospects(company_id);
-- 同一案件に同じ買手を二重登録できないようにする（会社削除でNULL化した行は対象外）
CREATE UNIQUE INDEX uq_dbp_deal_company ON public.deal_buyer_prospects(deal_id, company_id)
  WHERE company_id IS NOT NULL;

CREATE TRIGGER update_deal_buyer_prospects_updated_at
  BEFORE UPDATE ON public.deal_buyer_prospects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 017で定義済みの sync_deal_child_division() を再利用（division_idをdealsから強制導出）
CREATE TRIGGER sync_deal_buyer_prospects_division
  BEFORE INSERT OR UPDATE OF deal_id ON public.deal_buyer_prospects
  FOR EACH ROW EXECUTE FUNCTION public.sync_deal_child_division();

-- RLS（023と同一パターン）
ALTER TABLE public.deal_buyer_prospects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deal_buyer_prospects_select" ON public.deal_buyer_prospects
  FOR SELECT USING (
    division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );
CREATE POLICY "deal_buyer_prospects_manage" ON public.deal_buyer_prospects
  FOR ALL USING (
    division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );

-- GRANT（039以降のservice_role SELECT付与の徹底）
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_buyer_prospects TO authenticated;
GRANT SELECT ON public.deal_buyer_prospects TO service_role;
