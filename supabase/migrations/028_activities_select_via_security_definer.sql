-- ============================================================
-- 028: activities の同一事業部 SELECT を SECURITY DEFINER 関数経由に修正
-- ============================================================
-- 027 で activities_select を「同一事業部メンバー間で閲覧可」に更新したが、
-- ポリシー式が user_divisions を mine / theirs の2回参照しており、
-- 相手（theirs）側の行は user_divisions 自身の RLS（自分の所属しか読めない）に
-- 阻まれて常に不可視になる。結果 EXISTS が恒偽になり、同僚の活動・タスクが
-- 依然として見えなかった（027 適用後に本番の検証アカウントで実測して確定）。
--
-- ポリシー式から他テーブルを RLS 付きで参照するとこの罠を踏むため、
-- 024（list_user_directory）と同じ方針で「RLS を迂回する判定は SECURITY DEFINER
-- 関数に閉じ込める」に統一する。shares_division_with(target) は呼び出し元
-- （auth.uid()）と target が事業部を共有するかを、user_divisions の RLS を
-- 迂回して真偽で返す。
--
-- ※ 同じ user_divisions 二重結合パターンは 026（activities_delete）にも存在する。
--    こちらは UI 上、削除ボタンが本人のタスクにしか出ず、manager による他人タスクの
--    削除という副次機能でのみ潜在化するため今回は変更しない（必要になれば同関数へ
--    差し替える）。本マイグレーションは報告された「チーム表示で同僚のタスクが
--    見えない」不具合の解消に必要な SELECT のみを対象とする。

-- 呼び出し元と target が1つ以上の事業部を共有するか（user_divisions の RLS を迂回）
CREATE OR REPLACE FUNCTION public.shares_division_with(target_user UUID)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_divisions mine
    JOIN public.user_divisions theirs ON mine.division_id = theirs.division_id
    WHERE mine.user_id = auth.uid()
      AND theirs.user_id = target_user
  );
$$;

-- デフォルトの PUBLIC への EXECUTE を剥奪し、認証済みロールにのみ許可（024 と同方針）
REVOKE ALL ON FUNCTION public.shares_division_with(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shares_division_with(UUID) TO authenticated;

DROP POLICY IF EXISTS "activities_select" ON public.activities;
CREATE POLICY "activities_select" ON public.activities
  FOR SELECT USING (
    user_id = auth.uid()
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR public.shares_division_with(user_id)
  );
