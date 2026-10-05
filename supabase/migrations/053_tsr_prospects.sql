-- ============================================================
-- 053: TSRソーシングリスト（M&A事業部の営業対象リスト。約46万社）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--    データの投入はアプリ経由ではなく scripts/import-tsr.mjs（DB直接接続）で行う。
--
-- 設計の要点（詳細は Drive「TSRソーシングリスト 設計書.md」）:
--   - 全社共有の会社マスタ（companies）には入れず専用テーブルに隔離する。
--     46万社を混ぜると他事業部の会社選択・検索・出力が巻き込まれるため。
--     接触が始まった会社だけ「CRMに登録」で companies へ昇格し company_id で紐づける。
--   - 代表者の個人情報7項目は別テーブル（tsr_prospect_personal）に分離し、
--     閲覧権限の境界とPマーク上の管理対象を明確にする。閲覧はアプリ側で記録する。
--   - 権限は「その事業部（division_id）に所属するユーザー または super_admin」。
--     deal_buyer_prospects（047）と同じ判定式。他事業部には行が一切見えない。
--   - 年齢・経過年数・優先度は時間や設定に依存するため保存せず、
--     security_invoker のビューで算出する（RLSは基表のものがそのまま効く）。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.tsr_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

-- ─── 本体 ────────────────────────────────────────────────
CREATE TABLE public.tsr_prospects (
  tsr_code              VARCHAR(9)   PRIMARY KEY,                 -- TSR企業コード（9桁ゼロ埋め）
  division_id           UUID         NOT NULL REFERENCES public.divisions(id),
  listing_code          VARCHAR(2),                               -- '9'=未上場 'B'=プライム 等
  listing_name          VARCHAR(20),
  name                  VARCHAR(255) NOT NULL,
  name_kana             VARCHAR(255),
  surveyed_on           DATE,
  postal_code           VARCHAR(10),
  address               TEXT,
  prefecture            VARCHAR(10),
  phone                 VARCHAR(20),
  established_year      SMALLINT,
  established_month     SMALLINT,
  capital_thousand_yen  BIGINT,
  employee_count        INTEGER,
  industry1_code        VARCHAR(4),
  industry1_name        VARCHAR(100),
  industry2_code        VARCHAR(4),
  industry2_name        VARCHAR(100),
  industry3_code        VARCHAR(4),
  industry3_name        VARCHAR(100),
  business_description  TEXT,
  officers              TEXT,
  major_shareholders    TEXT,
  branches              TEXT,
  suppliers             TEXT,
  customers             TEXT,
  banks                 TEXT,
  overview              TEXT,
  fy1_closing           DATE,                                     -- 直近期（月初日で保持）
  fy1_sales             BIGINT,                                   -- 千円
  fy1_profit            BIGINT,
  fy2_closing           DATE,
  fy2_sales             BIGINT,
  fy2_profit            BIGINT,
  fy3_closing           DATE,
  fy3_sales             BIGINT,
  fy3_profit            BIGINT,
  sales_cagr            NUMERIC(8,4) GENERATED ALWAYS AS (
                          CASE WHEN fy1_sales > 0 AND fy3_sales > 0
                               THEN power(fy1_sales::numeric / fy3_sales::numeric, 0.5) - 1 END
                        ) STORED,
  profit_margin         NUMERIC(8,4) GENERATED ALWAYS AS (
                          CASE WHEN fy1_sales > 0 AND fy1_profit IS NOT NULL
                               THEN fy1_profit::numeric / fy1_sales::numeric END
                        ) STORED,
  -- 運用列（取込時に上書きしない）
  approach_type         VARCHAR(30),
  owner_user_id         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  last_contact_on       DATE,
  status                VARCHAR(30)  NOT NULL DEFAULT 'リスト投入',
  memo                  TEXT,
  company_id            UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  -- 取込管理
  source_files          TEXT[]       NOT NULL DEFAULT '{}',
  import_batch_id       UUID,
  imported_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tsr_prospects_name_trgm      ON public.tsr_prospects USING gin (name extensions.gin_trgm_ops);
CREATE INDEX idx_tsr_prospects_name_kana_trgm ON public.tsr_prospects USING gin (name_kana extensions.gin_trgm_ops);
CREATE INDEX idx_tsr_prospects_division   ON public.tsr_prospects(division_id);
CREATE INDEX idx_tsr_prospects_prefecture ON public.tsr_prospects(prefecture);
CREATE INDEX idx_tsr_prospects_industry1  ON public.tsr_prospects(industry1_code);
CREATE INDEX idx_tsr_prospects_industry2  ON public.tsr_prospects(industry2_code);
CREATE INDEX idx_tsr_prospects_industry3  ON public.tsr_prospects(industry3_code);
CREATE INDEX idx_tsr_prospects_employees  ON public.tsr_prospects(employee_count);
CREATE INDEX idx_tsr_prospects_capital    ON public.tsr_prospects(capital_thousand_yen);
CREATE INDEX idx_tsr_prospects_fy1_sales  ON public.tsr_prospects(fy1_sales);
CREATE INDEX idx_tsr_prospects_status     ON public.tsr_prospects(status);
CREATE INDEX idx_tsr_prospects_owner      ON public.tsr_prospects(owner_user_id);
CREATE INDEX idx_tsr_prospects_surveyed   ON public.tsr_prospects(surveyed_on);
CREATE INDEX idx_tsr_prospects_phone      ON public.tsr_prospects(phone);
CREATE INDEX idx_tsr_prospects_company    ON public.tsr_prospects(company_id);

CREATE TRIGGER tsr_prospects_updated_at BEFORE UPDATE ON public.tsr_prospects
  FOR EACH ROW EXECUTE FUNCTION public.tsr_set_updated_at();

-- ─── 代表者の個人情報（分離） ──────────────────────────────
CREATE TABLE public.tsr_prospect_personal (
  tsr_code          VARCHAR(9)   PRIMARY KEY REFERENCES public.tsr_prospects(tsr_code) ON DELETE CASCADE,
  division_id       UUID         NOT NULL REFERENCES public.divisions(id),  -- RLS判定用に本体と同値を持つ
  rep_name          VARCHAR(100),
  rep_name_kana     VARCHAR(100),
  rep_home_address  TEXT,
  rep_birth_year    SMALLINT,
  rep_birth_month   SMALLINT,
  rep_birth_day     SMALLINT,
  rep_birthplace    VARCHAR(50),
  rep_school        VARCHAR(100),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tsr_personal_division   ON public.tsr_prospect_personal(division_id);
CREATE INDEX idx_tsr_personal_birth_year ON public.tsr_prospect_personal(rep_birth_year);

-- ─── 優先度判定の閾値（設定画面から変更） ─────────────────────
CREATE TABLE public.tsr_priority_settings (
  division_id                UUID     PRIMARY KEY REFERENCES public.divisions(id) ON DELETE CASCADE,
  s_min_age                  SMALLINT NOT NULL DEFAULT 65,
  s_min_sales_thousand_yen   BIGINT   NOT NULL DEFAULT 100000,   -- 1億円
  a_min_age                  SMALLINT NOT NULL DEFAULT 65,
  a2_min_age                 SMALLINT NOT NULL DEFAULT 60,
  a2_min_sales_thousand_yen  BIGINT   NOT NULL DEFAULT 300000,   -- 3億円
  updated_by                 UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.tsr_priority_settings (division_id)
SELECT id FROM public.divisions WHERE name = 'M＆A事業部'
ON CONFLICT (division_id) DO NOTHING;

-- ─── 個人情報の閲覧・出力記録 ──────────────────────────────
CREATE TABLE public.tsr_prospect_view_logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tsr_code   VARCHAR(9)  NOT NULL,
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action     VARCHAR(20) NOT NULL CHECK (action IN ('view', 'export')),
  viewed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tsr_view_logs_code ON public.tsr_prospect_view_logs(tsr_code);
CREATE INDEX idx_tsr_view_logs_at   ON public.tsr_prospect_view_logs(viewed_at);

-- ─── 取込履歴 ──────────────────────────────────────────────
CREATE TABLE public.tsr_import_logs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id       UUID        REFERENCES public.divisions(id),
  file_name         TEXT,
  rows_read         INTEGER,
  unique_companies  INTEGER,
  inserted_count    INTEGER,
  updated_count     INTEGER,
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note              TEXT
);

-- ─── 一覧・詳細用ビュー（年齢・経過年数・優先度を算出） ─────────
-- security_invoker: 実行ユーザーの権限で基表を読む＝基表のRLSがそのまま効く
CREATE VIEW public.tsr_prospects_view
WITH (security_invoker = true) AS
SELECT
  p.*,
  pp.rep_name, pp.rep_name_kana, pp.rep_home_address,
  pp.rep_birth_year, pp.rep_birth_month, pp.rep_birth_day,
  pp.rep_birthplace, pp.rep_school,
  CASE WHEN pp.rep_birth_year IS NOT NULL THEN
    EXTRACT(YEAR FROM CURRENT_DATE)::int - pp.rep_birth_year
    - CASE WHEN pp.rep_birth_month IS NOT NULL AND (
             EXTRACT(MONTH FROM CURRENT_DATE)::int < pp.rep_birth_month OR
             (EXTRACT(MONTH FROM CURRENT_DATE)::int = pp.rep_birth_month
              AND EXTRACT(DAY FROM CURRENT_DATE)::int < COALESCE(pp.rep_birth_day, 1)))
           THEN 1 ELSE 0 END
  END AS rep_age,
  CASE WHEN p.surveyed_on IS NOT NULL
       THEN ROUND((CURRENT_DATE - p.surveyed_on) / 365.25, 1) END AS data_age_years,
  CASE
    WHEN pp.rep_birth_year IS NULL THEN '不明'
    WHEN (EXTRACT(YEAR FROM CURRENT_DATE)::int - pp.rep_birth_year) >= s.s_min_age
         AND COALESCE(p.fy1_sales, 0) >= s.s_min_sales_thousand_yen THEN 'S'
    WHEN (EXTRACT(YEAR FROM CURRENT_DATE)::int - pp.rep_birth_year) >= s.a_min_age
         OR ((EXTRACT(YEAR FROM CURRENT_DATE)::int - pp.rep_birth_year) >= s.a2_min_age
             AND COALESCE(p.fy1_sales, 0) >= s.a2_min_sales_thousand_yen) THEN 'A'
    ELSE 'B'
  END AS approach_priority
FROM public.tsr_prospects p
LEFT JOIN public.tsr_prospect_personal pp ON pp.tsr_code = p.tsr_code
LEFT JOIN public.tsr_priority_settings s  ON s.division_id = p.division_id;

-- ─── RLS ───────────────────────────────────────────────────
ALTER TABLE public.tsr_prospects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tsr_prospect_personal  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tsr_priority_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tsr_prospect_view_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tsr_import_logs        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tsr_prospects_select" ON public.tsr_prospects FOR SELECT USING (
  division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);
-- 運用列の編集と「CRMに登録」（company_idの設定）。追加・削除はアプリから行わない
CREATE POLICY "tsr_prospects_update" ON public.tsr_prospects FOR UPDATE USING (
  division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);

CREATE POLICY "tsr_personal_select" ON public.tsr_prospect_personal FOR SELECT USING (
  division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);

CREATE POLICY "tsr_priority_settings_select" ON public.tsr_priority_settings FOR SELECT USING (
  division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);
CREATE POLICY "tsr_priority_settings_manage" ON public.tsr_priority_settings FOR ALL USING (
  (division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
   AND (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager')
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);

-- 閲覧記録は本人名義でのみ追加可。参照はsuper_adminのみ
CREATE POLICY "tsr_view_logs_insert" ON public.tsr_prospect_view_logs FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "tsr_view_logs_select" ON public.tsr_prospect_view_logs FOR SELECT USING (
  (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);

CREATE POLICY "tsr_import_logs_select" ON public.tsr_import_logs FOR SELECT USING (
  division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);

-- ─── GRANT（039以降の service_role SELECT 付与の徹底） ───────────
GRANT SELECT, UPDATE ON public.tsr_prospects          TO authenticated;
GRANT SELECT         ON public.tsr_prospect_personal  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tsr_priority_settings TO authenticated;
GRANT SELECT, INSERT ON public.tsr_prospect_view_logs TO authenticated;
GRANT SELECT         ON public.tsr_import_logs        TO authenticated;
GRANT SELECT         ON public.tsr_prospects_view     TO authenticated;
GRANT SELECT ON public.tsr_prospects, public.tsr_prospect_personal, public.tsr_priority_settings,
                public.tsr_prospect_view_logs, public.tsr_import_logs, public.tsr_prospects_view TO service_role;
