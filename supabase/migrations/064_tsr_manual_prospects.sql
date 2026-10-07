-- ============================================================
-- 064: 顧客（人）→ソーシング（会社）統合 その1 — 手動登録の会社行・会社との紐づけ基盤
--
-- M&A事業部の依頼（2026-10-07）: TSRリストを会社単位の基本データとし、担当者（contacts）を
-- 会社にぶら下げて一本化する。TSR に存在しない会社（個人事業主・新設等）も同じ一覧で
-- 扱えるよう、tsr_prospects に「手動登録」行（source='manual'、コード 'M' + 8桁）を置く。
--
-- 設計の核: 統合＝ tsr_prospects.company_id を書くだけ。contacts は company_id 経由で会社に
-- ぶら下がり、活動・タスク・案件は contact_id 経由で会社ページから見える（データ移動なし）。
-- TSR 由来の列も companies 行も書き換えない。
--
-- このファイルで行うこと:
--   1. source / company_linked_at 列、手動コード用シーケンス、CHECK（NOT VALID→VALIDATE）
--   2. 権限検査 tsr_assert_division_manager（manager/super_admin）
--   3. companies → 手動行への写像（tsr_apply_company_to_manual_row）と、
--      手動行の作成 tsr_create_manual_prospect（会社行が無ければ作る）
--   4. companies の更新/削除トリガー（手動行だけ同期。TSR 行は同期しない＝TSR値が勝つ）
--   5. promote_tsr_prospect v2（手動行は company_id をそのまま返す／他行に紐づく会社は再利用しない）
--   6. tsr_search_where に source フィルタ、ビューと tsr_search の作り直し（p.* の再展開）
--   7. shares_division_with_activity_target に 'company' 分岐（会社全体を対象にした活動の閲覧）
--
-- ※ 063 適用済みが前提。直接接続で 1 トランザクションとして適用。
-- ============================================================

-- ─── 1. 列・シーケンス・制約 ───────────────────────────────────
ALTER TABLE public.tsr_prospects
  ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'tsr',          -- 'tsr' | 'manual'
  ADD COLUMN IF NOT EXISTS company_linked_at TIMESTAMPTZ;                      -- companies と紐づけた日時

CREATE SEQUENCE IF NOT EXISTS public.tsr_manual_code_seq;

-- TSR の企業コードは 9 桁の数字、手動登録は 'M' + 8 桁。取込（import-tsr.mjs）は数字しか作らないので
-- 衝突しないが、制約で保証する。NOT VALID → VALIDATE で 46 万行のロックを短くする
ALTER TABLE public.tsr_prospects
  ADD CONSTRAINT tsr_prospects_source_code_chk CHECK (
    (source = 'tsr'    AND tsr_code ~ '^[0-9]{9}$') OR
    (source = 'manual' AND tsr_code ~ '^M[0-9]{8}$')
  ) NOT VALID;
ALTER TABLE public.tsr_prospects VALIDATE CONSTRAINT tsr_prospects_source_code_chk;

CREATE INDEX IF NOT EXISTS idx_tsr_prospects_source_manual
  ON public.tsr_prospects (division_id) WHERE source = 'manual';

