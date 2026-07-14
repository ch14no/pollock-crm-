-- ============================================================
-- 024: 社内紹介者検索用のユーザーディレクトリ（レビュー修正2）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- 背景:
--   ReferrerPicker（紹介者欄）の社内検索は users テーブルを直接クエリするが、
--   001_initial_schema.sql の users_select RLS（id = auth.uid() OR role = 'super_admin'）
--   により、一般ユーザー・managerは自分自身しか検索結果に出てこない。
--   社内紹介者検索が実質super_admin専用になってしまっていた。
--
-- 方針:
--   users_select ポリシー自体は変更しない（メールアドレス等の機微情報を
--   全社員に晒したくないため）。代わりに、id/name（+主所属事業部名）のみを
--   返す SECURITY DEFINER 関数を新設し、紹介者検索という限定用途にだけ
--   RLSを迂回した最小限の projection を提供する。
--
--   ビュー（デフォルトではview所有者の権限でテーブルを参照するためRLSを
--   迂回できる）でも同じことは実現できるが、このプロジェクトの既存マイグレーション
--   （001のhandle_new_user・005のsync webhook・015/017のトリガー関数）は
--   いずれも「RLSを迂回する処理はSECURITY DEFINER関数として明示する」方針で
--   統一されているため、それに合わせて関数として実装する。
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_user_directory()
RETURNS TABLE (
  id                    UUID,
  name                  VARCHAR,
  primary_division_name VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- GRANT EXECUTE を authenticated ロールのみに絞っているため、未認証（anon）からは
  -- そもそも呼び出せない。auth.uid() チェックは念のための多重防御。
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      u.id,
      u.name,
      (
        SELECT d.name
        FROM public.user_divisions ud
        JOIN public.divisions d ON d.id = ud.division_id
        WHERE ud.user_id = u.id
        ORDER BY ud.is_primary DESC
        LIMIT 1
      ) AS primary_division_name
    FROM public.users u
    ORDER BY u.name;
END;
$$;

-- デフォルトではPUBLIC（=anonロールも含む全ロール）にEXECUTEが付与されるため、
-- 明示的に剥奪してから authenticated のみへ許可する
REVOKE ALL ON FUNCTION public.list_user_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_user_directory() TO authenticated;
