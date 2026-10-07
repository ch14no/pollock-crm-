-- ============================================================
-- 066: 顧客（人）→ソーシング（会社）統合 その2 — 突合候補と統合操作、担当者追加
--
-- 064 の基盤の上に、「顧客（contacts）が紐づく会社」と「TSR の会社行」を突き合わせて
-- 紐づける仕組みを置く。候補は tsr_merge_candidates に保存し、画面（/sourcing/merge）で
-- マネージャーが確認・決定する。自動で紐づけるのは安全な一致（電話一致、または商号が
-- 1社だけ一致し住所/都道府県も一致）だけ。
--
-- 不変条件: このファイルの関数は contacts / activities / deals / companies の列を
-- 書き換えない（唯一の例外: tsr_merge_manual_into_tsr と tsr_merge_rollback が、自分で
-- 作った手動行を削除する）。TSR 由来の列も書き換えない。
--
-- ※ 064・065 適用済みが前提。直接接続で 1 トランザクションとして適用。
-- ============================================================

-- ─── 候補テーブル ─────────────────────────────────────────
CREATE TABLE public.tsr_merge_candidates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id      UUID NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  company_id       UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tsr_code         VARCHAR(9) REFERENCES public.tsr_prospects(tsr_code) ON DELETE CASCADE,  -- NULL = TSR に一致なし
  match_reason     VARCHAR(20) NOT NULL CHECK (match_reason IN
                     ('phone', 'phone_multi', 'name_unique_addr', 'name_unique_pref', 'name_only', 'name_multi',
                      'manual_dup', 'manual_pick', 'none')),
  score            SMALLINT NOT NULL,
  status           VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'linked', 'rejected', 'manual')),
  contact_count    INTEGER NOT NULL DEFAULT 0,
  scan_batch_id    UUID NOT NULL,
  applied_batch_id UUID,
  decided_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_tsr_merge_cand_key ON public.tsr_merge_candidates (division_id, company_id, (COALESCE(tsr_code, '')));
CREATE INDEX idx_tsr_merge_cand_status ON public.tsr_merge_candidates (division_id, status);
CREATE INDEX idx_tsr_merge_cand_tsr ON public.tsr_merge_candidates (tsr_code);

ALTER TABLE public.tsr_merge_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tsr_merge_cand_select" ON public.tsr_merge_candidates FOR SELECT USING (
  division_id = ANY (ARRAY(SELECT ud.division_id FROM public.user_divisions ud WHERE ud.user_id = (SELECT auth.uid())))
  OR (SELECT u.role FROM public.users u WHERE u.id = (SELECT auth.uid())) = 'super_admin'
);
REVOKE ALL ON public.tsr_merge_candidates FROM anon, authenticated, service_role;
GRANT SELECT ON public.tsr_merge_candidates TO authenticated, service_role;

