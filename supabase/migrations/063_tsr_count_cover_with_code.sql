-- ============================================================
-- 063: 件数カウント用カバリング索引に tsr_code を含める（060 の作り直し）
--
-- 年齢の絞り込みを含む件数（tsr_search_count → ビュー経由）は、本体（tsr_prospects）と
-- 代表者（tsr_prospect_personal）を tsr_code で突き合わせる。060 の索引は tsr_code を
-- 含んでいなかったため本体側が表本体の読みになり、本番で 14 秒（8 秒超）かかった。
-- tsr_code を INCLUDE すると、本体側はカバリング索引、代表者側は (rep_birth_key, tsr_code)
-- 索引だけで突き合わせられる（Index Only Scan 同士のハッシュ結合）。
--
-- ※ CONCURRENTLY のためトランザクションの外で、2 文を順に実行する。
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tsr_prospects_count_cover2
  ON public.tsr_prospects (division_id)
  INCLUDE (tsr_code, prefecture, priority_rank, fy1_sales, employee_count, capital_thousand_yen,
           industry1_code, industry2_code, industry3_code, status, owner_user_id, surveyed_on, company_id);
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tsr_prospects_count_cover;