-- ─── 2. 権限検査（当該事業部の manager または super_admin。auth.uid() NULL＝直接接続は通す） ───
CREATE OR REPLACE FUNCTION public.tsr_assert_division_manager(p_division_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_role TEXT;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  IF p_division_id IS NULL THEN
    RAISE EXCEPTION '事業部を指定してください' USING ERRCODE = '22023';
  END IF;
  SELECT role INTO v_role FROM public.users WHERE id = v_uid;
  IF v_role = 'super_admin' THEN RETURN; END IF;
  IF v_role = 'manager' AND EXISTS (
       SELECT 1 FROM public.user_divisions WHERE user_id = v_uid AND division_id = p_division_id) THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'この操作は当該事業部のマネージャーまたは super_admin のみ実行できます' USING ERRCODE = '42501';
END $$;
REVOKE EXECUTE ON FUNCTION public.tsr_assert_division_manager(UUID) FROM PUBLIC, anon, authenticated;

-- ─── 3. companies → 手動行の写像 ─────────────────────────────────
-- 住所から都道府県を取り出す（companies.prefecture が空のときの補完）
CREATE OR REPLACE FUNCTION public.tsr_prefecture_from_address(p_address TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT substring(normalize(COALESCE(p_address, ''), NFKC) from
    '^(北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)')
$$;

-- 手動行（と代表者行）を companies の内容で更新する。作成時と companies 更新トリガーの両方から使う。
-- 列の対応: name/name_kana/address/prefecture/phone/employee_count/capital(円→千円)/established_on(→年月)
--           industry1_name（業種マスタ名 or 自由入力）/business_description/listing_status(→code)/代表者
CREATE OR REPLACE FUNCTION public.tsr_apply_company_to_manual_row(p_tsr_code TEXT, c public.companies)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.tsr_prospects p SET
    name                 = c.name,
    name_kana            = c.name_kana,
    address              = c.address,
    prefecture           = COALESCE(NULLIF(c.prefecture, ''), public.tsr_prefecture_from_address(c.address)),
    phone                = c.phone,
    employee_count       = c.employee_count,
    capital_thousand_yen = CASE WHEN c.capital IS NOT NULL THEN c.capital / 1000 END,
    established_year     = CASE WHEN c.established_on IS NOT NULL THEN EXTRACT(YEAR  FROM c.established_on)::smallint END,
    established_month    = CASE WHEN c.established_on IS NOT NULL THEN EXTRACT(MONTH FROM c.established_on)::smallint END,
    industry1_name       = COALESCE((SELECT ic.name FROM public.industry_classes ic WHERE ic.code = c.industry_code), NULLIF(c.industry, '')),
    business_description = c.business_description,
    listing_code         = CASE c.listing_status
                             WHEN '東証プライム' THEN 'B' WHEN '東証スタンダード' THEN 'C' WHEN '東証グロース' THEN 'D'
                             WHEN '非上場' THEN '9' WHEN 'その他上場' THEN 'A' END,
    listing_name         = c.listing_status
  WHERE p.tsr_code = p_tsr_code AND p.source = 'manual';

  UPDATE public.tsr_prospect_personal pp SET
    rep_name      = c.representative,
    rep_name_kana = c.representative_kana,
    updated_at    = now()
  WHERE pp.tsr_code = p_tsr_code;
END $$;
REVOKE EXECUTE ON FUNCTION public.tsr_apply_company_to_manual_row(TEXT, public.companies) FROM PUBLIC, anon, authenticated;

-- 手動登録の会社行を作る（既存の companies 行から、または JSON から companies 行ごと新規作成）。
-- 事業部の所属者なら誰でも実行可（tsr_assert_member）。同じ会社の行が同事業部に既にあれば
-- そのコードを返す（冪等）。ビューが tsr_prospect_personal と INNER JOIN のため代表者行も必ず作る
CREATE OR REPLACE FUNCTION public.tsr_create_manual_prospect(
  p_division_id UUID,
  p_company_id  UUID  DEFAULT NULL,
  p_company     JSONB DEFAULT NULL,
  p_batch_id    UUID  DEFAULT NULL
)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company_id UUID := p_company_id;
  v_c          public.companies%ROWTYPE;
  v_code       TEXT;
BEGIN
  PERFORM public.tsr_assert_member(p_division_id);
  IF (v_company_id IS NULL) = (p_company IS NULL) THEN
    RAISE EXCEPTION 'company_id か company（JSON）のどちらか一方を指定してください' USING ERRCODE = '22023';
  END IF;

  IF p_company IS NOT NULL THEN
    IF NULLIF(btrim(COALESCE(p_company->>'name', '')), '') IS NULL THEN
      RAISE EXCEPTION '商号は必須です' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.companies (name, name_kana, address, phone, prefecture, representative, representative_kana, note)
    VALUES (
      btrim(p_company->>'name'),
      NULLIF(btrim(COALESCE(p_company->>'nameKana', '')), ''),
      NULLIF(btrim(COALESCE(p_company->>'address', '')), ''),
      NULLIF(btrim(COALESCE(p_company->>'phone', '')), ''),
      NULLIF(btrim(COALESCE(p_company->>'prefecture', '')), ''),
      NULLIF(btrim(COALESCE(p_company->>'representative', '')), ''),
      NULLIF(btrim(COALESCE(p_company->>'representativeKana', '')), ''),
      NULLIF(btrim(COALESCE(p_company->>'note', '')), '')
    ) RETURNING id INTO v_company_id;
  END IF;

  SELECT * INTO v_c FROM public.companies WHERE id = v_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '会社が見つかりません' USING ERRCODE = 'P0002';
  END IF;

  SELECT tsr_code INTO v_code FROM public.tsr_prospects
   WHERE division_id = p_division_id AND company_id = v_company_id LIMIT 1;
  IF FOUND THEN RETURN v_code; END IF;

  v_code := 'M' || lpad(nextval('public.tsr_manual_code_seq')::text, 8, '0');
  INSERT INTO public.tsr_prospects (tsr_code, division_id, source, name, company_id, company_linked_at,
                                    import_batch_id, status, priority_rank)
  VALUES (v_code, p_division_id, 'manual', v_c.name, v_company_id, now(), p_batch_id, 'リスト投入', 3);
  INSERT INTO public.tsr_prospect_personal (tsr_code, division_id) VALUES (v_code, p_division_id);
  PERFORM public.tsr_apply_company_to_manual_row(v_code, v_c);
  RETURN v_code;
END $$;
REVOKE EXECUTE ON FUNCTION public.tsr_create_manual_prospect(UUID, UUID, JSONB, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tsr_create_manual_prospect(UUID, UUID, JSONB, UUID) TO authenticated;

-- ─── 4. companies の更新・削除を手動行へ反映するトリガー ───────────────
-- SECURITY DEFINER: 更新する本人は tsr_prospects の多くの列に UPDATE 権限が無い（058）ため。
-- source='tsr' の行は触らない（TSR 値が勝つ）。通常の会社更新では該当行が無く no-op
CREATE OR REPLACE FUNCTION public.tsr_sync_manual_from_company()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code TEXT;
BEGIN
  FOR v_code IN SELECT tsr_code FROM public.tsr_prospects WHERE company_id = NEW.id AND source = 'manual' LOOP
    PERFORM public.tsr_apply_company_to_manual_row(v_code, NEW);
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS companies_sync_tsr_manual ON public.companies;
CREATE TRIGGER companies_sync_tsr_manual AFTER UPDATE ON public.companies
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.tsr_sync_manual_from_company();

-- 会社削除（043: manager/super_admin のみ）→ 手動行も消す。FK の ON DELETE SET NULL は AFTER トリガーとして
-- 先に走り company_id が NULL になってしまうため BEFORE で行う。契約（contacts）は SET NULL で残る
CREATE OR REPLACE FUNCTION public.tsr_delete_manual_on_company_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.tsr_prospects WHERE source = 'manual' AND company_id = OLD.id;  -- personal は CASCADE
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS companies_delete_tsr_manual ON public.companies;
CREATE TRIGGER companies_delete_tsr_manual BEFORE DELETE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.tsr_delete_manual_on_company_delete();

-- ─── 5. promote_tsr_prospect v2 ──────────────────────────────────
-- 053 からの変更点: 手動行は company_id をそのまま返す／電話＋商号で一致した会社が同事業部の別の行に
-- 既に紐づいている場合は再利用せず新しい会社を作る（065 の一意索引に先回り）／company_linked_at を記録
CREATE OR REPLACE FUNCTION public.promote_tsr_prospect(p_tsr_code TEXT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v_p   public.tsr_prospects%ROWTYPE;
  v_pp  public.tsr_prospect_personal%ROWTYPE;
  v_company_id UUID;
  v_listing    TEXT;
  v_established DATE;
  v_capital    BIGINT;
BEGIN
  SELECT * INTO v_p FROM public.tsr_prospects WHERE tsr_code = p_tsr_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象が見つからないか、操作する権限がありません' USING ERRCODE = 'P0002';
  END IF;
  IF v_p.company_id IS NOT NULL THEN
    RETURN v_p.company_id;
  END IF;
  IF v_p.source = 'manual' THEN
    RAISE EXCEPTION '手動登録の会社に会社行がありません（データ不整合）' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_pp FROM public.tsr_prospect_personal WHERE tsr_code = p_tsr_code;

  v_listing := CASE
    WHEN v_p.listing_code IS NULL THEN NULL
    WHEN v_p.listing_code = 'B' THEN '東証プライム'
    WHEN v_p.listing_code = 'C' THEN '東証スタンダード'
    WHEN v_p.listing_code = 'D' THEN '東証グロース'
    WHEN v_p.listing_code = '9' THEN '非上場'
    ELSE 'その他上場' END;
  v_established := CASE WHEN v_p.established_year IS NOT NULL
    THEN make_date(v_p.established_year, COALESCE(v_p.established_month, 1), 1) END;
  v_capital := CASE WHEN v_p.capital_thousand_yen IS NOT NULL THEN v_p.capital_thousand_yen * 1000 END;

  IF v_p.phone_digits IS NOT NULL THEN
    SELECT c.id INTO v_company_id
    FROM public.companies c
    WHERE c.phone_digits = v_p.phone_digits
      AND regexp_replace(c.name, '\s', '', 'g') = regexp_replace(v_p.name, '\s', '', 'g')
      AND NOT EXISTS (SELECT 1 FROM public.tsr_prospects q
                      WHERE q.division_id = v_p.division_id AND q.company_id = c.id)
    ORDER BY c.created_at
    LIMIT 1;
  END IF;

  IF v_company_id IS NOT NULL THEN
    UPDATE public.companies SET
      name_kana            = COALESCE(NULLIF(name_kana, ''),            v_p.name_kana),
      representative       = COALESCE(NULLIF(representative, ''),       v_pp.rep_name),
      representative_kana  = COALESCE(NULLIF(representative_kana, ''),  v_pp.rep_name_kana),
      address              = COALESCE(NULLIF(address, ''),              v_p.address),
      phone                = COALESCE(NULLIF(phone, ''),                v_p.phone),
      prefecture           = COALESCE(NULLIF(prefecture, ''),           v_p.prefecture),
      industry             = COALESCE(NULLIF(industry, ''),             v_p.industry1_name),
      business_description = COALESCE(NULLIF(business_description, ''), v_p.business_description),
      employee_count       = COALESCE(employee_count, v_p.employee_count),
      capital              = COALESCE(capital,        v_capital),
      established_on       = COALESCE(established_on, v_established),
      listing_status       = COALESCE(listing_status, v_listing)
    WHERE id = v_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '既存の会社情報を更新する権限がありません' USING ERRCODE = '42501';
    END IF;
  ELSE
    INSERT INTO public.companies (
      name, name_kana, representative, representative_kana, address, phone, prefecture, industry,
      business_description, employee_count, capital, established_on, listing_status
    ) VALUES (
      v_p.name, v_p.name_kana, v_pp.rep_name, v_pp.rep_name_kana, v_p.address, v_p.phone, v_p.prefecture, v_p.industry1_name,
      v_p.business_description, v_p.employee_count, v_capital, v_established, v_listing
    ) RETURNING id INTO v_company_id;
  END IF;

  UPDATE public.tsr_prospects SET company_id = v_company_id, company_linked_at = now() WHERE tsr_code = p_tsr_code;
  RETURN v_company_id;
END $$;

-- company_linked_at は authenticated の列単位 UPDATE 権限（058/059）に含まれていないが、
-- promote_tsr_prospect は SECURITY INVOKER なので本人権限で書く必要がある → 列を権限に追加
GRANT UPDATE (company_linked_at) ON public.tsr_prospects TO authenticated;

-- ─── 6. 検索条件に source、ビューと tsr_search の作り直し ─────────────
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
  IF f->>'promoted' = 'yes' THEN w := w || format('%I.company_id IS NOT NULL', a); END IF;
  IF f->>'promoted' = 'no'  THEN w := w || format('%I.company_id IS NULL', a); END IF;
  -- 064: 出所（TSR / 手動登録）
  IF f->>'source' IN ('tsr', 'manual') THEN w := w || format('%I.source = %L', a, f->>'source'); END IF;

  RETURN array_to_string(w, ' AND ');
END $$;

-- ビューは定義時に p.* を展開しているため、新列（source / company_linked_at）を出すには作り直す。
-- tsr_search が RETURNS SETOF tsr_prospects_view で依存しているので、先に関数を落とす
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
  pp.rep_birth_key + 0       AS rep_birth_key_s
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

-- ─── 7. 会社全体を対象にした活動（target_type='company'）の閲覧判定 ───────────
-- 034 では company は「事業部を持たない」として拒否していた。会社ページから記録する活動は
-- その会社に紐づく tsr_prospects / contacts の事業部の所属者が見られるようにする
CREATE OR REPLACE FUNCTION public.shares_division_with_activity_target(a_target_type VARCHAR, a_target_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  target_division UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  IF a_target_type = 'contact' THEN
    SELECT division_id INTO target_division FROM public.contacts WHERE id = a_target_id;
  ELSIF a_target_type = 'deal' THEN
    SELECT division_id INTO target_division FROM public.deals WHERE id = a_target_id;
  ELSIF a_target_type = 'company' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.user_divisions ud
      WHERE ud.user_id = auth.uid()
        AND ud.division_id IN (
          SELECT p.division_id FROM public.tsr_prospects p WHERE p.company_id = a_target_id
          UNION
          SELECT c.division_id FROM public.contacts c WHERE c.company_id = a_target_id
        )
    );
  ELSE
    RETURN FALSE;
  END IF;

  IF target_division IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.user_divisions
    WHERE user_id = auth.uid() AND division_id = target_division
  );
END;
$$;
