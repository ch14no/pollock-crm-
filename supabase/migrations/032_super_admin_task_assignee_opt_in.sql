-- ============================================================
-- 032: システム管理者を事業部単位でタスク担当候補に表示する
-- ============================================================
-- 背景（2026-07-24・東さんからの要望）:
--   029でsystem管理者(super_admin)をタスク看板の担当候補一覧から一律除外した
--   （super_adminは元々全事業部のuser_divisionsに入れられる設計のため、除外
--   しないとM&A等どの事業部のタスクでも担当者に選べてしまっていた）。
--
--   しかしsuper_adminの中には実際にある事業部の実務を担当していて、その
--   事業部のタスク看板には担当者として出てほしい人もいる（例: 山﨑優さん）。
--   これまでは一時的に role を manager に降格させることでしか対応できず、
--   本来の権限（システム管理者機能）を失う副作用があった。
--
--   本マイグレーションで、事業部ごとに「この人はここでは担当候補として
--   表示してよい」を選べる opt-in フラグを追加する。
--
-- 方針:
--   user_divisions に show_as_task_assignee を追加。super_adminについては
--   このフラグがtrueの事業部でのみ list_division_members に出るようにする。
--   一般ユーザー・マネージャーは元々常に表示対象なので、このフラグは無視される
--   （設定しても意味を持たない・影響しない）。
--
--   設定UIは 設定画面 → アカウント管理 の「所属事業部」チェックボックス
--   （システム管理者の場合は「タスク看板に担当者として表示する事業部」と表示）。
--   保存APIは選択した事業部すべてに show_as_task_assignee=true を設定する
--   （src/app/api/admin/users/route.ts）。未選択の事業部は行ごと削除されるため
--   （既存の「全削除→選択分を再挿入」方式）、デフォルトでは非表示のまま。
-- ============================================================

ALTER TABLE public.user_divisions
  ADD COLUMN IF NOT EXISTS show_as_task_assignee BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.list_division_members(target_division_id UUID)
RETURNS TABLE (
  id         UUID,
  name       VARCHAR,
  email      VARCHAR,
  role       VARCHAR,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_super_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  is_super_admin := COALESCE(
    (SELECT usr.role = 'super_admin' FROM public.users usr WHERE usr.id = auth.uid()),
    FALSE
  );

  IF NOT is_super_admin AND NOT EXISTS (
    SELECT 1 FROM public.user_divisions
    WHERE division_id = target_division_id AND user_id = auth.uid()
  ) THEN
    RETURN;
  END IF;

  -- super_admin（システム管理者）は、その事業部でshow_as_task_assigneeが
  -- trueになっている行のみ候補に含める（一般ユーザー・マネージャーは無条件）
  RETURN QUERY
    SELECT u.id, u.name, u.email, u.role, u.created_at
    FROM public.user_divisions ud
    JOIN public.users u ON u.id = ud.user_id
    WHERE ud.division_id = target_division_id
      AND (u.role <> 'super_admin' OR ud.show_as_task_assignee)
    ORDER BY u.name;
END;
$$;

REVOKE ALL ON FUNCTION public.list_division_members(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_division_members(UUID) TO authenticated;
