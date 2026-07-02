-- ============================================================================
-- 事業部同期 Webhook トリガー（pollock-crm divisions → pollock-cup departments）
-- ============================================================================
-- ★★★ このファイルは自動適用されません ★★★
-- 人間がレビューし、下記のプレースホルダーを実際の値に置き換えたうえで、
-- Supabase SQL Editor または `supabase db push` 等で手動実行してください。
--
--   - REPLACE_WITH_POLLOCK_CUP_URL      → pollock-cup の本番URL（例: https://pollock-cup.vercel.app）
--   - REPLACE_WITH_DIVISION_SYNC_SECRET → DIVISION_SYNC_SECRET と同じ値（両プロジェクトのVercel環境変数と一致させること）
--
-- 背景:
-- pollock-crm (divisions) と pollock-cup (departments) は別々の Supabase
-- プロジェクト（別Postgresインスタンス）であるため、通常のDBトリガーで
-- 直接同期することはできない。そのため pg_net 拡張の net.http_post() を
-- 使い、Postgresトリガーから相手プロジェクトのアプリケーションAPI
-- （/api/webhooks/division-sync）をHTTP経由で呼び出す構成にしている。
--
-- 同期対象は CREATE と RENAME（name変更）のみ。
-- DELETE は意図的に同期しない。事業部の削除は contacts/deals 等の参照整合性
-- チェックが絡む操作であり、cross-project webhook 経由で自動削除を伝播する
-- のはリスクが高いと判断した。削除された場合、pollock-cup 側の対応する
-- department は孤立したまま残る（実害はないが不要なレコードとして残る）。
-- 必要であれば人間が手動で整理する。詳細は
-- src/app/api/webhooks/division-sync/route.ts のコメントも参照。
--
-- ループ防止は受信側（pollock-cup の /api/webhooks/division-sync）の
-- idempotencyチェック（同じidで既にnameが一致していれば書き込みスキップ）
-- に委ねている。このトリガー自体はループ防止のロジックを持たない。
-- ============================================================================

-- pg_net 拡張が未有効の場合は有効化（Supabaseでは通常デフォルトで利用可能）
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_division_sync()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://REPLACE_WITH_POLLOCK_CUP_URL/api/webhooks/division-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-division-sync-secret', 'REPLACE_WITH_DIVISION_SYNC_SECRET'
    ),
    body := jsonb_build_object(
      'id', NEW.id,
      'name', NEW.name,
      'event', (CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'rename' END)
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS division_sync_trigger ON public.divisions;

CREATE TRIGGER division_sync_trigger
AFTER INSERT OR UPDATE OF name ON public.divisions
FOR EACH ROW
EXECUTE FUNCTION public.notify_division_sync();
