-- ============================================================
-- 055: TSRソーシングリスト 並び替え・文字検索の性能対策（054の続き）
--
-- 054 適用後の本番実測（2026-10-06・Nano計算機）:
--   優先度順 1ページ目 0.26s（OK）／ 売上順 18s ／ 年齢順 26s ／ 商号部分一致 10〜14s
--
-- 原因と対策:
--   1. 売上順・調査日順・カナ順は「DESC NULLS LAST」に合う複合インデックスが無く全件ソート
--      → (division_id, <列> DESC NULLS LAST, tsr_code) を追加
--   2. 年齢順は personal 側の生年月日で並べたいが、ビューが LEFT JOIN のため planner が
--      personal 側のインデックス順から入れない → 全社に personal 行がある（取込で必ず作る・
--      RLS も同一条件）ので INNER JOIN にし、生年月日を1列の整数キー（rep_birth_key）にして
--      インデックスを張る
--   3. 商号の部分一致（trgm）は、並び順インデックスを先頭から舐めて LIKE で絞る計画を
--      planner が選ぶと、該当が少ないときに実質全件走査になる（LIMIT + ORDER BY の罠）。
--      文字検索のときは「インデックスでは並べられない式の列」（priority_rank + 0 等）で
--      並べ替えることで、先に trgm インデックスで絞ってから少数をソートする計画に誘導する。
--      アプリ（src/lib/db/tsrProspects.ts applySort）は文字検索の有無で列を使い分ける
--
-- ※ 054 適用済みが前提。SQL Editor または直接接続で適用（ビューの作り直しを含む）
-- ============================================================

-- 1. 並び替え用インデックス
CREATE INDEX IF NOT EXISTS idx_tsr_prospects_sales_sort
  ON public.tsr_prospects (division_id, fy1_sales DESC NULLS LAST, tsr_code);
CREATE INDEX IF NOT EXISTS idx_tsr_prospects_surveyed_sort
  ON public.tsr_prospects (division_id, surveyed_on DESC NULLS LAST, tsr_code);
CREATE INDEX IF NOT EXISTS idx_tsr_prospects_kana_sort
  ON public.tsr_prospects (division_id, name_kana ASC NULLS LAST, tsr_code);

-- 2. 生年月日の整数キー（YYYYMMDD。月日不明は 01 で補う）。年齢が高い順＝キーの昇順
ALTER TABLE public.tsr_prospect_personal
  ADD COLUMN IF NOT EXISTS rep_birth_key INTEGER GENERATED ALWAYS AS (
    CASE WHEN rep_birth_year IS NOT NULL
         THEN rep_birth_year * 10000 + COALESCE(rep_birth_month, 1) * 100 + COALESCE(rep_birth_day, 1) END
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_tsr_personal_birth_key
  ON public.tsr_prospect_personal (rep_birth_key ASC NULLS LAST, tsr_code);
DROP INDEX IF EXISTS public.idx_tsr_personal_birth;

-- 3. ビューの作り直し（INNER JOIN・並び替え用の式列を追加）
DROP VIEW IF EXISTS public.tsr_prospects_view;
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
  -- 文字検索時の並び替え専用（インデックスで並べられない式にして trgm 絞り込みを先に行わせる）
  p.priority_rank + 0        AS priority_rank_s,
  p.fy1_sales + 0            AS fy1_sales_s,
  p.surveyed_on + 0          AS surveyed_on_s,
  p.name_kana || ''          AS name_kana_s,
  pp.rep_birth_key + 0       AS rep_birth_key_s
FROM public.tsr_prospects p
JOIN public.tsr_prospect_personal pp ON pp.tsr_code = p.tsr_code;

GRANT SELECT ON public.tsr_prospects_view TO authenticated, service_role;
