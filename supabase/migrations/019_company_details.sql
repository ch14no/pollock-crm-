-- ============================================================
-- 019: 会社マスタの詳細項目追加 ＋ 会社情報の更新権限を全ユーザーへ開放
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- 背景（M&A事業部フィードバック続き・2026-07-11）:
--   1. 会社詳細に登録できる項目が少ない（名称・法人番号・Webサイト・IRのみ）ため、
--      住所・電話・業種・代表者・従業員数・資本金・設立日・メモを追加する。
--      従業員数・資本金を数値型で持つのは、将来のマッチング機能（要望㉒㉓）で
--      規模条件の突き合わせに使うため。
--   2. これまで会社情報の更新は manager / super_admin のみだったが、
--      一般ユーザーにも開放する（現場のメンバーがIRリンクや会社情報を
--      直接メンテナンスできるように。M&A事業部の運用要望）。
--      ※ 会社は全社共有マスタのため、変更は全事業部に反映される点は周知が必要。
-- ============================================================

ALTER TABLE public.companies
  ADD COLUMN address        TEXT,
  ADD COLUMN phone          VARCHAR(50),
  ADD COLUMN industry       VARCHAR(100),
  ADD COLUMN representative VARCHAR(100),
  ADD COLUMN employee_count INTEGER CHECK (employee_count IS NULL OR employee_count >= 0),
  ADD COLUMN capital        BIGINT  CHECK (capital IS NULL OR capital >= 0),
  ADD COLUMN established_on DATE,
  ADD COLUMN note           TEXT;

-- 更新権限の開放: manager/super_admin 限定 → ログイン済みの全ユーザー
DROP POLICY IF EXISTS "companies_update" ON public.companies;
CREATE POLICY "companies_update" ON public.companies
  FOR UPDATE USING (auth.uid() IS NOT NULL);
