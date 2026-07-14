-- ============================================================
-- 023: 売主の譲渡希望条件／買主の買収意向（M&A事業部要望㉒）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- 方針（M&A事業部・東さん回答に基づく項目定義）:
--   売主・買主で項目セットが非対称なため、013/014と同様にdealと1:1の専用テーブルを
--   2つ用意する（1商談＝1レコード、UPSERT運用）。
--   希望エリア・赤字債務超過検討可否・資金調達方法はプルダウン、それ以外は自由記述。
--   投資予算(上限)・資金調達の上限金額は自由記述テキストで持つ
--   （ユーザー確認済み。将来㉓自動マッチングで数値化が必要になれば別途カラム追加）。
--
--   desired_area の選択肢は回答文中の例示（全国／1都3県）を踏まえた仮案。
--   実際の運用で選択肢が不足する場合はM&A事業部に確認の上、マイグレーションで追加する。
--
-- 閲覧範囲: 013/014と同方針（機密性の高い情報のため自事業部＋super_adminのみ）。
-- ============================================================

CREATE TABLE public.deal_seller_conditions (
  deal_id           UUID PRIMARY KEY REFERENCES public.deals(id) ON DELETE CASCADE,
  division_id       UUID NOT NULL REFERENCES public.divisions(id), -- トリガーで強制導出
  desired_timing    TEXT, -- 希望譲渡時期
  desired_scheme    TEXT, -- 希望譲渡スキーム
  desired_price     TEXT, -- 希望譲渡対価
  other_conditions  TEXT, -- その他条件（自由記述）
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_deal_seller_conditions_division ON public.deal_seller_conditions(division_id);

CREATE TABLE public.deal_buyer_conditions (
  deal_id               UUID PRIMARY KEY REFERENCES public.deals(id) ON DELETE CASCADE,
  division_id           UUID NOT NULL REFERENCES public.divisions(id), -- トリガーで強制導出
  desired_area          VARCHAR(50) CHECK (desired_area IN ('全国', '1都3県', '関東', '関西', '中部', '九州', 'その他')),
  desired_industry      TEXT, -- 希望業種
  desired_revenue_size  TEXT, -- 希望買収先の売上規模
  valuation_method      TEXT, -- 株価算定方法
  investment_budget_max TEXT, -- 投資予算(上限)
  loss_deficit_ok       VARCHAR(10) CHECK (loss_deficit_ok IN ('可', '否')), -- 赤字・債務超過企業の検討可否
  funding_method        VARCHAR(20) CHECK (funding_method IN ('手元資金', '借入', 'エクイティ')), -- 資金調達方法
  funding_amount_max    TEXT, -- 資金調達の上限金額
  key_man_lockup        TEXT, -- キーマンのロックアップ
  audit_by_company      TEXT, -- 買収監査対応（自社）
  audit_by_specialist   TEXT, -- 買収監査対応（専門業者）
  review_period         TEXT, -- 検討期間（IM提案からクロージングまで）
  approval_flow         TEXT, -- 社内決裁フロー
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_deal_buyer_conditions_division ON public.deal_buyer_conditions(division_id);

CREATE TRIGGER update_deal_seller_conditions_updated_at
  BEFORE UPDATE ON public.deal_seller_conditions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_deal_buyer_conditions_updated_at
  BEFORE UPDATE ON public.deal_buyer_conditions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 017で定義済みの sync_deal_child_division() を再利用（division_idをdealsから強制導出）
DROP TRIGGER IF EXISTS sync_deal_seller_conditions_division ON public.deal_seller_conditions;
CREATE TRIGGER sync_deal_seller_conditions_division
  BEFORE INSERT OR UPDATE OF deal_id ON public.deal_seller_conditions
  FOR EACH ROW EXECUTE FUNCTION public.sync_deal_child_division();

DROP TRIGGER IF EXISTS sync_deal_buyer_conditions_division ON public.deal_buyer_conditions;
CREATE TRIGGER sync_deal_buyer_conditions_division
  BEFORE INSERT OR UPDATE OF deal_id ON public.deal_buyer_conditions
  FOR EACH ROW EXECUTE FUNCTION public.sync_deal_child_division();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.deal_seller_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_buyer_conditions  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_seller_conditions_select" ON public.deal_seller_conditions
  FOR SELECT USING (
    division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );
CREATE POLICY "deal_seller_conditions_manage" ON public.deal_seller_conditions
  FOR ALL USING (
    division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );

CREATE POLICY "deal_buyer_conditions_select" ON public.deal_buyer_conditions
  FOR SELECT USING (
    division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );
CREATE POLICY "deal_buyer_conditions_manage" ON public.deal_buyer_conditions
  FOR ALL USING (
    division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );

-- GRANT（009の教訓: RLS以前のpermission denied防止）
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_seller_conditions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_buyer_conditions  TO authenticated;
