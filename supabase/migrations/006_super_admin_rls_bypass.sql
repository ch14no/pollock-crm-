-- ============================================================================
-- super_admin に対する事業部メンバーシップ要件の撤廃
-- ============================================================================
-- 背景:
-- 一部のRLSポリシー（contacts_insert/update, stages_manage, deals_insert/update,
-- tossups_insert）は、role=super_adminであっても対象事業部の user_divisions に
-- 登録されていないと書き込み操作ができない作りになっていた。
-- 新規事業部を作成した直後（まだ誰もuser_divisionsに登録されていない状態）に、
-- super_adminがパイプラインステージ等を設定しようとすると保存に失敗する不具合の
-- 原因となっていた。
--
-- 他の同種ポリシー（contacts_select, contacts_delete, deals_select,
-- divisions_manage, tossups_select/update 等）は既に
-- 「role = 'super_admin' なら事業部メンバーシップを問わず許可」という
-- OR条件になっており、今回の変更はそれらと一貫性を持たせる修正。
-- ============================================================================

DROP POLICY IF EXISTS "contacts_insert" ON public.contacts;
CREATE POLICY "contacts_insert" ON public.contacts FOR INSERT WITH CHECK (
  division_id IN (
    SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid()
  )
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);

DROP POLICY IF EXISTS "contacts_update" ON public.contacts;
CREATE POLICY "contacts_update" ON public.contacts FOR UPDATE USING (
  division_id IN (
    SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid()
  )
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);

DROP POLICY IF EXISTS "stages_manage" ON public.pipeline_stages;
CREATE POLICY "stages_manage" ON public.pipeline_stages FOR ALL USING (
  (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  OR (
    division_id IN (
      SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid()
    )
    AND (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
  )
);

DROP POLICY IF EXISTS "deals_insert" ON public.deals;
CREATE POLICY "deals_insert" ON public.deals FOR INSERT WITH CHECK (
  division_id IN (
    SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid()
  )
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);

DROP POLICY IF EXISTS "deals_update" ON public.deals;
CREATE POLICY "deals_update" ON public.deals FOR UPDATE USING (
  division_id IN (
    SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid()
  )
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);

DROP POLICY IF EXISTS "tossups_insert" ON public.tossups;
CREATE POLICY "tossups_insert" ON public.tossups FOR INSERT WITH CHECK (
  from_division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);
