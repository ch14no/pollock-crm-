-- ============================================================
-- 051: M&A事業部の顧客に7項目のカスタム属性を追加（酒田さんからの追加依頼）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- 実現方法:
--   016（売主/買主フィールド追加）と全く同型。既存の事業部別カスタムフィールド機構
--   （division_custom_fields）にselect/text型のフィールドを追加するだけで、
--   - 顧客詳細画面での表示・編集
--   - 顧客一覧のカスタムフィールド絞り込み（都道府県・状態と並んで自動的に表示される）
--   が既存機能としてそのまま使える（コード変更なし）。M&A事業部限定のため
--   他事業部の顧客一覧・フィルターには一切影響しない。
--
--   あわせて、DivisionFieldsPanel（このフィールドの追加・編集・削除・並び替えを行う
--   設定画面）をマネージャー設定ブロックにも配置する対応をコード側で行った
--   （dcf_manage RLSはsuper_admin/managerの両方を許可しているが、UIがsuper_admin
--   専用ブロックの中にしかなくmanagerが到達できていなかった。DivisionStagesPanel等で
--   繰り返し発生している既知パターンの再発のため同時に解消）。
--   これにより今後は酒田さん自身が設定画面から項目を追加・編集できる。
-- ============================================================

INSERT INTO public.division_custom_fields (division_id, name, label, field_type, options, sort_order)
SELECT d.id, f.name, f.label, f.field_type, f.options, f.sort_order
FROM public.divisions d
CROSS JOIN (
  VALUES
    ('contact_category', '接点区分', 'select',
      ARRAY['売り手候補', '買い手候補', '紹介者', 'その他'], 1),
    ('seller_persona', '売り手ペルソナ', 'select',
      ARRAY['A：成長の壁型', 'B：疲れ・自由型', 'C：事業承継型', 'D：売却検討型', '不明'], 2),
    ('ma_temperature', 'M&A温度感', 'select',
      ARRAY['高', '中', '低', '不明'], 3),
    ('relationship_level', '関係性', 'select',
      ARRAY['親しい', '面識あり', '紹介', '初接点'], 4),
    ('contact_method', '連絡手段', 'select',
      ARRAY['LINE', 'Messenger', '電話', 'メール', 'Slack', '名刺のみ', 'Instagram', 'その他'], 5),
    ('encounter_channel', '出会い経路', 'select',
      ARRAY['紹介', 'コミュニティ', 'イベント・交流会', '取引先・仕事', '友人・知人', 'SNS', 'アウトバウンド', 'その他'], 6),
    ('encounter_source', '出会い元', 'text',
      NULL, 7)
) AS f(name, label, field_type, options, sort_order)
WHERE d.name = 'M＆A事業部'
ON CONFLICT (division_id, name) DO NOTHING;
