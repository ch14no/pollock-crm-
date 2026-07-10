-- ============================================================
-- 014: 案件の金銭管理（M&A事業部要望⑮⑯ 手数料・着金確認／売手・買手報酬）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- 設計:
--   案件（deal）に複数の報酬・手数料レコードを紐づける。
--   payment_type は自由入力（例: 着手金・中間手数料・成功報酬）で、
--   party（売手/買手/共通）と組み合わせて売手報酬・買手報酬・合計を集計する（⑯）。
--   billing_status で請求状況（未請求→請求済→入金済）を管理する（⑮）。
--
-- 閲覧範囲: 011/013と同方針（自事業部＋super_adminのみ。金銭情報のため）。
-- ============================================================

CREATE TABLE public.deal_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id        UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  -- RLS用に事業部IDを非正規化して保持する
  division_id    UUID NOT NULL REFERENCES public.divisions(id),
  payment_type   VARCHAR(100) NOT NULL,
  party          VARCHAR(10) CHECK (party IN ('seller', 'buyer')),  -- NULL=共通/区別なし
  amount         INTEGER NOT NULL DEFAULT 0,
  billing_status VARCHAR(10) NOT NULL DEFAULT 'unbilled'
                 CHECK (billing_status IN ('unbilled', 'billed', 'paid')),
  invoice_date   DATE,
  paid_date      DATE,
  note           TEXT,
  created_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_deal_payments_deal ON public.deal_payments(deal_id);
CREATE INDEX idx_deal_payments_division ON public.deal_payments(division_id);

CREATE TRIGGER update_deal_payments_updated_at
  BEFORE UPDATE ON public.deal_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.deal_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_payments_select" ON public.deal_payments
  FOR SELECT USING (
    division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );
CREATE POLICY "deal_payments_manage" ON public.deal_payments
  FOR ALL USING (
    division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_payments TO authenticated;
