-- ============================================================
-- Pollock Core CRM - Feature Extensions
-- 追加機能: タスク象限・長期課題・顧客ステータス・カスタムフィールド
-- ============================================================

-- ─── タスクメタデータ（4象限） ─────────────────────────────────────
CREATE TABLE public.task_meta (
  activity_id UUID        PRIMARY KEY REFERENCES public.activities(id) ON DELETE CASCADE,
  urgency     BOOLEAN     NOT NULL DEFAULT FALSE,
  importance  BOOLEAN     NOT NULL DEFAULT FALSE,
  scope       VARCHAR(20) NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal', 'team')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 長期課題 ─────────────────────────────────────────────────────
CREATE TABLE public.challenges (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID        REFERENCES public.divisions(id) ON DELETE SET NULL,
  user_id     UUID        REFERENCES public.users(id)     ON DELETE SET NULL,
  title       VARCHAR(255) NOT NULL,
  description TEXT,
  scope       VARCHAR(20) NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal', 'team')),
  deadline    DATE,
  status      VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER challenges_updated_at BEFORE UPDATE ON public.challenges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─── 顧客ステータス（星・ハート等） ────────────────────────────────
CREATE TABLE public.contact_statuses (
  contact_id UUID        NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  status     VARCHAR(20) NOT NULL CHECK (status IN ('star', 'heart', 'rising', 'blacklist', 'trophy')),
  user_id    UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contact_id, status)
);

-- ─── 事業部別カスタムフィールド定義 ─────────────────────────────────
CREATE TABLE public.division_custom_fields (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID        NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  label       VARCHAR(100) NOT NULL,
  field_type  VARCHAR(20) NOT NULL CHECK (field_type IN ('text', 'select', 'number', 'boolean')),
  options     TEXT[],
  required    BOOLEAN     NOT NULL DEFAULT FALSE,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (division_id, name)
);

-- ─── 顧客カスタムフィールド値 ────────────────────────────────────────
CREATE TABLE public.contact_custom_values (
  contact_id UUID        NOT NULL REFERENCES public.contacts(id)               ON DELETE CASCADE,
  field_id   UUID        NOT NULL REFERENCES public.division_custom_fields(id) ON DELETE CASCADE,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contact_id, field_id)
);

-- ─── RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.task_meta           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenges          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_statuses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.division_custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_custom_values  ENABLE ROW LEVEL SECURITY;

-- task_meta: 自分のアクティビティのみ
CREATE POLICY "task_meta_select" ON public.task_meta FOR SELECT USING (
  activity_id IN (SELECT id FROM public.activities WHERE user_id = auth.uid())
  OR (SELECT role FROM public.users WHERE id = auth.uid()) IN ('super_admin', 'manager')
);
CREATE POLICY "task_meta_insert" ON public.task_meta FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "task_meta_update" ON public.task_meta FOR UPDATE USING (
  activity_id IN (SELECT id FROM public.activities WHERE user_id = auth.uid())
);

-- challenges: 事業部内
CREATE POLICY "challenges_select" ON public.challenges FOR SELECT USING (
  division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);
CREATE POLICY "challenges_insert" ON public.challenges FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "challenges_update" ON public.challenges FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "challenges_delete" ON public.challenges FOR DELETE USING (user_id = auth.uid());

-- contact_statuses: 事業部内の顧客
CREATE POLICY "contact_statuses_select" ON public.contact_statuses FOR SELECT USING (
  contact_id IN (
    SELECT c.id FROM public.contacts c
    WHERE c.division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
  )
);
CREATE POLICY "contact_statuses_insert" ON public.contact_statuses FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "contact_statuses_delete" ON public.contact_statuses FOR DELETE USING (auth.uid() IS NOT NULL);

-- division_custom_fields: 全認証ユーザーが読み取り可能
CREATE POLICY "dcf_select" ON public.division_custom_fields FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "dcf_manage" ON public.division_custom_fields FOR ALL USING (
  (SELECT role FROM public.users WHERE id = auth.uid()) IN ('super_admin', 'manager')
);

-- contact_custom_values: 事業部内
CREATE POLICY "ccv_select" ON public.contact_custom_values FOR SELECT USING (
  contact_id IN (
    SELECT c.id FROM public.contacts c
    WHERE c.division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
  )
);
CREATE POLICY "ccv_upsert" ON public.contact_custom_values FOR ALL USING (auth.uid() IS NOT NULL);

-- ─── インデックス ────────────────────────────────────────────────
CREATE INDEX idx_task_meta_activity    ON public.task_meta(activity_id);
CREATE INDEX idx_challenges_division   ON public.challenges(division_id);
CREATE INDEX idx_challenges_user       ON public.challenges(user_id);
CREATE INDEX idx_contact_statuses_cid  ON public.contact_statuses(contact_id);
CREATE INDEX idx_dcf_division          ON public.division_custom_fields(division_id);
CREATE INDEX idx_ccv_contact           ON public.contact_custom_values(contact_id);

-- ─── 事業部別デフォルトカスタムフィールド（シードデータ） ──────────
INSERT INTO public.division_custom_fields (division_id, name, label, field_type, options, sort_order) VALUES
  -- ITソリューション
  ('00000000-0000-0000-0000-000000000001','project_type',   '案件区分',         'select', ARRAY['人だし','案件','両方'],                                   0),
  ('00000000-0000-0000-0000-000000000001','client_type',    'クライアント区分', 'select', ARRAY['ベンダー','エンドユーザー','ソフトハウス','受託会社'],    1),
  ('00000000-0000-0000-0000-000000000001','tech_type',      '技術区分',         'select', ARRAY['インフラ','開発','両方'],                                  2),
  ('00000000-0000-0000-0000-000000000001','employee_count', '社員数',           'number', NULL,                                                            3),
  ('00000000-0000-0000-0000-000000000001','unit_price',     '単価目安（万円）', 'number', NULL,                                                            4),
  ('00000000-0000-0000-0000-000000000001','it_memo',        '備考',             'text',   NULL,                                                            5),
  -- Bowers
  ('00000000-0000-0000-0000-000000000004','industry',       '業種',             'select', ARRAY['IT','製造','医療','流通','サービス','その他'],             0),
  ('00000000-0000-0000-0000-000000000004','revenue_size',   '売上規模',         'select', ARRAY['〜1億','1〜10億','10〜50億','50億〜'],                     1),
  ('00000000-0000-0000-0000-000000000004','challenge_type', '課題（大枠）',     'select', ARRAY['コスト削減','業務効率化','採用難','DX推進','売上拡大','その他'], 2),
  ('00000000-0000-0000-0000-000000000004','challenge_memo', '課題（詳細）',     'text',   NULL,                                                            3),
  ('00000000-0000-0000-0000-000000000004','strength_type',  '強み（大枠）',     'select', ARRAY['技術力','営業力','ブランド','価格競争力','人材','その他'], 4),
  ('00000000-0000-0000-0000-000000000004','strength_memo',  '強み（詳細）',     'text',   NULL,                                                            5);
