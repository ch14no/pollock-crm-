-- ============================================================
-- 058: TSRソーシングリスト 優先度再計算の堅牢化・検索列の大文字化・列単位の更新権限（054〜057の続き）
--
-- /code-review（2026-10-06・4周目）で見つかった実害のある問題への対応:
--   1. 設定画面からの再計算（tsr_recompute_priority）は PostgREST 経由＝authenticated ロールの
--      statement_timeout 8 秒に掛かり、46万行の処理は必ず途中で打ち切られる
--      → 企業コード順に区切って呼べる tsr_recompute_priority_chunk を追加（アプリが1万社ずつ呼ぶ）
--   2. 再計算関数が authenticated 全員に EXECUTE 付与＝誰でも全件走査を連打できる
--      → 関数内で「当該事業部の manager または super_admin」を検査（pg_cron・直接接続は auth.uid() が NULL）
--   3. priority_rank が普通の列になったため、tsr_prospects への UPDATE 権限（表全体）を持つ
--      事業部メンバーが PostgREST から直接書き換えられる
--      → UPDATE 権限を運用列（approach_type, owner_user_id, last_contact_on, status, memo, company_id）に限定。
--        再計算は SECURITY DEFINER（所有者 postgres）で行う
--   4. 2文字以下の前方一致が大文字小文字を区別する（NTT を nt で引けない）
--      → tsr_name_core() で upper() も掛け、アプリ側も検索語を大文字化して like で引く
--   5. pg_cron のジョブは statement_timeout を外していない → コマンドに SET を前置して登録し直す
--
-- ※ 057 適用済みが前提。生成列の作り直しでテーブルの書き直し（数分）を伴う。
-- ============================================================

-- ─── 4. 検索用列を大文字化（生成列は関数を変えても再計算されないので作り直す） ───────
DROP VIEW IF EXISTS public.tsr_prospects_view;
ALTER TABLE public.tsr_prospects
  DROP COLUMN IF EXISTS name_core,
  DROP COLUMN IF EXISTS name_kana_core;

