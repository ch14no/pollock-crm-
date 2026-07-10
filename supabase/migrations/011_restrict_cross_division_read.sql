-- ============================================================
-- 011: 事業部横断閲覧の撤回（所属事業部のみ閲覧可能に戻す）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- 背景:
--   002_cross_division_read.sql で contacts / deals / activities のSELECTを
--   全認証ユーザーに開放していたが、運用方針の変更により
--   「ユーザーは自分の所属事業部のデータのみ閲覧できる」に戻す。
--
-- 設計上の例外（トスアップ運用を壊さないため）:
--   - 顧客(contacts)は、自分の事業部宛て/発のトスアップで参照されている場合に限り
--     他事業部のものでも閲覧できる（受信側がトスアップから顧客詳細を開くために必要）
--   - 会社(companies)・事業部(divisions)は全社共有マスタのまま変更しない
--     （トスアップの宛先選択・会社の名寄せに必要）
--
-- 適用によって意図的に変わる挙動（適用前に業務側と認識合わせすること）:
--   1. トスアップ経由で他事業部の顧客詳細を開いても、その顧客の商談・活動履歴は
--      表示されない（deals/activitiesには例外を設けず、露出を最小限にする方針）
--   2. 会社詳細ページ（/contacts/company/[id]）の担当者一覧は、自分の所属事業部の
--      担当者のみ表示される（従来は全事業部横断で表示）
--   3. managerは従来「全社の活動」を閲覧できたが、適用後は自分と同じ事業部に
--      所属するメンバーの活動のみになる（super_adminは引き続き全件閲覧可）
--
-- ロールバック:
--   002_cross_division_read.sql を再実行すれば全社閲覧に戻ります。
-- ============================================================

-- contacts: 所属事業部 + super_admin + トスアップ参照分
DROP POLICY IF EXISTS "contacts_select" ON public.contacts;
CREATE POLICY "contacts_select" ON public.contacts
  FOR SELECT USING (
    division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM public.tossups t
      WHERE t.contact_id = contacts.id
        AND (
          t.to_division_id   IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
          OR t.from_division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
        )
    )
  );

-- deals: 所属事業部 + super_admin
DROP POLICY IF EXISTS "deals_select" ON public.deals;
CREATE POLICY "deals_select" ON public.deals
  FOR SELECT USING (
    division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );

-- activities: 自分の活動 + 同じ事業部に所属するメンバーの活動 + super_admin
-- （activitiesテーブルにはdivision_idカラムが無いため、作成者の所属事業部で判定する）
DROP POLICY IF EXISTS "activities_select" ON public.activities;
CREATE POLICY "activities_select" ON public.activities
  FOR SELECT USING (
    user_id = auth.uid()
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR EXISTS (
      SELECT 1
      FROM public.user_divisions mine
      JOIN public.user_divisions theirs ON mine.division_id = theirs.division_id
      WHERE mine.user_id = auth.uid()
        AND theirs.user_id = activities.user_id
    )
  );