-- 候補を1件登録（同じ組は登録しない。却下済みの組も再提案しない）
CREATE OR REPLACE FUNCTION public.tsr_merge_add_candidate(
  p_division_id UUID, p_company_id UUID, p_tsr_code TEXT, p_reason TEXT, p_score INT, p_contacts INT, p_batch UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.tsr_merge_candidates (division_id, company_id, tsr_code, match_reason, score, contact_count, scan_batch_id)
  VALUES (p_division_id, p_company_id, p_tsr_code, p_reason, p_score, p_contacts, p_batch)
  ON CONFLICT (division_id, company_id, (COALESCE(tsr_code, ''))) DO NOTHING;
END $$;
REVOKE EXECUTE ON FUNCTION public.tsr_merge_add_candidate(UUID, UUID, TEXT, TEXT, INT, INT, UUID) FROM PUBLIC, anon, authenticated;

-- ─── スキャン（再実行可。pending を作り直し、決定済みは保持） ───────────
CREATE OR REPLACE FUNCTION public.tsr_merge_scan(p_division_id UUID)
RETURNS TABLE (batch_id UUID, companies_scanned INTEGER, auto_linkable INTEGER, needs_review INTEGER, unmatched INTEGER, manual_dups INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch   UUID := gen_random_uuid();
  v_c       RECORD;
  v_m       RECORD;
  v_core    TEXT;
  v_addr    TEXT;
  v_pref    TEXT;
  v_codes   TEXT[];
  v_code    TEXT;
  v_t       RECORD;
  v_hit     BOOLEAN;
  v_scanned INTEGER := 0;
BEGIN
  PERFORM public.tsr_assert_division_manager(p_division_id);

  DELETE FROM public.tsr_merge_candidates WHERE division_id = p_division_id AND status = 'pending';

  -- 対象: 当該事業部に担当者がいて、まだこの事業部の行に紐づいていない会社
  FOR v_c IN
    SELECT c.*, x.cnt
    FROM public.companies c
    JOIN (SELECT company_id, count(*)::int AS cnt FROM public.contacts
          WHERE division_id = p_division_id AND company_id IS NOT NULL GROUP BY company_id) x ON x.company_id = c.id
    WHERE NOT EXISTS (SELECT 1 FROM public.tsr_prospects p WHERE p.division_id = p_division_id AND p.company_id = c.id)
  LOOP
    v_scanned := v_scanned + 1;
    v_hit := FALSE;
    v_core := public.tsr_name_core(v_c.name);
    v_addr := NULLIF(left(regexp_replace(normalize(COALESCE(v_c.address, ''), NFKC), '\s', '', 'g'), 8), '');
    v_pref := COALESCE(NULLIF(v_c.prefecture, ''), public.tsr_prefecture_from_address(v_c.address));

    -- 1) 電話番号（正規化）一致。LIKE（ワイルドカードなし＝完全一致）にして trgm 索引を使う
    v_codes := NULL;
    IF v_c.phone_digits IS NOT NULL THEN
      SELECT array_agg(p.tsr_code ORDER BY p.priority_rank, p.fy1_sales DESC NULLS LAST) INTO v_codes
      FROM public.tsr_prospects p
      WHERE p.division_id = p_division_id AND p.source = 'tsr' AND p.phone_digits LIKE v_c.phone_digits
        AND p.company_id IS NULL;
    END IF;
    IF v_codes IS NOT NULL THEN
      IF array_length(v_codes, 1) = 1 THEN
        PERFORM public.tsr_merge_add_candidate(p_division_id, v_c.id, v_codes[1], 'phone', 100, v_c.cnt, v_batch);
      ELSE
        FOREACH v_code IN ARRAY v_codes[1:20] LOOP
          PERFORM public.tsr_merge_add_candidate(p_division_id, v_c.id, v_code, 'phone_multi', 60, v_c.cnt, v_batch);
        END LOOP;
      END IF;
      v_hit := TRUE;
    END IF;

    -- 2) 商号（法人格除去・正規化）一致
    v_codes := NULL;
    IF v_core IS NOT NULL THEN
      SELECT array_agg(p.tsr_code ORDER BY p.priority_rank, p.fy1_sales DESC NULLS LAST) INTO v_codes
      FROM public.tsr_prospects p
      WHERE p.division_id = p_division_id AND p.source = 'tsr' AND p.name_core = v_core
        AND p.company_id IS NULL
        AND NOT (v_hit AND p.tsr_code = ANY (COALESCE(v_codes, ARRAY[]::text[])));
    END IF;
    IF v_codes IS NOT NULL THEN
      IF array_length(v_codes, 1) = 1 THEN
        SELECT p.address, p.prefecture INTO v_t FROM public.tsr_prospects p WHERE p.tsr_code = v_codes[1];
        IF v_addr IS NOT NULL AND length(v_addr) >= 6
           AND left(regexp_replace(normalize(COALESCE(v_t.address, ''), NFKC), '\s', '', 'g'), 8) = v_addr THEN
          PERFORM public.tsr_merge_add_candidate(p_division_id, v_c.id, v_codes[1], 'name_unique_addr', 80, v_c.cnt, v_batch);
        ELSIF v_pref IS NOT NULL AND v_t.prefecture = v_pref THEN
          PERFORM public.tsr_merge_add_candidate(p_division_id, v_c.id, v_codes[1], 'name_unique_pref', 70, v_c.cnt, v_batch);
        ELSE
          PERFORM public.tsr_merge_add_candidate(p_division_id, v_c.id, v_codes[1], 'name_only', 40, v_c.cnt, v_batch);
        END IF;
      ELSE
        FOREACH v_code IN ARRAY v_codes[1:20] LOOP
          PERFORM public.tsr_merge_add_candidate(p_division_id, v_c.id, v_code, 'name_multi', 30, v_c.cnt, v_batch);
        END LOOP;
      END IF;
      v_hit := TRUE;
    END IF;

    -- 3) 一致なし
    IF NOT v_hit THEN
      PERFORM public.tsr_merge_add_candidate(p_division_id, v_c.id, NULL, 'none', 0, v_c.cnt, v_batch);
    END IF;
  END LOOP;

  -- 4) 手動登録行が TSR 行と重複していないか（TSR 更新で後から載った会社の検出）
  FOR v_m IN
    SELECT m.tsr_code AS manual_code, m.company_id, m.phone_digits, m.name_core,
           (SELECT count(*)::int FROM public.contacts ct WHERE ct.company_id = m.company_id AND ct.division_id = p_division_id) AS cnt
    FROM public.tsr_prospects m WHERE m.division_id = p_division_id AND m.source = 'manual' AND m.company_id IS NOT NULL
  LOOP
    FOR v_code IN
      SELECT p.tsr_code FROM public.tsr_prospects p
      WHERE p.division_id = p_division_id AND p.source = 'tsr' AND p.company_id IS NULL
        AND ((v_m.phone_digits IS NOT NULL AND p.phone_digits LIKE v_m.phone_digits)
             OR (v_m.name_core IS NOT NULL AND p.name_core = v_m.name_core))
      ORDER BY p.priority_rank, p.fy1_sales DESC NULLS LAST LIMIT 20
    LOOP
      PERFORM public.tsr_merge_add_candidate(p_division_id, v_m.company_id, v_code, 'manual_dup', 90, v_m.cnt, v_batch);
    END LOOP;
  END LOOP;

  RETURN QUERY
  WITH pend AS (
    SELECT c.company_id, c.match_reason, c.score, c.tsr_code
    FROM public.tsr_merge_candidates c WHERE c.division_id = p_division_id AND c.status = 'pending'
  ), per_company AS (
    SELECT company_id,
           count(*) FILTER (WHERE score >= 70 AND match_reason <> 'manual_dup') AS safe_cnt,
           count(*) FILTER (WHERE tsr_code IS NOT NULL AND match_reason <> 'manual_dup') AS with_code,
           count(*) FILTER (WHERE match_reason = 'manual_dup') AS dup_cnt
    FROM pend GROUP BY company_id
  )
  SELECT v_batch, v_scanned,
         (SELECT count(*)::int FROM per_company WHERE safe_cnt = 1),
         (SELECT count(*)::int FROM per_company WHERE with_code > 0 AND safe_cnt <> 1),
         (SELECT count(*)::int FROM per_company WHERE with_code = 0 AND dup_cnt = 0),
         (SELECT count(*)::int FROM per_company WHERE dup_cnt > 0);