CREATE OR REPLACE FUNCTION public.tsr_name_core(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT NULLIF(btrim(regexp_replace(regexp_replace(upper(normalize(p, NFKC)),
    '^\s*(株式会社|有限会社|合同会社|合資会社|合名会社|医療法人社団|医療法人財団|医療法人|社会福祉法人|社会医療法人|学校法人|宗教法人|一般社団法人|公益社団法人|一般財団法人|公益財団法人|特定非営利活動法人|NPO法人|農事組合法人|企業組合|協同組合|生活協同組合|\(株\)|㈱|\(有\)|㈲|\(同\)|カブシキガイシャ|カブシキカイシャ|ユウゲンガイシャ|ユウゲンカイシャ|ゴウドウガイシャ|ゴウドウカイシャ|イリョウホウジン|シャカイフクシホウジン|ガッコウホウジン|イッパンシャダンホウジン|イッパンザイダンホウジン)\s*', ''),
    '\s*(株式会社|有限会社|合同会社|合資会社|合名会社|\(株\)|㈱|\(有\)|㈲|\(同\)|カブシキガイシャ|カブシキカイシャ|ユウゲンガイシャ|ユウゲンカイシャ|ゴウドウガイシャ|ゴウドウカイシャ)\s*$', '')), '')
$$;

ALTER TABLE public.tsr_prospects
  ADD COLUMN name_core      TEXT GENERATED ALWAYS AS (public.tsr_name_core(name)) STORED,
  ADD COLUMN name_kana_core TEXT GENERATED ALWAYS AS (public.tsr_name_core(name_kana)) STORED;

CREATE INDEX idx_tsr_prospects_name_core_prefix      ON public.tsr_prospects (name_core text_pattern_ops);
CREATE INDEX idx_tsr_prospects_name_kana_core_prefix ON public.tsr_prospects (name_kana_core text_pattern_ops);
CREATE INDEX idx_tsr_prospects_name_core_trgm      ON public.tsr_prospects USING gin (name_core extensions.gin_trgm_ops);
CREATE INDEX idx_tsr_prospects_name_kana_core_trgm ON public.tsr_prospects USING gin (name_kana_core extensions.gin_trgm_ops);

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

-- ─── 3. UPDATE 権限を運用列に限定 ───────────────────────────────
-- promote_tsr_prospect（SECURITY INVOKER）の SELECT ... FOR UPDATE は「いずれかの列の UPDATE 権限」で足りる
REVOKE UPDATE ON public.tsr_prospects FROM authenticated;
GRANT  UPDATE (approach_type, owner_user_id, last_contact_on, status, memo, company_id)
  ON public.tsr_prospects TO authenticated;

-- ─── 2. 再計算の権限検査 ──────────────────────────────────────
-- auth.uid() が NULL（pg_cron・直接接続）は通す。アプリ経由は当該事業部の manager か super_admin のみ
CREATE OR REPLACE FUNCTION public.tsr_assert_priority_admin(p_division_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_role TEXT;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT role INTO v_role FROM public.users WHERE id = v_uid;
  IF v_role = 'super_admin' THEN RETURN; END IF;
  IF v_role = 'manager' AND p_division_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.user_divisions WHERE user_id = v_uid AND division_id = p_division_id) THEN
    RETURN;
  END IF;
  RAISE EXCEPTION '優先度の再計算は当該事業部のマネージャーまたは super_admin のみ実行できます' USING ERRCODE = '42501';
END $$;
REVOKE EXECUTE ON FUNCTION public.tsr_assert_priority_admin(UUID) FROM PUBLIC, anon, authenticated;

-- ─── 1. 再計算（全件版＝取込・cron 用／区切り版＝設定画面用） ───────────
-- SECURITY DEFINER: 所有者 postgres として実行（列単位の UPDATE 権限と RLS の外で動く）。
-- 入口は上の権限検査で守る
CREATE OR REPLACE FUNCTION public.tsr_recompute_priority(p_division_id UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INTEGER;
BEGIN
  PERFORM public.tsr_assert_priority_admin(p_division_id);
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

-- 企業コード順に p_after より後ろの p_limit 社を処理し、次の開始位置を返す（最後は next_code = NULL）
CREATE OR REPLACE FUNCTION public.tsr_recompute_priority_chunk(p_division_id UUID, p_after TEXT, p_limit INTEGER DEFAULT 10000)
RETURNS TABLE (next_code TEXT, processed INTEGER, updated INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_last TEXT;
  v_n    INTEGER;
  v_u    INTEGER;
BEGIN
  IF p_division_id IS NULL THEN
    RAISE EXCEPTION '事業部を指定してください' USING ERRCODE = '22023';
  END IF;
  PERFORM public.tsr_assert_priority_admin(p_division_id);
  WITH batch AS (
    SELECT p.tsr_code, p.priority_rank, p.fy1_sales, p.division_id
    FROM public.tsr_prospects p
    WHERE p.division_id = p_division_id AND p.tsr_code > COALESCE(p_after, '')
    ORDER BY p.tsr_code
    LIMIT GREATEST(1, LEAST(p_limit, 50000))
  ), calc AS (
    SELECT b.tsr_code, b.priority_rank AS old_rank,
      CASE
        WHEN a.age IS NULL THEN 3
        WHEN a.age >= s.s_min_age AND COALESCE(b.fy1_sales, 0) >= s.s_min_sales_thousand_yen THEN 0
        WHEN a.age >= s.a_min_age
             OR (a.age >= s.a2_min_age AND COALESCE(b.fy1_sales, 0) >= s.a2_min_sales_thousand_yen) THEN 1
        ELSE 2
      END AS rank
    FROM batch b
    LEFT JOIN public.tsr_prospect_personal pp ON pp.tsr_code = b.tsr_code
    LEFT JOIN public.tsr_priority_settings s ON s.division_id = b.division_id
    CROSS JOIN LATERAL (SELECT public.tsr_rep_age(pp.rep_birth_year, pp.rep_birth_month, pp.rep_birth_day) AS age) a
  ), upd AS (
    UPDATE public.tsr_prospects p SET priority_rank = c.rank
    FROM calc c
    WHERE c.tsr_code = p.tsr_code AND c.old_rank IS DISTINCT FROM c.rank
    RETURNING p.tsr_code
  )
  SELECT max(c.tsr_code), count(*)::int, (SELECT count(*) FROM upd)::int
    INTO v_last, v_n, v_u
  FROM calc c;
  next_code := CASE WHEN v_n < GREATEST(1, LEAST(p_limit, 50000)) THEN NULL ELSE v_last END;
  processed := v_n;
  updated   := v_u;
  RETURN NEXT;
END $$;

REVOKE EXECUTE ON FUNCTION public.tsr_recompute_priority(UUID)                        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tsr_recompute_priority_chunk(UUID, TEXT, INTEGER)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tsr_recompute_priority(UUID)                        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.tsr_recompute_priority_chunk(UUID, TEXT, INTEGER)   TO authenticated;

-- ─── 5. cron を statement_timeout 無効化つきで登録し直す ───────────
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'tsr-recompute-priority';
  PERFORM cron.schedule('tsr-recompute-priority', '0 18 * * *',
    'SET statement_timeout = 0; SELECT public.tsr_recompute_priority(NULL)');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron の登録をスキップしました: %', SQLERRM;
END $$;
