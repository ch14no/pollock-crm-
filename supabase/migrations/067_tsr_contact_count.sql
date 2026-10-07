-- ============================================================
-- 067: 一覧に「担当者数」を出す（/code-review 指摘: 「担当者あり」が company_id の有無で判定されていた）
--
-- 手動登録の会社（064）は作成時点で company_id を持つため、担当者が 0 名でも「担当者あり」に
-- 見えてしまう。ビューに contact_count（同事業部の contacts 件数）を加え、絞り込み
-- 「名刺（担当者）の登録」も contacts の有無で判定する。
--
-- contact_count は相関副問い合わせだが、評価されるのは出力行（1ページ分）だけ。
-- 絞り込み（promoted）は EXISTS で contacts（小さい表・company_id 索引あり）と突き合わせる。
--
-- ※ 064 と同じく、ビューの作り直しのため tsr_search を先に落として再作成する。
-- ============================================================

CREATE OR REPLACE FUNCTION public.tsr_search_where(p_filters JSONB, p_alias TEXT)
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE
  f      JSONB := COALESCE(p_filters, '{}'::jsonb);
  a      TEXT  := COALESCE(p_alias, 'p');
  w      TEXT[] := ARRAY['TRUE'];
  t      TEXT;
  core   TEXT;
  digits TEXT;
  code   TEXT;
  rank   INT;
  key_hi INT;
  key_lo INT;
