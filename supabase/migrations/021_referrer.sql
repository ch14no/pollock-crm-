-- ============================================================
-- 021: 紹介者欄（M&A事業部要望④）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- 方針（M&A事業部・東さん回答に基づく）:
--   紹介者は社内/社外を区別する。社外の場合は新規に情報を登録する運用ではなく、
--   既に顧客登録（contacts）されている担当者情報にそのまま紐づける（外部キー参照）。
--   氏名テキストのコピーにすると担当者情報の更新時に不整合が生じるため、必ず参照で持つ。
--   社内は氏名＋所属部署/会社で足りるため、既存の users/user_divisions を参照すれば済み、
--   追加カラムは不要。
--
--   全事業部で有用な普遍概念のため、M&A固有のカラムにせずcontacts/deals両方に汎用追加する。
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN referrer_type       VARCHAR(20) CHECK (referrer_type IN ('internal', 'external')),
  ADD COLUMN referrer_user_id    UUID REFERENCES public.users(id)    ON DELETE SET NULL,
  ADD COLUMN referrer_contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_referrer_consistency CHECK (
    (referrer_type IS NULL     AND referrer_user_id IS NULL     AND referrer_contact_id IS NULL) OR
    (referrer_type = 'internal' AND referrer_user_id IS NOT NULL AND referrer_contact_id IS NULL) OR
    (referrer_type = 'external' AND referrer_contact_id IS NOT NULL AND referrer_user_id IS NULL)
  );

ALTER TABLE public.deals
  ADD COLUMN referrer_type       VARCHAR(20) CHECK (referrer_type IN ('internal', 'external')),
  ADD COLUMN referrer_user_id    UUID REFERENCES public.users(id)    ON DELETE SET NULL,
  ADD COLUMN referrer_contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_referrer_consistency CHECK (
    (referrer_type IS NULL     AND referrer_user_id IS NULL     AND referrer_contact_id IS NULL) OR
    (referrer_type = 'internal' AND referrer_user_id IS NOT NULL AND referrer_contact_id IS NULL) OR
    (referrer_type = 'external' AND referrer_contact_id IS NOT NULL AND referrer_user_id IS NULL)
  );

CREATE INDEX idx_contacts_referrer_user    ON public.contacts(referrer_user_id);
CREATE INDEX idx_contacts_referrer_contact ON public.contacts(referrer_contact_id);
CREATE INDEX idx_deals_referrer_user       ON public.deals(referrer_user_id);
CREATE INDEX idx_deals_referrer_contact    ON public.deals(referrer_contact_id);

-- RLS: 既存の contacts_select / deals_select（自事業部＋super_admin）にそのまま準拠する。
-- 紹介者として参照される側（contacts/users）の閲覧可否は参照先自身の既存ポリシーで
-- 担保されるため、追加ポリシーは不要。
