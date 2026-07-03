-- ============================================================
-- pipeline_tabs テーブルへのGRANT権限付与
-- ============================================================
-- 007_pipeline_tabs.sql でRLSポリシーは設定したが、テーブル自体への
-- Postgresレベルのgrant（GRANT SELECT/INSERT/UPDATE/DELETE）を
-- authenticatedロールに付与し忘れていた。RLSはgrantの上でさらに
-- 絞り込む仕組みのため、grant自体が無いと「permission denied for
-- table pipeline_tabs」というRLS以前のエラーになる。
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_tabs TO authenticated;