END $$;

-- ─── 紐づけ／解除／却下／手動化 ──────────────────────────────
CREATE OR REPLACE FUNCTION public.tsr_merge_link(p_division_id UUID, p_company_id UUID, p_tsr_code TEXT, p_batch_id UUID DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p     public.tsr_prospects%ROWTYPE;
  v_batch UUID := COALESCE(p_batch_id, gen_random_uuid());
  v_other TEXT;
BEGIN
  PERFORM public.tsr_assert_division_manager(p_division_id);
  SELECT * INTO v_p FROM public.tsr_prospects WHERE tsr_code = p_tsr_code AND division_id = p_division_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '対象の会社行が見つかりません' USING ERRCODE = 'P0002'; END IF;
  IF v_p.source <> 'tsr' THEN
    RAISE EXCEPTION '手動登録の行には紐づけできません（tsr_merge_manual_into_tsr を使ってください）' USING ERRCODE = '22023';
  END IF;
  IF v_p.company_id = p_company_id THEN
    UPDATE public.tsr_merge_candidates SET status = 'linked', updated_at = now()
     WHERE division_id = p_division_id AND company_id = p_company_id AND tsr_code = p_tsr_code AND status <> 'linked';
    RETURN;
  END IF;
  IF v_p.company_id IS NOT NULL THEN
    RAISE EXCEPTION 'この会社行は既に別の会社に紐づいています' USING ERRCODE = 'P0003';
  END IF;
  SELECT tsr_code INTO v_other FROM public.tsr_prospects WHERE division_id = p_division_id AND company_id = p_company_id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'この会社は既に別の行（%）に紐づいています', v_other USING ERRCODE = 'P0003';
  END IF;

  UPDATE public.tsr_prospects SET company_id = p_company_id, company_linked_at = now() WHERE tsr_code = p_tsr_code;

  INSERT INTO public.tsr_merge_candidates (division_id, company_id, tsr_code, match_reason, score, status, scan_batch_id, applied_batch_id, decided_by, decided_at)
  VALUES (p_division_id, p_company_id, p_tsr_code, 'manual_pick', 100, 'linked', v_batch, v_batch, auth.uid(), now())
  ON CONFLICT (division_id, company_id, (COALESCE(tsr_code, ''))) DO UPDATE
    SET status = 'linked', applied_batch_id = v_batch, decided_by = auth.uid(), decided_at = now(), updated_at = now();
  UPDATE public.tsr_merge_candidates SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), updated_at = now()
   WHERE division_id = p_division_id AND company_id = p_company_id AND status = 'pending'
     AND COALESCE(tsr_code, '') <> p_tsr_code;
