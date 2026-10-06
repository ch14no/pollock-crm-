-- ============================================================
-- 060: TSRソーシングリスト 件数カウント用のカバリング索引
--
-- 一覧の件数は PostgREST の estimated（統計ベース）だと RLS の条件が絡んで大きく外れる
-- （本番で 461,276 社が「116,475社」と表示された）。アプリは 058 以降、ページ取得と並行して
-- 本体テーブルに count(*) を投げて正確な件数を出す方式にした（src/lib/db/tsrProspects.ts）。
-- ただし authenticated の statement_timeout は 8 秒で、都道府県などで絞った count(*) が
-- 索引→本体表の読み（46万行中 7万行のランダム読み）になると Nano 計算機では 19 秒かかった。
--
-- 対策: 絞り込みに使う列を INCLUDE したカバリング索引を1本持ち、count(*) を索引だけで
-- 完結させる（Index Only Scan）。46万行 × 約60バイト ≒ 30〜40MB。
-- 文字検索（trgm）と年齢範囲（代表者側の列）は対象外（それぞれ GIN／ビュー経由で数える）。
--
-- ※ CONCURRENTLY のためトランザクションの外で実行する（SQL Editor なら単独で実行）。
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tsr_prospects_count_cover
  ON public.tsr_prospects (division_id)
  INCLUDE (prefecture, priority_rank, fy1_sales, employee_count, capital_thousand_yen,
           industry1_code, industry2_code, industry3_code, status, owner_user_id, surveyed_on, company_id);
