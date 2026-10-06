-- ============================================================
-- 059: TSRソーシングリスト 既定権限で付いてしまった不要な表権限を剥がす
--
-- このプロジェクトの ALTER DEFAULT PRIVILEGES（postgres ロール）は、新しい表に対して
-- anon / authenticated / service_role へ TRUNCATE・REFERENCES・TRIGGER・MAINTAIN を自動付与する
-- 設定になっている（2026-10-06 に information_schema.table_privileges で確認）。
-- RLS は TRUNCATE を止められないため、TSR の各表について anon は全権限を、authenticated は
-- 必要な権限以外を剥がし、必要なものだけを明示的に付け直す（053/058 の GRANT と同じ内容）。
--
-- ※ 他の既存テーブルにも同じ既定権限が付いている可能性がある（本マイグレーションの対象外。
--    PostgREST は TRUNCATE を発行しないため API 経由では悪用できないが、別途棚卸し推奨）。
-- ============================================================

-- anon は TSR の表・ビューに一切触れない
REVOKE ALL ON public.tsr_prospects, public.tsr_prospect_personal, public.tsr_priority_settings,
              public.tsr_prospect_view_logs, public.tsr_import_logs, public.tsr_prospects_view,
              public.tsr_industry_options FROM anon;

-- authenticated は一度すべて外してから必要な権限だけ付け直す
REVOKE ALL ON public.tsr_prospects, public.tsr_prospect_personal, public.tsr_priority_settings,
              public.tsr_prospect_view_logs, public.tsr_import_logs, public.tsr_prospects_view,
              public.tsr_industry_options FROM authenticated;

GRANT SELECT ON public.tsr_prospects TO authenticated;
GRANT UPDATE (approach_type, owner_user_id, last_contact_on, status, memo, company_id)
  ON public.tsr_prospects TO authenticated;
GRANT SELECT                 ON public.tsr_prospect_personal  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tsr_priority_settings  TO authenticated;
GRANT SELECT, INSERT         ON public.tsr_prospect_view_logs TO authenticated;
GRANT SELECT                 ON public.tsr_import_logs        TO authenticated;
GRANT SELECT                 ON public.tsr_prospects_view     TO authenticated;
GRANT SELECT                 ON public.tsr_industry_options   TO authenticated;

-- service_role（サーバー側の管理キー）は参照のみに整理
REVOKE ALL ON public.tsr_prospects, public.tsr_prospect_personal, public.tsr_priority_settings,
              public.tsr_prospect_view_logs, public.tsr_import_logs, public.tsr_prospects_view,
              public.tsr_industry_options FROM service_role;
GRANT SELECT ON public.tsr_prospects, public.tsr_prospect_personal, public.tsr_priority_settings,
                public.tsr_prospect_view_logs, public.tsr_import_logs, public.tsr_prospects_view,
                public.tsr_industry_options TO service_role;
