-- ============================================================
-- 029: タスクの担当者変更（同一事業部メンバーなら誰でも再アサイン可）
-- ============================================================
-- 背景（人材開発事業部・松木/斎藤からの要望、2026-07-23）:
--   タスクは作成時点では「早い者勝ちで記入」されるだけで担当が定まっておらず、
--   後から石川・斎藤等の実担当者へ振り分け、その後も担当が変わることがある。
--   しかし activities_update（001）は USING (user_id = auth.uid()) のみのため、
--   本人以外は他人のタスクを一切UPDATEできず、カンバンに担当者変更UIを
--   追加してもこのRLSに阻まれて保存できない。まずDB側を対応させる。
--
--   併せて、担当候補一覧の取得（フロントの fetchDivisionUsers）は
--   user_divisions と users を直接joinしているが、users_select（001）が
--   「本人 or super_admin のみ閲覧可」であるため、manager（非super_admin）が
--   タスク作成時に使う担当者選択も実質「自分のみ」しか出ておらず機能していない
--   （024のlist_user_directoryと同じ理由の別インスタンス）。今回まとめて
--   SECURITY DEFINER関数で解消する。
--
-- 方針:
--   1. reassign_task(activity_id, new_assignee_id): 同一事業部メンバー間の
--      再アサインのみを許可するSECURITY DEFINER関数。activities_updateの
--      USING句自体は広げない（広げるとタイトル・メモ等 他フィールドの編集権限まで
--      同僚に開放してしまうため）。再アサインという1操作に絞って権限判定＋UPDATEを
--      関数内に閉じ込める。activity_type='task' 以外（電話・面談等のログ）は
--      対象外とし、記録者の書き換えを再アサイン機能の対象外に保つ。
--   2. list_division_members(division_id): 担当候補一覧をRLSを迂回して返す。
--      呼び出し元がその事業部のメンバー（or super_admin）でなければ何も返さない。
--
-- レビュー修正（2026-07-23）:
--   初版は `IF NOT (current_owner = auth.uid() OR is_super_admin OR ...)` の形で
--   権限チェックしていたが、current_owner がNULL（担当者不在のタスク）または
--   is_super_admin の元になる role 参照がNULL（auth.uid()に対応するusers行が
--   一時的に無い等）の場合、比較結果がNULLになりOR全体がNULLに評価される。
--   plpgsqlの IF はNULLを偽として扱うため `IF NOT (NULL)` は分岐に入らず、
--   本来投げるべき例外が発生せず権限チェックが丸ごと素通りしてしまっていた
--   （list_division_members側の権限ガードも同型の罠を含んでいた）。
--   今回 is_super_admin を COALESCE で確定的な boolean にし、current_owner が
--   NULL の場合は「同僚」が定義できないため super_admin のみが引き取れる、という
--   形に明示的に倒すよう修正した。
--   併せて SELECT〜UPDATE 間のTOCTOU（同時に複数人が同じタスクを再アサインする
--   競合）を避けるため取得行に FOR UPDATE でロックし、UPDATE の影響行数も検証する
--   （deleteActivity が踏んだ「0行更新が無音で成功扱いになる」罠と同じ対策）。
--
-- 実機バグ修正（2026-07-23・財務支援事業部の実テストで発覚）:
--   list_division_members は `RETURNS TABLE (id, name, email, role, created_at)` の
--   ため、id・role が関数内の暗黙の出力変数名としても存在する。関数本体の
--   `(SELECT role = 'super_admin' FROM public.users WHERE id = auth.uid())` は
--   role・id いずれも「出力変数」なのか「usersテーブルの列」なのかPostgreSQLが
--   区別できず、実行時に `42702 column reference "role" is ambiguous` で落ちていた。
--   CREATE FUNCTION自体は構文チェックのみで通ってしまい（実行時にしか検出されない）、
--   本番でSQLを流した後も気づけなかった。usersテーブルにエイリアスを付けて
--   明示的に修飾することで解消（reassign_taskはRETURNS voidで同名の出力変数が
--   存在しないため元々問題なかったが、同じ罠の再発防止のため合わせて修飾した）。
-- ============================================================

-- 担当候補一覧（呼び出し元がその事業部のメンバー、またはsuper_adminの場合のみ返す）
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

  -- usr エイリアスで明示的に修飾（この関数はRETURNS TABLEにid/roleがあり、
  -- 無修飾のid/roleは出力変数と解釈されて曖昧になり実行時エラーになるため）
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

  RETURN QUERY
    SELECT u.id, u.name, u.email, u.role, u.created_at
    FROM public.user_divisions ud
    JOIN public.users u ON u.id = ud.user_id
    WHERE ud.division_id = target_division_id
    ORDER BY u.name;
END;
$$;

REVOKE ALL ON FUNCTION public.list_division_members(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_division_members(UUID) TO authenticated;


-- タスクの再アサイン（同一事業部メンバー間のみ許可）
CREATE OR REPLACE FUNCTION public.reassign_task(target_activity_id UUID, new_assignee_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_owner  UUID;
  current_type   VARCHAR;
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

  -- FOR UPDATE: 権限チェックからUPDATEまでの間に他セッションが同じ行を
  -- 書き換える競合（TOCTOU）を防ぐため行ロックを取得する
  SELECT user_id, activity_type INTO current_owner, current_type
    FROM public.activities WHERE id = target_activity_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;

  IF current_type <> 'task' THEN
    RAISE EXCEPTION 'only task activities can be reassigned';
  END IF;

  -- 呼び出し元が super_admin / 現在の担当者本人 / 現在の担当者と事業部を共有するメンバー、のいずれか。
  -- current_owner が NULL（担当者不在。退職者の残タスク等）の場合は「同僚」を定義できないため、
  -- NULLを許可側へ倒さず super_admin のみが引き取れる扱いにする
  IF NOT (
    is_super_admin
    OR (current_owner IS NOT NULL AND (current_owner = auth.uid() OR public.shares_division_with(current_owner)))
  ) THEN
    RAISE EXCEPTION 'not permitted to reassign this task';
  END IF;

  -- 変更先の新担当者も、呼び出し元と事業部を共有するメンバーであること（無関係な他事業部への付け替え防止）
  IF NOT (
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
