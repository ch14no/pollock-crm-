-- ============================================================
-- 062: TSRソーシングリスト 検索・件数を SECURITY DEFINER の関数（RPC）に移す
--
-- 本番（2026-10-06）の実行計画で判明したこと:
--   Postgres の LIKE（textlike / texticlike）は leakproof ではないため、RLS が効く状態では
--   「RLS の条件を先に評価してから LIKE を評価する」順序が強制され、LIKE をインデックス条件に
--   使えない。結果、商号検索は 46 万行の全件走査（直接接続 11ms に対し authenticated で 4〜15 秒）
--   になり、statement_timeout 8 秒で「読み込みに失敗」になっていた。061 の RLS 書き換えでは解けない。
--
-- 対策:
--   検索（tsr_search）と件数（tsr_search_count）を SECURITY DEFINER（所有者 postgres・RLS の外）の
--   関数にし、入口で「ログイン済み かつ その事業部の所属（または super_admin）」を検査する。
--   絞り込み条件は JSON（アプリの TsrFilters と同じキー）で受け取り、WHERE 句の組み立ては
--   tsr_search_where() に一本化。検索語の正規化（NFKC・大文字化・法人格除去）と年齢→生年月日キーの
--   変換も DB 側で行い、アプリ側の実装と二重にならないようにする。
--   RLS 自体は残す（テーブルを直接読む経路の防御線）。
--
-- ※ 061 適用済みが前提。
-- ============================================================

-- ─── 権限検査（ログイン必須。当該事業部の所属 or super_admin） ─────────
CREATE OR REPLACE FUNCTION public.tsr_assert_member(p_division_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_role TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = '42501';
  END IF;
  IF p_division_id IS NULL THEN
    RAISE EXCEPTION '事業部を指定してください' USING ERRCODE = '22023';
  END IF;
  SELECT role INTO v_role FROM public.users WHERE id = v_uid;
  IF v_role = 'super_admin' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.user_divisions WHERE user_id = v_uid AND division_id = p_division_id) THEN RETURN; END IF;
  RAISE EXCEPTION 'この事業部のソーシングリストを閲覧する権限がありません' USING ERRCODE = '42501';
END $$;
REVOKE EXECUTE ON FUNCTION public.tsr_assert_member(UUID) FROM PUBLIC, anon, authenticated;

-- ─── 絞り込み条件（JSON）→ WHERE 句 ─────────────────────────────
-- p_alias: 'p'（tsr_prospects 本体）または 'v'（tsr_prospects_view）。値はすべて %L で埋め込む。
-- JSON のキーはアプリの TsrFilters と同じ:
--   query, prefecture, industryCode, employeesMin/Max, capitalMin/Max, salesMin/Max（千円）,
--   ageMin/Max（歳）, priority（S/A/B/不明）, status, ownerUserId, surveyedYear, promoted（yes/no）
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
  -- 文字検索
  t := NULLIF(btrim(COALESCE(f->>'query', '')), '');
  IF t IS NOT NULL THEN
    -- PostgREST 時代の予約文字とワイルドカードを落とし、NFKC 正規化
    t := btrim(regexp_replace(normalize(t, NFKC), '[,()"\\%_*]', ' ', 'g'));
    IF t <> '' AND t ~ '^[0-9\-\s()+]+$' AND t ~ '[0-9]' THEN
      -- 数字だけ: 企業コード（9桁以下・先頭ゼロ落ち許容）と電話番号（数字化列の部分一致）
      digits := regexp_replace(t, '[^0-9]', '', 'g');
      IF length(digits) <= 9 AND length(digits) >= 4 THEN
        w := w || format('(%I.tsr_code = %L OR %I.phone_digits LIKE %L)', a, lpad(digits, 9, '0'), a, '%' || digits || '%');
      ELSIF length(digits) <= 9 THEN
        w := w || format('%I.tsr_code = %L', a, lpad(digits, 9, '0'));
      ELSE
        w := w || format('%I.phone_digits LIKE %L', a, '%' || digits || '%');
      END IF;
    ELSIF t <> '' THEN
      -- 商号: 法人格を除き大文字化した列と同じ規則で検索語を揃える
      core := COALESCE(public.tsr_name_core(t), upper(t));
      IF length(replace(core, ' ', '')) <= 2 THEN
        -- 2文字以下は trgm が効かないので前方一致（btree text_pattern_ops）
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

  -- 年齢は生年月日キー（YYYYMMDD、055）の範囲に変換する。N歳以上 ⇔ キー ≦ 今日のN年前、
  -- M歳以下 ⇔ キー ＞ 今日の(M+1)年前。日付演算は PG に任せる（2/29 の平年は 2/28 に丸まる）。
  -- 年齢列は代表者側（personal）にあるため、本体テーブル単独では評価できない（呼び出し側で判定）
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
  IF f->>'promoted' = 'yes' THEN w := w || format('%I.company_id IS NOT NULL', a); END IF;
  IF f->>'promoted' = 'no'  THEN w := w || format('%I.company_id IS NULL', a); END IF;

  RETURN array_to_string(w, ' AND ');
END $$;
REVOKE EXECUTE ON FUNCTION public.tsr_search_where(JSONB, TEXT) FROM PUBLIC, anon, authenticated;

-- 年齢の条件が含まれるか（本体テーブル単独で数えられないため）
CREATE OR REPLACE FUNCTION public.tsr_filters_use_personal(p_filters JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(COALESCE(p_filters, '{}'::jsonb)->'ageMin') = 'number'
      OR jsonb_typeof(COALESCE(p_filters, '{}'::jsonb)->'ageMax') = 'number'
$$;

-- ─── 検索（1ページ分） ──────────────────────────────────────
-- p_sort: priority / sales_desc / age_desc / surveyed_desc / name（それ以外は priority）
-- 文字検索があるときは式の列（*_s）で並べ、索引順に全件を舐める計画を避ける（055）
-- p_include_personal=false なら代表者の個人情報列（生年月日キー含む）を NULL にして返す
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

-- ─── 件数 ──────────────────────────────────────────────
-- 年齢の条件が無ければ本体テーブル（060 のカバリング索引で索引だけで数えられる）、あればビュー
CREATE OR REPLACE FUNCTION public.tsr_search_count(p_division_id UUID, p_filters JSONB DEFAULT '{}'::jsonb)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n BIGINT;
BEGIN
  PERFORM public.tsr_assert_member(p_division_id);
  IF public.tsr_filters_use_personal(p_filters) THEN
    EXECUTE format('SELECT count(*) FROM public.tsr_prospects_view v WHERE v.division_id = %L AND %s',
      p_division_id, public.tsr_search_where(p_filters, 'v')) INTO v_n;
  ELSE
    EXECUTE format('SELECT count(*) FROM public.tsr_prospects p WHERE p.division_id = %L AND %s',
      p_division_id, public.tsr_search_where(p_filters, 'p')) INTO v_n;
  END IF;
  RETURN v_n;
END $$;

REVOKE EXECUTE ON FUNCTION public.tsr_search(UUID, JSONB, TEXT, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tsr_search_count(UUID, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tsr_search(UUID, JSONB, TEXT, INTEGER, INTEGER, BOOLEAN) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.tsr_search_count(UUID, JSONB) TO authenticated;