END $$;

CREATE OR REPLACE FUNCTION public.tsr_merge_unlink(p_division_id UUID, p_tsr_code TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p public.tsr_prospects%ROWTYPE;
BEGIN
  PERFORM public.tsr_assert_division_manager(p_division_id);
  SELECT * INTO v_p FROM public.tsr_prospects WHERE tsr_code = p_tsr_code AND division_id = p_division_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '対象の会社行が見つかりません' USING ERRCODE = 'P0002'; END IF;
  IF v_p.source <> 'tsr' THEN RAISE EXCEPTION '手動登録の行は解除できません' USING ERRCODE = '22023'; END IF;
  IF v_p.company_id IS NULL THEN RETURN; END IF;
  UPDATE public.tsr_merge_candidates SET status = 'pending', applied_batch_id = NULL, decided_by = NULL, decided_at = NULL, updated_at = now()
   WHERE division_id = p_division_id AND company_id = v_p.company_id AND tsr_code = p_tsr_code AND status = 'linked';
  UPDATE public.tsr_prospects SET company_id = NULL, company_linked_at = NULL WHERE tsr_code = p_tsr_code;
END $$;

CREATE OR REPLACE FUNCTION public.tsr_merge_reject(p_candidate_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_div UUID;
BEGIN
  SELECT division_id INTO v_div FROM public.tsr_merge_candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN RAISE EXCEPTION '候補が見つかりません' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.tsr_assert_division_manager(v_div);
  UPDATE public.tsr_merge_candidates SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), updated_at = now()
   WHERE id = p_candidate_id AND status = 'pending';
END $$;

-- 「別会社として残す」: 手動登録の行を作り、候補を manual（他は却下）に
CREATE OR REPLACE FUNCTION public.tsr_merge_mark_manual(p_division_id UUID, p_company_id UUID, p_batch_id UUID DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch UUID := COALESCE(p_batch_id, gen_random_uuid());
  v_code  TEXT;
BEGIN
  PERFORM public.tsr_assert_division_manager(p_division_id);
  v_code := public.tsr_create_manual_prospect(p_division_id, p_company_id, NULL, v_batch);
  INSERT INTO public.tsr_merge_candidates (division_id, company_id, tsr_code, match_reason, score, status, scan_batch_id, applied_batch_id, decided_by, decided_at)
  VALUES (p_division_id, p_company_id, NULL, 'none', 0, 'manual', v_batch, v_batch, auth.uid(), now())
  ON CONFLICT (division_id, company_id, (COALESCE(tsr_code, ''))) DO UPDATE
    SET status = 'manual', applied_batch_id = v_batch, decided_by = auth.uid(), decided_at = now(), updated_at = now();
  UPDATE public.tsr_merge_candidates SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), updated_at = now()
   WHERE division_id = p_division_id AND company_id = p_company_id AND status = 'pending' AND tsr_code IS NOT NULL;
  RETURN v_code;
END $$;

-- 手動行が TSR 行と同じ会社だった: 運用列を空欄のみ TSR 行へ写し、TSR 行に会社を紐づけ、手動行を消す
CREATE OR REPLACE FUNCTION public.tsr_merge_manual_into_tsr(p_division_id UUID, p_manual_code TEXT, p_tsr_code TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_m public.tsr_prospects%ROWTYPE;
  v_t public.tsr_prospects%ROWTYPE;
BEGIN
  PERFORM public.tsr_assert_division_manager(p_division_id);
  SELECT * INTO v_m FROM public.tsr_prospects WHERE tsr_code = p_manual_code AND division_id = p_division_id AND source = 'manual' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '手動登録の行が見つかりません' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_t FROM public.tsr_prospects WHERE tsr_code = p_tsr_code AND division_id = p_division_id AND source = 'tsr' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TSR の行が見つかりません' USING ERRCODE = 'P0002'; END IF;
  IF v_t.company_id IS NOT NULL AND v_t.company_id <> v_m.company_id THEN
    RAISE EXCEPTION 'TSR の行は既に別の会社に紐づいています' USING ERRCODE = 'P0003';
  END IF;

  DELETE FROM public.tsr_prospects WHERE tsr_code = p_manual_code;   -- 一意索引のため先に消す
  UPDATE public.tsr_prospects SET
    company_id        = v_m.company_id,
    company_linked_at = now(),
    approach_type     = COALESCE(approach_type, v_m.approach_type),
    owner_user_id     = COALESCE(owner_user_id, v_m.owner_user_id),
    last_contact_on   = COALESCE(last_contact_on, v_m.last_contact_on),
    status            = CASE WHEN status = 'リスト投入' THEN v_m.status ELSE status END,
    memo              = COALESCE(memo, v_m.memo)
  WHERE tsr_code = p_tsr_code;

  UPDATE public.tsr_merge_candidates SET status = 'linked', decided_by = auth.uid(), decided_at = now(), updated_at = now()
   WHERE division_id = p_division_id AND company_id = v_m.company_id AND tsr_code = p_tsr_code;
  UPDATE public.tsr_merge_candidates SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), updated_at = now()
   WHERE division_id = p_division_id AND company_id = v_m.company_id AND status = 'pending';
END $$;

-- 安全な一致だけを自動で適用（dry_run=true は件数のみ）
CREATE OR REPLACE FUNCTION public.tsr_merge_apply_auto(p_division_id UUID, p_dry_run BOOLEAN DEFAULT TRUE)
RETURNS TABLE (batch_id UUID, linked INTEGER, manualized INTEGER, skipped INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch UUID := gen_random_uuid();
  v_r     RECORD;
  v_link  INTEGER := 0;
  v_man   INTEGER := 0;
  v_skip  INTEGER := 0;
BEGIN
  PERFORM public.tsr_assert_division_manager(p_division_id);
  FOR v_r IN
    WITH pend AS (
      SELECT c.company_id, c.tsr_code, c.score, c.match_reason
      FROM public.tsr_merge_candidates c WHERE c.division_id = p_division_id AND c.status = 'pending'
    )
    SELECT company_id,
           (array_agg(tsr_code) FILTER (WHERE score >= 70 AND match_reason <> 'manual_dup'))[1] AS safe_code,
           count(*) FILTER (WHERE score >= 70 AND match_reason <> 'manual_dup') AS safe_cnt,
           count(*) FILTER (WHERE tsr_code IS NOT NULL) AS with_code,
           count(*) FILTER (WHERE match_reason = 'manual_dup') AS dup_cnt
    FROM pend GROUP BY company_id
  LOOP
    IF v_r.safe_cnt = 1 THEN
      IF NOT p_dry_run THEN PERFORM public.tsr_merge_link(p_division_id, v_r.company_id, v_r.safe_code, v_batch); END IF;
      v_link := v_link + 1;
    ELSIF v_r.with_code = 0 AND v_r.dup_cnt = 0 THEN
      IF NOT p_dry_run THEN PERFORM public.tsr_merge_mark_manual(p_division_id, v_r.company_id, v_batch); END IF;
      v_man := v_man + 1;
    ELSE
      v_skip := v_skip + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_batch, v_link, v_man, v_skip;
END $$;

-- 一括適用の取り消し（紐づけ解除・作った手動行の削除。契約・活動・案件・会社には触れない）
CREATE OR REPLACE FUNCTION public.tsr_merge_rollback(p_division_id UUID, p_batch_id UUID)
RETURNS TABLE (unlinked INTEGER, manual_deleted INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_r INTEGER := 0;
  v_m INTEGER := 0;
  v_c RECORD;
BEGIN
  PERFORM public.tsr_assert_division_manager(p_division_id);
  FOR v_c IN SELECT * FROM public.tsr_merge_candidates WHERE division_id = p_division_id AND applied_batch_id = p_batch_id LOOP
    IF v_c.status = 'linked' AND v_c.tsr_code IS NOT NULL THEN
      PERFORM public.tsr_merge_unlink(p_division_id, v_c.tsr_code);
      v_r := v_r + 1;
    ELSIF v_c.status = 'manual' THEN
      DELETE FROM public.tsr_prospects WHERE source = 'manual' AND company_id = v_c.company_id AND import_batch_id = p_batch_id;
      IF FOUND THEN v_m := v_m + 1; END IF;
      UPDATE public.tsr_merge_candidates SET status = 'pending', applied_batch_id = NULL, decided_by = NULL, decided_at = NULL, updated_at = now()
       WHERE id = v_c.id;
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_r, v_m;
END $$;

REVOKE EXECUTE ON FUNCTION public.tsr_merge_scan(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tsr_merge_link(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tsr_merge_unlink(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tsr_merge_reject(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tsr_merge_mark_manual(UUID, UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tsr_merge_manual_into_tsr(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tsr_merge_apply_auto(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tsr_merge_rollback(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tsr_merge_scan(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tsr_merge_link(UUID, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tsr_merge_unlink(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tsr_merge_reject(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tsr_merge_mark_manual(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tsr_merge_manual_into_tsr(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tsr_merge_apply_auto(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tsr_merge_rollback(UUID, UUID) TO authenticated;

-- ─── 担当者の追加（会社ページの名刺管理から） ───────────────────────
-- SECURITY INVOKER: contacts_insert / ccv_upsert / tsr_prospects_update の RLS がそのまま効く。
-- 会社行がまだ companies に無ければ promote_tsr_prospect で作ってから、担当者と M&A 項目を 1 トランザクションで登録
CREATE OR REPLACE FUNCTION public.tsr_add_contact(p_tsr_code TEXT, p_contact JSONB, p_custom_values JSONB DEFAULT '{}'::jsonb)
RETURNS UUID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_p       public.tsr_prospects%ROWTYPE;
  v_company UUID;
  v_id      UUID;
  v_name    TEXT := NULLIF(btrim(COALESCE(p_contact->>'name', '')), '');
BEGIN
  SELECT * INTO v_p FROM public.tsr_prospects WHERE tsr_code = p_tsr_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '対象の会社が見つからないか、操作する権限がありません' USING ERRCODE = 'P0002'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION '氏名は必須です' USING ERRCODE = '22023'; END IF;

  v_company := v_p.company_id;
  IF v_company IS NULL THEN
    v_company := public.promote_tsr_prospect(p_tsr_code);
  END IF;

  INSERT INTO public.contacts (division_id, company_id, assigned_user_id, name, email, phone, position, department, address, notes, tags, custom_attributes)
  VALUES (
    v_p.division_id, v_company,
    NULLIF(p_contact->>'assignedUserId', '')::uuid,
    v_name,
    NULLIF(btrim(COALESCE(p_contact->>'email', '')), ''),
    NULLIF(btrim(COALESCE(p_contact->>'phone', '')), ''),
    NULLIF(btrim(COALESCE(p_contact->>'position', '')), ''),
    NULLIF(btrim(COALESCE(p_contact->>'department', '')), ''),
    NULLIF(btrim(COALESCE(p_contact->>'address', '')), ''),
    NULLIF(btrim(COALESCE(p_contact->>'notes', '')), ''),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_contact->'tags') = 'array' THEN p_contact->'tags' ELSE '[]'::jsonb END)), ARRAY[]::text[]),
    COALESCE(CASE WHEN jsonb_typeof(p_contact->'customAttributes') = 'object' THEN p_contact->'customAttributes' END, '{}'::jsonb)
  ) RETURNING id INTO v_id;

  INSERT INTO public.contact_custom_values (contact_id, field_id, value)
  SELECT v_id, kv.key::uuid, kv.value
  FROM jsonb_each_text(COALESCE(p_custom_values, '{}'::jsonb)) kv
  WHERE kv.value IS NOT NULL AND btrim(kv.value) <> ''
    AND kv.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND EXISTS (SELECT 1 FROM public.division_custom_fields f WHERE f.id = kv.key::uuid AND f.division_id = v_p.division_id)
  ON CONFLICT (contact_id, field_id) DO UPDATE SET value = EXCLUDED.value;

  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.tsr_add_contact(TEXT, JSONB, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tsr_add_contact(TEXT, JSONB, JSONB) TO authenticated;

-- 他事業部の担当者「件数」（contacts の RLS は他事業部を隠すため、件数だけ定義者権限で返す）
CREATE OR REPLACE FUNCTION public.company_contact_counts_by_division(p_company_id UUID)
RETURNS TABLE (division_id UUID, division_name TEXT, n INTEGER)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT c.division_id, d.name::text, count(*)::int
  FROM public.contacts c JOIN public.divisions d ON d.id = c.division_id
  WHERE c.company_id = p_company_id AND auth.uid() IS NOT NULL
  GROUP BY c.division_id, d.name
$$;
REVOKE EXECUTE ON FUNCTION public.company_contact_counts_by_division(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.company_contact_counts_by_division(UUID) TO authenticated;
