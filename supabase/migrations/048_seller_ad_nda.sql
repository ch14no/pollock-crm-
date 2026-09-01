-- ============================================================
-- 048: AD契・NDA締結管理（M&A事業部・酒田さん依頼 フェーズ3）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--    **フロントのpushより先に適用すること**（未適用のまま新コードが動くと
--    売主条件の保存が列不存在エラーになる）。
--
-- 「締結可否」は「締結済みかどうか」の意味で確定（2026-09-01酒田さん回答。
-- IM送付可否の判断材料のため、未定/締結予定等の細かい状態管理は不要とのこと）。
-- 023の loss_deficit_ok と同型（可/否、NULL=未確認）のままで要件を満たす。
-- 売り案件の顧客情報エリアに表示する項目のため、1商談1行の
-- deal_seller_conditions への列追加とする（新テーブルは作らない）。
-- ============================================================

ALTER TABLE public.deal_seller_conditions
  ADD COLUMN ad_contract_status VARCHAR(10) CHECK (ad_contract_status IN ('可', '否')), -- AD契 締結可否（NULL=未確認）
  ADD COLUMN ad_contract_date   DATE,                                                   -- AD契 締結日
  ADD COLUMN nda_status         VARCHAR(10) CHECK (nda_status IN ('可', '否')),         -- NDA 締結可否（NULL=未確認）
  ADD COLUMN nda_date           DATE;                                                   -- NDA 締結日
