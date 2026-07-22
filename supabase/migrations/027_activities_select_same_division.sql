-- ============================================================
-- 027: activities の SELECT を「同一事業部メンバー間で閲覧可」に修正（不具合修正）
-- ============================================================
-- 本番の activities_select ポリシーが 001 の初期版（本人 + super_admin/manager のみ）
-- のままで、011 に含まれる「同じ事業部に所属するメンバーの活動も閲覧可」への
-- 更新が適用されていなかった。このため user ロール同士は同じ事業部でも
-- お互いのタスク・活動記録が一切見えず、タスク管理カンバンの「チーム」表示でも
-- 自分の分しか出なかった（2026-07 財務支援事業部からの報告。財務所属の user ロールの
-- 検証アカウントで、同僚の activities が 0 件・自分の行も user_id 明示時のみ取得できる
-- ことを本番で実測して確定）。
--
-- 026（DELETE ポリシー）のコメントは 011 適用済みを前提に「activities_select（011）と
-- 同じ結合」と記載しているが、実際には SELECT だけ 001 のまま取り残されていた。
-- 本マイグレーションは 011 の activities_select 定義のみを冪等に再適用する
-- （contacts / deals / companies の閲覧範囲には触れない。それらは 011 全体適用時の
-- 業務影響確認が別途必要なため、今回のカンバン不具合の解消に必要な最小差分に絞る）。
--
-- 閲覧を許可する範囲:
--   1. 本人（user_id = auth.uid()）
--   2. super_admin（所属不問）
--   3. 記録者と同じ事業部に所属するメンバー（user_divisions の結合。role 不問）
-- ※ manager は 001 では「全社の活動」を閲覧できたが、本適用後は自分と同じ事業部の
--    メンバーの活動のみになる（011 と同じ意図的な挙動変更。運用要望と一致）。

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
