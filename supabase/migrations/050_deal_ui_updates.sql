-- ============================================================
-- 050: 商談画面の改善（M&A事業部・酒田さん依頼 追加分）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- (A) 対応期日の「対応済み」チェック状態
--     現行は due_date が空になると deal_milestones の行自体を削除する設計だったが、
--     「対応済みかどうか」を日付と独立に持ちたいという依頼のため、
--     completed_at（NULL=未対応）を追加し、due_date/completed_atのどちらか
--     一方でも値があれば行を残すよう upsertDealMilestone 側のロジックを変更する。
--
-- (B) 事業部ごとの「商談」呼称カスタマイズ
--     「商談」を「案件」に変更してほしいという依頼だが、activitiesと同じく
--     全事業部共有のUI文言のため全社一律で変えると他事業部の用語が変わってしまう。
--     divisions.deal_term を追加し、事業部ごとに呼称を上書きできるようにする
--     （未設定の事業部は既定値'商談'のまま）。M&A事業部のみ'案件'にシード。
--
-- (C) 希望譲渡対価の数値化
--     現行の desired_price は自由記述TEXT列（「持分価額3.4億円（手取り2.5億）」等の
--     補足説明つき文字列も保存可能）。数値+千円単位の入力に変更してほしいという
--     依頼のため、新しい数値列 desired_price_thousand_yen を追加する。
--     既存データを破壊しないよう desired_price 列自体は残し、今後は読み取り専用の
--     参考表示にのみ使う（過去の登録内容を消さないための配慮）。
-- ============================================================

-- (A)
ALTER TABLE public.deal_milestones
  ADD COLUMN completed_at TIMESTAMPTZ; -- NULL=未対応。対応済みチェックを入れた日時

-- (B)
ALTER TABLE public.divisions
  ADD COLUMN deal_term VARCHAR(20) NOT NULL DEFAULT '商談';

UPDATE public.divisions SET deal_term = '案件' WHERE name = 'M＆A事業部';

-- (C)
ALTER TABLE public.deal_seller_conditions
  ADD COLUMN desired_price_thousand_yen NUMERIC; -- 希望譲渡対価（千円単位）
