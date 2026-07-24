-- ============================================================
-- 034: 未担当（user_id IS NULL）タスクの編集・削除・移動・閲覧を修正
-- ============================================================
-- 背景（2026-07-24・実際の報告で発覚）:
--   029でタスクを「未担当」に戻せる機能を追加した。しかし
--   activities_select（027/028）・activities_update（030）・
--   activities_delete（026）・task_meta_select/update（030）は
--   いずれも shares_division_with(user_id) を使って「担当者と事業部を
--   共有しているか」で権限判定しており、user_id が NULL（未担当）の場合
--   の扱いを考慮していなかった。
--
--   SQLの三値論理上、`user_id = auth.uid()`（NULL=uuid）はNULLになり、
--   `shares_division_with(NULL)` はFALSEを返すため、ポリシー全体が
--   `NULL OR FALSE OR ...` となり、super_adminでない限りNULLに評価される
--   （RLSではNULL=拒否）。結果、未担当タスクはsuper_admin以外の誰も
--   閲覧・編集・削除・移動できなくなっていた。
--
--   さらに、カード移動時は「移動先の列全体」をまとめてupsertする設計
--   （031）のため、同じ列に未担当タスクが1件でも混ざっていると、その
--   1件のRLS拒否で列全体の移動・並び替え・一括同期が巻き添えで失敗する
--   （財務支援事業部の複数メンバーから報告された「同期に失敗しました」
--   「見込み客列のタスクが編集・削除・移動できない」の根本原因）。
--
-- 方針:
--   未担当タスクにはowner（user_id）が無くshares_division_withが使えない
--   ため、代わりにタスクの対象（target_type/target_id、contactまたはdeal）
--   が呼び出し元と事業部を共有しているかで判定する
--   SECURITY DEFINER関数 shares_division_with_activity_target を新設し、
--   各ポリシーに「user_id IS NULL のときはこちらで判定する」分岐を追加する。
-- ============================================================

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
  ELSE
    -- company等、division_idを持たないtarget_typeは対象外（判定不能なので拒否）
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

REVOKE ALL ON FUNCTION public.shares_division_with_activity_target(VARCHAR, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shares_division_with_activity_target(VARCHAR, UUID) TO authenticated;


-- activities_select（028を踏襲し、未担当タスクの分岐を追加）
DROP POLICY IF EXISTS "activities_select" ON public.activities;
CREATE POLICY "activities_select" ON public.activities
  FOR SELECT USING (
    user_id = auth.uid()
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (user_id IS NOT NULL AND public.shares_division_with(user_id))
    OR (user_id IS NULL AND public.shares_division_with_activity_target(target_type, target_id))
  );

-- activities_update（030を踏襲し、未担当タスクの分岐を追加）
DROP POLICY IF EXISTS "activities_update" ON public.activities;
CREATE POLICY "activities_update" ON public.activities
  FOR UPDATE USING (
    user_id = auth.uid()
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (user_id IS NOT NULL AND public.shares_division_with(user_id))
    OR (user_id IS NULL AND public.shares_division_with_activity_target(target_type, target_id))
  );

-- activities_delete（026を踏襲し、未担当タスクの分岐を追加）
DROP POLICY IF EXISTS "activities_delete" ON public.activities;
CREATE POLICY "activities_delete" ON public.activities
  FOR DELETE USING (
    user_id = auth.uid()
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      user_id IS NOT NULL
      AND (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND EXISTS (
        SELECT 1
        FROM public.user_divisions mine
        JOIN public.user_divisions theirs ON mine.division_id = theirs.division_id
        WHERE mine.user_id = auth.uid()
          AND theirs.user_id = activities.user_id
      )
    )
    OR (user_id IS NULL AND public.shares_division_with_activity_target(target_type, target_id))
  );

-- task_meta_select（030を踏襲し、未担当タスクの分岐を追加）
DROP POLICY IF EXISTS "task_meta_select" ON public.task_meta;
CREATE POLICY "task_meta_select" ON public.task_meta
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.id = task_meta.activity_id
        AND (
          a.user_id = auth.uid()
          OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
          OR (a.user_id IS NOT NULL AND public.shares_division_with(a.user_id))
          OR (a.user_id IS NULL AND public.shares_division_with_activity_target(a.target_type, a.target_id))
        )
    )
  );

-- task_meta_update（030を踏襲し、未担当タスクの分岐を追加）
DROP POLICY IF EXISTS "task_meta_update" ON public.task_meta;
CREATE POLICY "task_meta_update" ON public.task_meta
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.id = task_meta.activity_id
        AND (
          a.user_id = auth.uid()
          OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
          OR (a.user_id IS NOT NULL AND public.shares_division_with(a.user_id))
          OR (a.user_id IS NULL AND public.shares_division_with_activity_target(a.target_type, a.target_id))
        )
    )
  );

-- reassign_task（029）も同じ考え方に揃える。未担当タスクの引き取りは
-- これまでsuper_admin限定だったが、対象（顧客/商談）の事業部を共有する
-- メンバーであれば誰でも引き取れるようにする（編集・削除・移動を同一
-- 事業部メンバーに開放したのに担当変更だけ取り残すのは一貫性を欠くため）
CREATE OR REPLACE FUNCTION public.reassign_task(target_activity_id UUID, new_assignee_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_owner  UUID;
  current_type   VARCHAR;
  current_target_type VARCHAR;
  current_target_id   UUID;
  is_super_admin BOOLEAN;
  updated_rows   INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  is_super_admin := COALESCE(
    (SELECT usr.role = 'super_admin' FROM public.users usr WHERE usr.id = auth.uid()),
    FALSE
  );

  SELECT user_id, activity_type, target_type, target_id
    INTO current_owner, current_type, current_target_type, current_target_id
    FROM public.activities WHERE id = target_activity_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;

  IF current_type <> 'task' THEN
    RAISE EXCEPTION 'only task activities can be reassigned';
  END IF;

  -- 呼び出し元が super_admin / 現在の担当者本人 / 現在の担当者と事業部を共有するメンバー /
  -- （未担当の場合）対象の事業部を共有するメンバー、のいずれか
  IF NOT (
    is_super_admin
    OR (current_owner IS NOT NULL AND (current_owner = auth.uid() OR public.shares_division_with(current_owner)))
    OR (current_owner IS NULL AND public.shares_division_with_activity_target(current_target_type, current_target_id))
  ) THEN
    RAISE EXCEPTION 'not permitted to reassign this task';
  END IF;

  -- 変更先の新担当者も、呼び出し元と事業部を共有するメンバーであること（無関係な他事業部への付け替え防止）。
  -- new_assignee_id が NULL（「未担当」に戻す）の場合はteammateチェック自体が
  -- 意味をなさないため誰でも実行できる
  IF new_assignee_id IS NOT NULL AND NOT (
    is_super_admin
    OR public.shares_division_with(new_assignee_id)
  ) THEN
    RAISE EXCEPTION 'target user is not a teammate';
  END IF;

  UPDATE public.activities SET user_id = new_assignee_id WHERE id = target_activity_id;
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows = 0 THEN
    RAISE EXCEPTION 'reassign failed: task no longer exists';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_task(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reassign_task(UUID, UUID) TO authenticated;
