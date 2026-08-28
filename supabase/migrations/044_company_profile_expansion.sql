-- ============================================================
-- 044: 会社マスタの拡張（M&A事業部・酒田さん依頼 フェーズ1）
-- ============================================================
-- 背景: M&A事業部から「業種を大中小の階層選択式にしたい（TSR業種分類準拠）」
-- 「事業内容欄を追加したい」「代表者を共同代表想定で2名分にしたい」
-- 「会社名・代表者名にフリガナ欄がほしい」という依頼（2026-08-28）。
--
-- companiesは事業部（division_id）を持たない全社共有マスタである点に注意
-- （019でcompanies_updateは全ログインユーザーに開放済み）。今回追加する列も
-- 同じ思想で全社共通・全ユーザー編集可のまま据え置く（RLSポリシー変更は無し）。
-- ============================================================

-- ─── 業種マスタ（大中小の階層。TSR/JSIC準拠のコード体系を利用） ──────────
-- 大分類=英字1桁・中分類=数字2桁・小分類=数字3桁でコード体系が重複しないため、
-- 3テーブルに分けず1テーブル＋自己参照parent_codeで階層を表現する。
CREATE TABLE public.industry_classes (
  code        VARCHAR(4)   PRIMARY KEY,          -- 'A' / '01' / '011'
  level       SMALLINT     NOT NULL CHECK (level IN (1, 2, 3)),  -- 1=大 2=中 3=小
  parent_code VARCHAR(4)   REFERENCES public.industry_classes(code) ON DELETE RESTRICT,
  name        VARCHAR(100) NOT NULL,             -- '農業，林業' / '耕種農業'
  keywords    TEXT,                              -- '米麦・野菜・果樹・花き栽培'（検索用、小分類のみ想定）
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  CHECK ((level = 1 AND parent_code IS NULL) OR (level > 1 AND parent_code IS NOT NULL))
);
CREATE INDEX idx_industry_classes_parent ON public.industry_classes(parent_code);

ALTER TABLE public.industry_classes ENABLE ROW LEVEL SECURITY;
-- 全社静的マスタ: 閲覧は全認証ユーザー、管理はsuper_adminのみ（divisions_manageと同型）
CREATE POLICY "industry_classes_select" ON public.industry_classes FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "industry_classes_manage" ON public.industry_classes FOR ALL USING (
  (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.industry_classes TO authenticated;
GRANT SELECT ON public.industry_classes TO service_role;

-- ─── companiesへの列追加 ──────────────────────────────────────
ALTER TABLE public.companies
  ADD COLUMN industry_code         VARCHAR(4) REFERENCES public.industry_classes(code) ON DELETE SET NULL,
  ADD COLUMN business_description  TEXT,                -- 事業内容
  ADD COLUMN representative2       VARCHAR(100),        -- 代表者②（共同代表対応）
  ADD COLUMN name_kana             VARCHAR(255),        -- 会社名フリガナ
  ADD COLUMN representative_kana   VARCHAR(100),        -- 代表者①フリガナ
  ADD COLUMN representative2_kana  VARCHAR(100);         -- 代表者②フリガナ
CREATE INDEX idx_companies_industry_code ON public.companies(industry_code);

-- 既存の自由入力`industry`列は残す（マスタに無い業種の逃げ道・既存データの受け皿）。
-- 表示はindustry_codeがあれば業種マスタを解決して優先表示し、無ければindustryに
-- フォールバックする（アプリ側で対応、DB側の制約は設けない）。
