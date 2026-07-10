-- ============================================================
-- 016: M&A事業部の顧客に「売主/買主」区分を追加（M&A事業部要望①の顧客台帳側・第1段）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- 実現方法:
--   既存の事業部別カスタムフィールド機構（division_custom_fields）に
--   select型「売主/買主」を追加するだけで、
--   - 顧客詳細画面での表示・編集
--   - 顧客一覧のカスタムフィールド絞り込み
--   が既存機能としてそのまま使える（コード変更なし）。
--
--   「画面を完全に分けたい」という要望に発展した場合は、この区分値を
--   使った専用ビューを次段で実装する。
-- ============================================================

INSERT INTO public.division_custom_fields (division_id, name, label, field_type, options, sort_order)
SELECT d.id, 'seller_buyer', '売主/買主', 'select', ARRAY['売主', '買主', '両方'], 0
FROM public.divisions d
WHERE d.name = 'M＆A事業部'
ON CONFLICT (division_id, name) DO NOTHING;
