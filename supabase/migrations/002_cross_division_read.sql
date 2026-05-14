-- ============================================================
-- 事業部横断閲覧ポリシー更新
-- 全社員が全事業部のデータを閲覧可能、編集は自分の事業部のみ
-- ============================================================

-- contacts: 全認証ユーザーが閲覧可能に変更
DROP POLICY IF EXISTS "contacts_select" ON public.contacts;
CREATE POLICY "contacts_select" ON public.contacts
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- deals: 全認証ユーザーが閲覧可能に変更
DROP POLICY IF EXISTS "deals_select" ON public.deals;
CREATE POLICY "deals_select" ON public.deals
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- activities: 全認証ユーザーが閲覧可能に変更
DROP POLICY IF EXISTS "activities_select" ON public.activities;
CREATE POLICY "activities_select" ON public.activities
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- tossups: 変更なし（送受信事業部に関係するもののみ）

-- INSERT/UPDATE/DELETE は既存ポリシー（自分の事業部のみ）を維持
