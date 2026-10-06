-- ============================================================
-- 057: TSRソーシングリスト 検索用の商号列を NFKC 正規化し、検索の起点を一本化（056の続き）
--
-- 056 適用後に判明したこと（2026-10-06）:
--   1. 元データの商号カナは半角カナ（例「ｱﾅﾌﾞｷ」）。利用者が全角で「アナブキ」と打つと一致しない
--   2. ビューは p.* を「定義時点」で展開するため、056 で足した列がビューに出ていなかった
--
-- 対策:
--   - tsr_name_core() の先頭で normalize(NFKC) を掛ける（半角カナ→全角、全角英数→半角）。
--     生成列は関数本体を変えても再計算されないため、列を作り直す（テーブルの書き直し・数分）
--   - 文字検索はすべて name_core / name_kana_core を対象にする（アプリ側も検索語を NFKC 正規化）:
--       2文字以下 → 前方一致（text_pattern_ops）／3文字以上 → trgm 部分一致（GIN）
--     元列 name / name_kana の trgm インデックスは使わなくなるので削除（書き込み負荷と容量の節約）
--   - ビューを作り直して新列を露出する
--
-- ※ 056 適用済みが前提。
-- ============================================================

DROP VIEW IF EXISTS public.tsr_prospects_view;

ALTER TABLE public.tsr_prospects
  DROP COLUMN IF EXISTS name_core,
  DROP COLUMN IF EXISTS name_kana_core;

CREATE OR REPLACE FUNCTION public.tsr_name_core(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT NULLIF(btrim(regexp_replace(regexp_replace(normalize(p, NFKC),
    '^\s*(株式会社|有限会社|合同会社|合資会社|合名会社|医療法人社団|医療法人財団|医療法人|社会福祉法人|社会医療法人|学校法人|宗教法人|一般社団法人|公益社団法人|一般財団法人|公益財団法人|特定非営利活動法人|NPO法人|農事組合法人|企業組合|協同組合|生活協同組合|\(株\)|㈱|\(有\)|㈲|\(同\)|カブシキガイシャ|カブシキカイシャ|ユウゲンガイシャ|ユウゲンカイシャ|ゴウドウガイシャ|ゴウドウカイシャ|イリョウホウジン|シャカイフクシホウジン|ガッコウホウジン|イッパンシャダンホウジン|イッパンザイダンホウジン)\s*', ''),
    '\s*(株式会社|有限会社|合同会社|合資会社|合名会社|\(株\)|㈱|\(有\)|㈲|\(同\)|カブシキガイシャ|カブシキカイシャ|ユウゲンガイシャ|ユウゲンカイシャ|ゴウドウガイシャ|ゴウドウカイシャ)\s*$', '')), '')
$$;

ALTER TABLE public.tsr_prospects
  ADD COLUMN name_core      TEXT GENERATED ALWAYS AS (public.tsr_name_core(name)) STORED,
  ADD COLUMN name_kana_core TEXT GENERATED ALWAYS AS (public.tsr_name_core(name_kana)) STORED;

-- 前方一致（2文字以下の検索語）
CREATE INDEX idx_tsr_prospects_name_core_prefix      ON public.tsr_prospects (name_core text_pattern_ops);
CREATE INDEX idx_tsr_prospects_name_kana_core_prefix ON public.tsr_prospects (name_kana_core text_pattern_ops);
-- 部分一致（3文字以上の検索語）
CREATE INDEX idx_tsr_prospects_name_core_trgm      ON public.tsr_prospects USING gin (name_core extensions.gin_trgm_ops);
CREATE INDEX idx_tsr_prospects_name_kana_core_trgm ON public.tsr_prospects USING gin (name_kana_core extensions.gin_trgm_ops);
-- 元列の trgm は不要になった
DROP INDEX IF EXISTS public.idx_tsr_prospects_name_trgm;
DROP INDEX IF EXISTS public.idx_tsr_prospects_name_kana_trgm;

-- ビュー（055 と同じ定義。p.* の再展開のため作り直す）
CREATE VIEW public.tsr_prospects_view
WITH (security_invoker = true) AS
SELECT
  p.*,
  pp.rep_name, pp.rep_name_kana, pp.rep_home_address,
  pp.rep_birth_year, pp.rep_birth_month, pp.rep_birth_day, pp.rep_birth_key,
  pp.rep_birthplace, pp.rep_school,
  public.tsr_rep_age(pp.rep_birth_year, pp.rep_birth_month, pp.rep_birth_day) AS rep_age,
  CASE WHEN p.surveyed_on IS NOT NULL
       THEN ROUND((CURRENT_DATE - p.surveyed_on) / 365.25, 1) END AS data_age_years,
  (ARRAY['S', 'A', 'B', '不明'])[p.priority_rank + 1] AS approach_priority,
  p.priority_rank + 0        AS priority_rank_s,
  p.fy1_sales + 0            AS fy1_sales_s,
  p.surveyed_on + 0          AS surveyed_on_s,
  p.name_kana || ''          AS name_kana_s,
  pp.rep_birth_key + 0       AS rep_birth_key_s
FROM public.tsr_prospects p
JOIN public.tsr_prospect_personal pp ON pp.tsr_code = p.tsr_code;

GRANT SELECT ON public.tsr_prospects_view TO authenticated, service_role;
