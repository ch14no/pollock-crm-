-- ============================================================
-- 013: 案件資料のリンク管理（M&A事業部要望⑩〜⑭）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- 方針:
--   ファイル実体はCRMに保存しない（機密性・容量の観点、財務支援/M&A側の合意済み方針）。
--   Google Drive等に置いた資料のURL・名称・カテゴリを案件（deal）に紐づけて管理する。
--
--   カテゴリ（doc_type）は事業部ごとに設定可能（division_document_types）。
--   is_pinned=true のカテゴリは案件の資料セクションに「常設スロット」として表示される
--   （M&Aのノンネームシート・IMシート＝要望⑫⑬）。
--
-- 閲覧範囲: 011と同方針（自事業部＋super_adminのみ）。案件資料は機密性が高いため、
--   トスアップ例外も設けない。
-- ============================================================

-- 事業部ごとの資料カテゴリ
CREATE TABLE public.division_document_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_pinned   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (division_id, name)
);
CREATE INDEX idx_division_document_types_division ON public.division_document_types(division_id);

-- 案件資料（リンク）
CREATE TABLE public.deal_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  -- RLSと資料一覧ページの絞り込み用に事業部IDを非正規化して保持する
  division_id UUID NOT NULL REFERENCES public.divisions(id),
  doc_type    VARCHAR(100) NOT NULL DEFAULT 'その他',
  name        VARCHAR(255) NOT NULL,
  url         TEXT NOT NULL,
  note        TEXT,
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_deal_documents_deal ON public.deal_documents(deal_id);
CREATE INDEX idx_deal_documents_division ON public.deal_documents(division_id);

CREATE TRIGGER update_deal_documents_updated_at
  BEFORE UPDATE ON public.deal_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.division_document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_documents ENABLE ROW LEVEL SECURITY;

-- カテゴリ: 閲覧は全認証ユーザー、管理はsuper_adminまたは当該事業部のmanager
CREATE POLICY "division_document_types_select" ON public.division_document_types
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "division_document_types_manage" ON public.division_document_types
  FOR ALL USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    )
  );

-- 資料: 閲覧・編集とも自事業部のメンバー＋super_adminのみ（機密性重視）
CREATE POLICY "deal_documents_select" ON public.deal_documents
  FOR SELECT USING (
    division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );
CREATE POLICY "deal_documents_manage" ON public.deal_documents
  FOR ALL USING (
    division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );

-- GRANT（009の教訓: RLS以前のpermission denied防止）
GRANT SELECT, INSERT, UPDATE, DELETE ON public.division_document_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_documents TO authenticated;

-- ============================================================
-- M&A事業部向けカテゴリのシード（008と同じ名前解決パターン。
-- 該当事業部が見つからない場合は何もしない）
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

  INSERT INTO public.division_document_types (division_id, name, sort_order, is_pinned) VALUES
    (ma_division_id, 'ノンネームシート', 0, TRUE),
    (ma_division_id, 'IMシート',         1, TRUE),
    (ma_division_id, '契約書',           2, FALSE),
    (ma_division_id, '企業価値評価',     3, FALSE),
    (ma_division_id, '提案資料',         4, FALSE),
    (ma_division_id, 'その他',           5, FALSE)
  ON CONFLICT (division_id, name) DO NOTHING;
END $$;
