-- ============================================================
-- activities に DELETE ポリシーを追加（不具合修正）
-- ============================================================
-- activities は 001 で SELECT / INSERT / UPDATE のポリシーのみ作成され、
-- DELETE ポリシーが一度も存在しなかった。RLS 有効テーブルでポリシーの無い
-- 操作は「エラーにならず対象0行」として黙って成功するため、タスク・活動記録の
-- 削除が全ユーザー・全端末で一度もDBに反映されず、画面のリロードで復活していた
-- （2026-07 財務支援事業部からの報告）。
-- クライアント側の deleteActivity() も削除行数を検証するよう同時に修正済み。
--
-- 削除を許可する範囲:
--   1. 本人（user_id = auth.uid()）… UIの削除ボタンは本人のタスクにのみ表示される
--   2. super_admin（所属不問・006のパターンに合わせ所属を要求しない）
--   3. 記録者と同じ事業部に所属する manager … 責任者によるボードの整理を可能にする
--      （読み取りポリシー activities_select（011）と同じ user_divisions の結合）
-- user_id が NULL の行は 1・3 に該当し得ないため super_admin のみ削除できる。

DROP POLICY IF EXISTS "activities_delete" ON public.activities;
CREATE POLICY "activities_delete" ON public.activities
  FOR DELETE USING (
    user_id = auth.uid()
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND EXISTS (
        SELECT 1
        FROM public.user_divisions mine
        JOIN public.user_divisions theirs ON mine.division_id = theirs.division_id
        WHERE mine.user_id = auth.uid()
          AND theirs.user_id = activities.user_id
      )
    )
  );
