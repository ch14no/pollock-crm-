-- ============================================================
-- 022: 案件の対応期日（マイルストーン）＋Slack通知設定（M&A事業部要望⑧）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- 方針:
--   締切日8項目のうち「クロージング」は既存 deals.close_date
--   （クロージング予定日、画面内アラート実装済み）を流用し、二重管理を避ける
--   （M&A事業部・東さん回答を受けたユーザー確認済みの判断）。
--   残り7項目は013の division_document_types と同じ「事業部ごとに設定可能な
--   マイルストーン種別」パターンで実現し、M&A固有のハードコードを避ける。
--
--   通知先チャンネル・メンション・何日前は division_notification_settings で
--   事業部ごとに設定可能にする。Slack Webhook URLは機密情報のため、
--   一般ユーザーには見せずmanager/super_adminのみ閲覧可能にする。
--
-- 閲覧範囲: deal_milestonesは013/014と同方針（自事業部＋super_adminのみ）。
-- ============================================================

-- 事業部ごとのマイルストーン種別
CREATE TABLE public.division_milestone_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (division_id, name)
);
CREATE INDEX idx_division_milestone_types_division ON public.division_milestone_types(division_id);

-- 案件ごとのマイルストーン期日
CREATE TABLE public.deal_milestones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  -- RLSと通知バッチの絞り込み用に事業部IDを非正規化して保持する（017と同じくトリガーで強制導出）
  division_id       UUID NOT NULL REFERENCES public.divisions(id),
  milestone_type_id UUID NOT NULL REFERENCES public.division_milestone_types(id) ON DELETE CASCADE,
  due_date          DATE,
  notified_at       TIMESTAMPTZ, -- 前日通知の重複送信防止用（Cronが送信後にセット）
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (deal_id, milestone_type_id)
);
CREATE INDEX idx_deal_milestones_deal     ON public.deal_milestones(deal_id);
CREATE INDEX idx_deal_milestones_division ON public.deal_milestones(division_id);
CREATE INDEX idx_deal_milestones_due_date ON public.deal_milestones(due_date);

CREATE TRIGGER update_deal_milestones_updated_at
  BEFORE UPDATE ON public.deal_milestones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 017で定義済みの sync_deal_child_division() を再利用（division_idをdealsから強制導出）
DROP TRIGGER IF EXISTS sync_deal_milestones_division ON public.deal_milestones;
CREATE TRIGGER sync_deal_milestones_division
  BEFORE INSERT OR UPDATE OF deal_id ON public.deal_milestones
  FOR EACH ROW EXECUTE FUNCTION public.sync_deal_child_division();

-- クロージング予定日（deals.close_date）アラートの重複送信防止用（修正7）。
-- deal_milestones.notified_at と同じ考え方だが、closingはdeals自体に既存の列として
-- 持たせる（deal_milestonesの行を経由しないため）
ALTER TABLE public.deals
  ADD COLUMN close_date_alert_notified_at TIMESTAMPTZ;

-- 事業部ごとのSlack通知設定
CREATE TABLE public.division_notification_settings (
  division_id       UUID PRIMARY KEY REFERENCES public.divisions(id) ON DELETE CASCADE,
  slack_webhook_url TEXT,
  slack_mention     TEXT, -- 例: "<!channel>" や "<@U0123456>"
  days_before       INTEGER NOT NULL DEFAULT 1 CHECK (days_before >= 0),
  enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_division_notification_settings_updated_at
  BEFORE UPDATE ON public.division_notification_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Webhook URLはhttp(s)のみ許可（013のURLスキーム制限と同じ意図）
ALTER TABLE public.division_notification_settings
  ADD CONSTRAINT division_notification_settings_webhook_scheme
  CHECK (slack_webhook_url IS NULL OR slack_webhook_url ~* '^https?://');

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.division_milestone_types      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_milestones                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.division_notification_settings ENABLE ROW LEVEL SECURITY;

-- マイルストーン種別: 閲覧は全認証ユーザー、管理はsuper_adminまたは当該事業部のmanager
CREATE POLICY "division_milestone_types_select" ON public.division_milestone_types
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "division_milestone_types_manage" ON public.division_milestone_types
  FOR ALL USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    )
  );

-- マイルストーン期日: 013と同方針（自事業部のメンバー＋super_adminのみ）
CREATE POLICY "deal_milestones_select" ON public.deal_milestones
  FOR SELECT USING (
    division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );
CREATE POLICY "deal_milestones_manage" ON public.deal_milestones
  FOR ALL USING (
    division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  );

-- 通知設定: Webhook URLは機密情報のため、manager/super_adminのみ閲覧・管理可能
-- （一般ユーザーには通知設定パネル自体を表示しないUI制御と合わせて二重に保護する）
CREATE POLICY "division_notification_settings_select" ON public.division_notification_settings
  FOR SELECT USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    )
  );
CREATE POLICY "division_notification_settings_manage" ON public.division_notification_settings
  FOR ALL USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    )
  );

-- GRANT（009の教訓: RLS以前のpermission denied防止）
GRANT SELECT, INSERT, UPDATE, DELETE ON public.division_milestone_types      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_milestones               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.division_notification_settings TO authenticated;

-- ============================================================
-- Cron配信バッチ（service role経由）が使う参照用RPC不要。
-- src/app/api/cron/deadline-alerts/route.ts はSupabase service roleキーで
-- RLSをバイパスして直接クエリするため、追加のポリシーは不要。
-- ============================================================

-- ============================================================
-- M&A事業部向けマイルストーン種別のシード（013と同じ名前解決パターン。
-- 該当事業部が見つからない場合は何もしない）
-- クロージングはdeals.close_dateを流用するためシードしない。
-- ============================================================
DO $$
DECLARE
  ma_division_id UUID;
BEGIN
  SELECT id INTO ma_division_id FROM public.divisions WHERE name = 'M＆A事業部' LIMIT 1;
  IF ma_division_id IS NULL THEN
    RAISE NOTICE 'M＆A事業部 が見つからないためマイルストーン種別のシードをスキップしました';
    RETURN;
  END IF;

  INSERT INTO public.division_milestone_types (division_id, name, sort_order) VALUES
    (ma_division_id, 'アドバイザリー業務契約書の締結', 0),
    (ma_division_id, 'IM作成（ドラフト）',           1),
    (ma_division_id, 'IM作成（最終版）',             2),
    (ma_division_id, 'トップ面談',                   3),
    (ma_division_id, '基本合意',                     4),
    (ma_division_id, 'DD',                           5),
    (ma_division_id, '最終合意',                     6)
  ON CONFLICT (division_id, name) DO NOTHING;

  -- 通知設定の初期行（無効状態）。管理者が設定画面からWebhook URL等を入力してONにする。
  INSERT INTO public.division_notification_settings (division_id, enabled, days_before)
  VALUES (ma_division_id, FALSE, 1)
  ON CONFLICT (division_id) DO NOTHING;
END $$;
