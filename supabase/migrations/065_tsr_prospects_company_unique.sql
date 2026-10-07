-- ============================================================
-- 065: 「1つの会社は同じ事業部で1行だけ」の一意索引（064 の続き）
--
-- 統合（tsr_merge_link / promote_tsr_prospect / tsr_create_manual_prospect）はいずれも
-- tsr_prospects.company_id を書く。同じ会社が同事業部で2行に紐づくと名刺管理・活動が
-- 二重に見えるため、DB の不変条件にする。
--
-- 事前チェック（0 件であること。あれば余分な行を tsr_merge_unlink してから）:
--   SELECT division_id, company_id, count(*) FROM public.tsr_prospects
--    WHERE company_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
--
-- ※ CONCURRENTLY のためトランザクションの外で実行する。
-- ============================================================
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_tsr_prospects_division_company
  ON public.tsr_prospects (division_id, company_id) WHERE company_id IS NOT NULL;