BEGIN
  t := NULLIF(btrim(COALESCE(f->>'query', '')), '');
  IF t IS NOT NULL THEN
    t := btrim(regexp_replace(normalize(t, NFKC), '[,()"\\%_*]', ' ', 'g'));
    IF t <> '' AND t ~ '^[0-9\-\s()+]+$' AND t ~ '[0-9]' THEN
      digits := regexp_replace(t, '[^0-9]', '', 'g');
      IF length(digits) <= 9 AND length(digits) >= 4 THEN
        w := w || format('(%I.tsr_code = %L OR %I.phone_digits LIKE %L)', a, lpad(digits, 9, '0'), a, '%' || digits || '%');
      ELSIF length(digits) <= 9 THEN
        w := w || format('%I.tsr_code = %L', a, lpad(digits, 9, '0'));
      ELSE
        w := w || format('%I.phone_digits LIKE %L', a, '%' || digits || '%');
      END IF;
    ELSIF t <> '' THEN
      core := COALESCE(public.tsr_name_core(t), upper(t));
      IF length(replace(core, ' ', '')) <= 2 THEN
        core := replace(core, ' ', '');
        w := w || format('(%I.name_core LIKE %L OR %I.name_kana_core LIKE %L)', a, core || '%', a, core || '%');
      ELSE
        w := w || format('(%I.name_core LIKE %L OR %I.name_kana_core LIKE %L)', a, '%' || core || '%', a, '%' || core || '%');
      END IF;
    END IF;
  END IF;

  IF NULLIF(f->>'prefecture', '') IS NOT NULL THEN
    w := w || format('%I.prefecture = %L', a, f->>'prefecture');
  END IF;

  code := NULLIF(f->>'industryCode', '');
  IF code IS NOT NULL THEN
    IF code ~ '^[0-9]{4}$' THEN
      w := w || format('(%I.industry1_code = %L OR %I.industry2_code = %L OR %I.industry3_code = %L)', a, code, a, code, a, code);
    ELSIF code ~ '^[0-9]{1,3}$' THEN
      w := w || format('(%I.industry1_code LIKE %L OR %I.industry2_code LIKE %L OR %I.industry3_code LIKE %L)', a, code || '%', a, code || '%', a, code || '%');
    END IF;
  END IF;

  IF jsonb_typeof(f->'employeesMin') = 'number' THEN w := w || format('%I.employee_count >= %s', a, (f->>'employeesMin')::numeric); END IF;
  IF jsonb_typeof(f->'employeesMax') = 'number' THEN w := w || format('%I.employee_count <= %s', a, (f->>'employeesMax')::numeric); END IF;
  IF jsonb_typeof(f->'capitalMin')   = 'number' THEN w := w || format('%I.capital_thousand_yen >= %s', a, (f->>'capitalMin')::numeric); END IF;
  IF jsonb_typeof(f->'capitalMax')   = 'number' THEN w := w || format('%I.capital_thousand_yen <= %s', a, (f->>'capitalMax')::numeric); END IF;
  IF jsonb_typeof(f->'salesMin')     = 'number' THEN w := w || format('%I.fy1_sales >= %s', a, (f->>'salesMin')::numeric); END IF;
  IF jsonb_typeof(f->'salesMax')     = 'number' THEN w := w || format('%I.fy1_sales <= %s', a, (f->>'salesMax')::numeric); END IF;

  IF jsonb_typeof(f->'ageMin') = 'number' THEN
    key_hi := to_char(CURRENT_DATE - make_interval(years => (f->>'ageMin')::int), 'YYYYMMDD')::int;
    w := w || format('%I.rep_birth_key <= %s', a, key_hi);
  END IF;
  IF jsonb_typeof(f->'ageMax') = 'number' THEN
    key_lo := to_char(CURRENT_DATE - make_interval(years => (f->>'ageMax')::int + 1), 'YYYYMMDD')::int;
    w := w || format('%I.rep_birth_key > %s', a, key_lo);
  END IF;

  rank := CASE f->>'priority' WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN '不明' THEN 3 END;
  IF rank IS NOT NULL THEN w := w || format('%I.priority_rank = %s', a, rank); END IF;

  IF NULLIF(f->>'status', '') IS NOT NULL THEN w := w || format('%I.status = %L', a, f->>'status'); END IF;
  IF (f->>'ownerUserId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    w := w || format('%I.owner_user_id = %L::uuid', a, f->>'ownerUserId');
  END IF;
  IF jsonb_typeof(f->'surveyedYear') = 'number' THEN
    w := w || format('%I.surveyed_on >= %L::date AND %I.surveyed_on < %L::date', a, make_date((f->>'surveyedYear')::int, 1, 1), a, make_date((f->>'surveyedYear')::int + 1, 1, 1));
  END IF;
  -- 067: 「名刺（担当者）の登録」は company_id ではなく、同事業部の contacts があるかで判定
  IF f->>'promoted' = 'yes' THEN
    w := w || format('EXISTS (SELECT 1 FROM public.contacts c WHERE c.company_id = %I.company_id AND c.division_id = %I.division_id)', a, a);
  END IF;
  IF f->>'promoted' = 'no' THEN
    w := w || format('NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.company_id = %I.company_id AND c.division_id = %I.division_id)', a, a);
  END IF;
  IF f->>'source' IN ('tsr', 'manual') THEN w := w || format('%I.source = %L', a, f->>'source'); END IF;

  RETURN array_to_string(w, ' AND ');
END $$;

DROP FUNCTION IF EXISTS public.tsr_search(UUID, JSONB, TEXT, INTEGER, INTEGER, BOOLEAN);
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
  p.priority_rank + 0        AS priority_rank_s,
  p.fy1_sales + 0            AS fy1_sales_s,
  p.surveyed_on + 0          AS surveyed_on_s,
  p.name_kana || ''          AS name_kana_s,
  pp.rep_birth_key + 0       AS rep_birth_key_s,
  -- 067: 同事業部の担当者数（出力行だけで評価される相関副問い合わせ）
  CASE WHEN p.company_id IS NULL THEN 0
       ELSE (SELECT count(*)::int FROM public.contacts c WHERE c.company_id = p.company_id AND c.division_id = p.division_id) END AS contact_count
FROM public.tsr_prospects p
JOIN public.tsr_prospect_personal pp ON pp.tsr_code = p.tsr_code;
GRANT SELECT ON public.tsr_prospects_view TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tsr_search(
  p_division_id UUID,
  p_filters JSONB DEFAULT '{}'::jsonb,
  p_sort TEXT DEFAULT 'priority',
  p_limit INTEGER DEFAULT 51,
  p_offset INTEGER DEFAULT 0,
  p_include_personal BOOLEAN DEFAULT TRUE
)
RETURNS SETOF public.tsr_prospects_view
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_where TEXT;
  v_order TEXT;
  v_s     TEXT;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 51), 1), 1001);
  v_off   INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  PERFORM public.tsr_assert_member(p_division_id);
  v_where := public.tsr_search_where(p_filters, 'v');
  v_s := CASE WHEN NULLIF(btrim(COALESCE(p_filters->>'query', '')), '') IS NOT NULL THEN '_s' ELSE '' END;
  v_order := CASE p_sort
    WHEN 'sales_desc'    THEN format('v.fy1_sales%s DESC NULLS LAST, v.tsr_code', v_s)
    WHEN 'age_desc'      THEN format('v.rep_birth_key%s ASC NULLS LAST, v.tsr_code', v_s)
    WHEN 'surveyed_desc' THEN format('v.surveyed_on%s DESC NULLS LAST, v.tsr_code', v_s)
    WHEN 'name'          THEN format('v.name_kana%s ASC NULLS LAST, v.tsr_code', v_s)
    ELSE format('v.priority_rank%s ASC, v.fy1_sales%s DESC NULLS LAST, v.tsr_code', v_s, v_s)
  END;
  IF p_include_personal THEN
    RETURN QUERY EXECUTE format(
      'SELECT v.* FROM public.tsr_prospects_view v WHERE v.division_id = %L AND %s ORDER BY %s LIMIT %s OFFSET %s',
      p_division_id, v_where, v_order, v_limit, v_off);
  ELSE
    RETURN QUERY EXECUTE format($q$
      SELECT (jsonb_populate_record(NULL::public.tsr_prospects_view,
                to_jsonb(v) - ARRAY['rep_name','rep_name_kana','rep_home_address','rep_birth_year','rep_birth_month',
                                    'rep_birth_day','rep_birth_key','rep_birth_key_s','rep_birthplace','rep_school'])).*
      FROM public.tsr_prospects_view v WHERE v.division_id = %L AND %s ORDER BY %s LIMIT %s OFFSET %s$q$,
      p_division_id, v_where, v_order, v_limit, v_off);
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.tsr_search(UUID, JSONB, TEXT, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tsr_search(UUID, JSONB, TEXT, INTEGER, INTEGER, BOOLEAN) TO authenticated;
