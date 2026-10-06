-- ============================================================
-- 054: TSRソーシングリスト 優先度の事前計算（検索性能対策）
--
-- 053 ではアプローチ優先度をビューで毎回算出していたが、46万行では
-- 「優先度順で1ページ目を出す」だけで全行の計算＋並べ替えになり 7 秒かかった
-- （本番実測・2026-10-06）。優先度を tsr_prospects.priority_rank に保存し、
-- (division_id, priority_rank, fy1_sales DESC, tsr_code) の複合インデックスで
-- 先頭ページを即座に取れるようにする。
--
-- 再計算のタイミング（年齢は日々変わるため完全な即時性は求めない）:
--   1. 取込スクリプトの最後（scripts/import-tsr.mjs）
--   2. 設定画面で判定条件を保存したとき（アプリから tsr_recompute_priority を呼ぶ）
--   3. 毎日 03:00 JST の pg_cron（誕生日を迎えて年齢が変わった分の追従）
--
-- ※ 053 と同じく SQL Editor（または直接接続）で手動適用。053 適用済みが前提。
-- ============================================================

-- 満年齢（月日まで考慮）。ビューと再計算の両方でこの1つを使う
CREATE OR REPLACE FUNCTION public.tsr_rep_age(y SMALLINT, m SMALLINT, d SMALLINT)
RETURNS INTEGER LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN y IS NULL THEN NULL ELSE
    EXTRACT(YEAR FROM CURRENT_DATE)::int - y
    - CASE WHEN m IS NOT NULL AND (
             EXTRACT(MONTH FROM CURRENT_DATE)::int < m OR
             (EXTRACT(MONTH FROM CURRENT_DATE)::int = m
              AND EXTRACT(DAY FROM CURRENT_DATE)::int < COALESCE(d, 1)))
           THEN 1 ELSE 0 END
  END
$$;

ALTER TABLE public.tsr_prospects
  ADD COLUMN IF NOT EXISTS priority_rank SMALLINT NOT NULL DEFAULT 3;  -- 0=S 1=A 2=B 3=不明

-- 優先度の再計算。p_division_id が NULL なら全事業部。変化のある行だけ更新する。
-- SECURITY INVOKER: アプリから呼ぶときは呼び出した人の RLS（tsr_prospects_update）が効く
CREATE OR REPLACE FUNCTION public.tsr_recompute_priority(p_division_id UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE v_n INTEGER;
BEGIN
  WITH calc AS (
    SELECT p.tsr_code,
      CASE
        WHEN a.age IS NULL THEN 3
        WHEN a.age >= s.s_min_age AND COALESCE(p.fy1_sales, 0) >= s.s_min_sales_thousand_yen THEN 0
        WHEN a.age >= s.a_min_age
             OR (a.age >= s.a2_min_age AND COALESCE(p.fy1_sales, 0) >= s.a2_min_sales_thousand_yen) THEN 1
        ELSE 2
      END AS rank
    FROM public.tsr_prospects p
    LEFT JOIN public.tsr_prospect_personal pp ON pp.tsr_code = p.tsr_code
    LEFT JOIN public.tsr_priority_settings s ON s.division_id = p.division_id
    CROSS JOIN LATERAL (SELECT public.tsr_rep_age(pp.rep_birth_year, pp.rep_birth_month, pp.rep_birth_day) AS age) a
    WHERE p_division_id IS NULL OR p.division_id = p_division_id
  )
  UPDATE public.tsr_prospects p SET priority_rank = c.rank
  FROM calc c
  WHERE c.tsr_code = p.tsr_code AND p.priority_rank IS DISTINCT FROM c.rank;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE EXECUTE ON FUNCTION public.tsr_recompute_priority(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tsr_recompute_priority(UUID) TO authenticated;

-- 並び替え用インデックス（優先度順＝既定の並び。年齢順は personal 側の生年月日で引く）
CREATE INDEX IF NOT EXISTS idx_tsr_prospects_priority_sort
  ON public.tsr_prospects (division_id, priority_rank, fy1_sales DESC NULLS LAST, tsr_code);
CREATE INDEX IF NOT EXISTS idx_tsr_personal_birth
  ON public.tsr_prospect_personal (rep_birth_year, rep_birth_month, rep_birth_day, tsr_code);

-- priority_rank の更新で updated_at を動かさない（運用列の更新日時として使うため）
-- → tsr_set_updated_at は BEFORE UPDATE 全列で発火するので、再計算時だけ値を戻す
CREATE OR REPLACE FUNCTION public.tsr_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.priority_rank IS DISTINCT FROM OLD.priority_rank
     AND row(NEW.approach_type, NEW.owner_user_id, NEW.last_contact_on, NEW.status, NEW.memo, NEW.company_id)
         IS NOT DISTINCT FROM row(OLD.approach_type, OLD.owner_user_id, OLD.last_contact_on, OLD.status, OLD.memo, OLD.company_id)
     AND NEW.imported_at IS NOT DISTINCT FROM OLD.imported_at THEN
    NEW.updated_at = OLD.updated_at;
  ELSE
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END $$;

-- ビューを保存済みの priority_rank を使う形に作り直す（列構成が変わるので DROP → CREATE）
DROP VIEW IF EXISTS public.tsr_prospects_view;
CREATE VIEW public.tsr_prospects_view
WITH (security_invoker = true) AS
SELECT
  p.*,
  pp.rep_name, pp.rep_name_kana, pp.rep_home_address,
  pp.rep_birth_year, pp.rep_birth_month, pp.rep_birth_day,
  pp.rep_birthplace, pp.rep_school,
  public.tsr_rep_age(pp.rep_birth_year, pp.rep_birth_month, pp.rep_birth_day) AS rep_age,
  CASE WHEN p.surveyed_on IS NOT NULL
       THEN ROUND((CURRENT_DATE - p.surveyed_on) / 365.25, 1) END AS data_age_years,
  (ARRAY['S', 'A', 'B', '不明'])[p.priority_rank + 1] AS approach_priority
FROM public.tsr_prospects p
LEFT JOIN public.tsr_prospect_personal pp ON pp.tsr_code = p.tsr_code;

GRANT SELECT ON public.tsr_prospects_view TO authenticated, service_role;

-- 初回の全件計算
SELECT public.tsr_recompute_priority(NULL);

-- 毎日 03:00 JST（= 18:00 UTC）に再計算。pg_cron が使えない環境では黙ってスキップ
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.unschedule('tsr-recompute-priority') FROM cron.job WHERE jobname = 'tsr-recompute-priority';
  PERFORM cron.schedule('tsr-recompute-priority', '0 18 * * *', 'SELECT public.tsr_recompute_priority(NULL)');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron の登録をスキップしました: %', SQLERRM;
END $$;
