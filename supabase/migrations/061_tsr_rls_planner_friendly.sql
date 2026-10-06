-- ============================================================
-- 061: TSRソーシングリスト RLS ポリシーを planner に優しい形に書き換える（性能対策）
--
-- 本番（2026-10-06）で、ログインユーザー（authenticated）として実行すると商号の前方一致が
-- 15.6 秒（直接接続では 0.05 秒）かかり、statement_timeout 8 秒で「読み込みに失敗」になった。
-- 原因は 053 の RLS 条件 `division_id IN (SELECT division_id FROM user_divisions WHERE user_id = auth.uid())`。
-- この形は planner が「user_divisions との結合」として扱い、tsr_prospects 側を全件走査する計画を
-- 選びやすい（RLS の典型的な性能問題）。
--
-- 対策: 副問い合わせを `= ANY (ARRAY(SELECT ...))` と `(SELECT auth.uid())` で包み、クエリの最初に
-- 1 回だけ評価される定数（InitPlan）にする。意味は同じで、索引が使えるようになる。
-- 対象: tsr_prospects（select/update）、tsr_prospect_personal、tsr_priority_settings、tsr_import_logs。
-- ============================================================

DROP POLICY IF EXISTS "tsr_prospects_select" ON public.tsr_prospects;
CREATE POLICY "tsr_prospects_select" ON public.tsr_prospects FOR SELECT USING (
  division_id = ANY (ARRAY(SELECT ud.division_id FROM public.user_divisions ud WHERE ud.user_id = (SELECT auth.uid())))
  OR (SELECT u.role FROM public.users u WHERE u.id = (SELECT auth.uid())) = 'super_admin'
);

DROP POLICY IF EXISTS "tsr_prospects_update" ON public.tsr_prospects;
CREATE POLICY "tsr_prospects_update" ON public.tsr_prospects FOR UPDATE USING (
  division_id = ANY (ARRAY(SELECT ud.division_id FROM public.user_divisions ud WHERE ud.user_id = (SELECT auth.uid())))
  OR (SELECT u.role FROM public.users u WHERE u.id = (SELECT auth.uid())) = 'super_admin'
);

DROP POLICY IF EXISTS "tsr_personal_select" ON public.tsr_prospect_personal;
CREATE POLICY "tsr_personal_select" ON public.tsr_prospect_personal FOR SELECT USING (
  division_id = ANY (ARRAY(SELECT ud.division_id FROM public.user_divisions ud WHERE ud.user_id = (SELECT auth.uid())))
  OR (SELECT u.role FROM public.users u WHERE u.id = (SELECT auth.uid())) = 'super_admin'
);

DROP POLICY IF EXISTS "tsr_priority_settings_select" ON public.tsr_priority_settings;
CREATE POLICY "tsr_priority_settings_select" ON public.tsr_priority_settings FOR SELECT USING (
  division_id = ANY (ARRAY(SELECT ud.division_id FROM public.user_divisions ud WHERE ud.user_id = (SELECT auth.uid())))
  OR (SELECT u.role FROM public.users u WHERE u.id = (SELECT auth.uid())) = 'super_admin'
);

DROP POLICY IF EXISTS "tsr_priority_settings_manage" ON public.tsr_priority_settings;
CREATE POLICY "tsr_priority_settings_manage" ON public.tsr_priority_settings FOR ALL USING (
  (division_id = ANY (ARRAY(SELECT ud.division_id FROM public.user_divisions ud WHERE ud.user_id = (SELECT auth.uid())))
   AND (SELECT u.role FROM public.users u WHERE u.id = (SELECT auth.uid())) = 'manager')
  OR (SELECT u.role FROM public.users u WHERE u.id = (SELECT auth.uid())) = 'super_admin'
);

DROP POLICY IF EXISTS "tsr_import_logs_select" ON public.tsr_import_logs;
CREATE POLICY "tsr_import_logs_select" ON public.tsr_import_logs FOR SELECT USING (
  division_id = ANY (ARRAY(SELECT ud.division_id FROM public.user_divisions ud WHERE ud.user_id = (SELECT auth.uid())))
  OR (SELECT u.role FROM public.users u WHERE u.id = (SELECT auth.uid())) = 'super_admin'
);
