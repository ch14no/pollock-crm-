-- ============================================================
-- 052: 顧客の「接触経路（詳細）」を人物へ紐づけ可能に＋タスク管理のM&A事業部呼称変更
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- ① 接触経路（詳細）の人物紐づけ:
--   051でdivision_custom_fields（text型・name='encounter_source'）として追加した
--   自由記述欄を、021の「紹介者」欄と全く同型の専用列に置き換える。
--   紹介者と異なりM&A事業部固有の概念（依頼文言も「接触経路の詳細」というM&A文脈）
--   のため、汎用カスタムフィールド機構の拡張ではなくcontacts専用列として追加する
--   （汎用化すると contact_custom_values.value という単一TEXT列の前提が壊れ、
--   影響範囲が全事業部の既存カスタムフィールドに及ぶため）。
--   旧encounter_sourceの自由記述データはdivision_custom_fields/contact_custom_values に
--   残したまま削除しない（アプリ側で「（旧データ）」として読み取り専用表示する）。
--
-- ② タスク管理のM&A事業部限定呼称変更:
--   050のdeal_term（商談→案件）と同型のパターン。
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN source_type       VARCHAR(20) CHECK (source_type IN ('internal', 'external')),
  ADD COLUMN source_user_id    UUID REFERENCES public.users(id)    ON DELETE SET NULL,
  ADD COLUMN source_contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_source_consistency CHECK (
    (source_type IS NULL      AND source_user_id IS NULL     AND source_contact_id IS NULL) OR
    (source_type = 'internal' AND source_user_id IS NOT NULL AND source_contact_id IS NULL) OR
    (source_type = 'external' AND source_contact_id IS NOT NULL AND source_user_id IS NULL)
  );

CREATE INDEX idx_contacts_source_user    ON public.contacts(source_user_id);
CREATE INDEX idx_contacts_source_contact ON public.contacts(source_contact_id);

-- RLS: 021の紹介者欄と同じ理由で追加ポリシー不要（既存のcontacts_select/contacts_updateに準拠）。

ALTER TABLE public.divisions
  ADD COLUMN task_term VARCHAR(20) NOT NULL DEFAULT 'タスク管理';

UPDATE public.divisions SET task_term = 'IM管理' WHERE name = 'M＆A事業部';
