-- ============================================================
-- 010: 商品マスタのDB化 + 商談への提案商品カラム追加
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- 背景:
--   商品マスタ（事業部別の提案商品リスト・表示ON/OFF）と商談の選択商品は
--   これまでZustand（ブラウザのlocalStorage）にのみ保存されており、
--   ユーザー間・端末間で共有されていなかった。金銭管理機能の前提として
--   DBを唯一の真実源にする。
--
-- 適用後の注意:
--   既存のlocalStorage上の商品リストは自動移行されません。
--   設定画面 > 商品マスタ管理 から再登録してください（登録済み商品は少数の想定）。
-- ============================================================

-- 事業部別 商品マスタ
CREATE TABLE public.division_products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (division_id, name)
);
CREATE INDEX idx_division_products_division ON public.division_products(division_id);

-- 事業部別 設定（商品選択の表示ON/OFF。今後の事業部別トグルの置き場も兼ねる）
CREATE TABLE public.division_settings (
  division_id      UUID PRIMARY KEY REFERENCES public.divisions(id) ON DELETE CASCADE,
  products_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at自動更新（001の他テーブルと同じトリガーを適用）
CREATE TRIGGER update_division_settings_updated_at
  BEFORE UPDATE ON public.division_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 商談の提案商品（現行実装が「商談につき1商品名」のためシンプルなカラムで保持）
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS product_name VARCHAR(255);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.division_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.division_settings ENABLE ROW LEVEL SECURITY;

-- 閲覧: 全認証ユーザー（商談登録画面で自事業部の商品を選ぶために必要）
CREATE POLICY "division_products_select" ON public.division_products
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "division_settings_select" ON public.division_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- 管理: super_admin、または当該事業部に所属するmanager
CREATE POLICY "division_products_manage" ON public.division_products
  FOR ALL USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    )
  );
CREATE POLICY "division_settings_manage" ON public.division_settings
  FOR ALL USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    )
  );

-- GRANT（009でpipeline_tabsのGRANT漏れによりpermission deniedが発生した教訓）
GRANT SELECT, INSERT, UPDATE, DELETE ON public.division_products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.division_settings TO authenticated;
