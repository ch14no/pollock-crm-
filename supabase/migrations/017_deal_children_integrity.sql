-- ============================================================
-- 017: 案件資料・金銭管理のデータ整合強化（013/014のコードレビュー指摘対応）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- 対応内容:
--   1. deal_documents / deal_payments の division_id を、参照先dealの実際の
--      division_id からトリガーで強制設定する。クライアントが自分の事業部IDを
--      指定して他事業部の案件に資料・金銭を紐づける抜け道（RLSは行自身の
--      division_idしか見ないため素通りしていた）を塞ぐ。
--      ※ トリガーで他事業部のdivision_idに書き換わった行はRLSのWITH CHECKで
--        拒否されるため、他事業部の案件への挿入自体が失敗するようになる。
--   2. 金額を BIGINT 化（大型M&A案件の成功報酬がINTEGER上限≒21.4億円を
--      超えうるため）＋ 負数を禁止するCHECKを追加。
--   3. 資料URLは http/https スキームのみ許可するCHECKを追加
--      （javascript:等の危険スキームの保存をDBレベルで防止）。
-- ============================================================

-- 1. division_id をdealsから強制導出するトリガー
CREATE OR REPLACE FUNCTION public.sync_deal_child_division()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  deal_division UUID;
BEGIN
  SELECT division_id INTO deal_division FROM public.deals WHERE id = NEW.deal_id;
  IF deal_division IS NULL THEN
    RAISE EXCEPTION '参照先の商談が見つかりません: %', NEW.deal_id;
  END IF;
  NEW.division_id := deal_division;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_deal_documents_division ON public.deal_documents;
CREATE TRIGGER sync_deal_documents_division
  BEFORE INSERT OR UPDATE OF deal_id ON public.deal_documents
  FOR EACH ROW EXECUTE FUNCTION public.sync_deal_child_division();

DROP TRIGGER IF EXISTS sync_deal_payments_division ON public.deal_payments;
CREATE TRIGGER sync_deal_payments_division
  BEFORE INSERT OR UPDATE OF deal_id ON public.deal_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_deal_child_division();

-- 既存行の整合（013/014適用後に登録された行があれば実dealの事業部に揃える）
UPDATE public.deal_documents dd
SET division_id = d.division_id
FROM public.deals d
WHERE dd.deal_id = d.id AND dd.division_id <> d.division_id;

UPDATE public.deal_payments dp
SET division_id = d.division_id
FROM public.deals d
WHERE dp.deal_id = d.id AND dp.division_id <> d.division_id;

-- 2. 金額のBIGINT化＋非負CHECK
ALTER TABLE public.deal_payments
  ALTER COLUMN amount TYPE BIGINT;
ALTER TABLE public.deal_payments
  ADD CONSTRAINT deal_payments_amount_nonneg CHECK (amount >= 0);

-- 3. 資料URLのスキーム制限
ALTER TABLE public.deal_documents
  ADD CONSTRAINT deal_documents_url_scheme CHECK (url ~* '^https?://');
