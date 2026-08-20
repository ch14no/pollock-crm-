-- 財務支援事業部（division_id=00000000-0000-0000-0000-000000000003）の
-- ステージ設定ミス修正＋旧ステージ値のまま残っている商談の正規化
--
-- 背景: 以前のステージ再編（リード/初回面談/提案中/クロージング/受注/失注 →
-- 資料作成中/共有中/申請中（審査中）/採択/不採択）で is_won/is_lost フラグが
-- 誤って旧デフォルトの位置（先頭=is_won）に残っており、かつ既存商談の
-- stage_id が新ステージIDへ移行されていなかった。

-- ① ステージのis_won/is_lostフラグを修正
UPDATE public.pipeline_stages SET is_won = false
  WHERE division_id = '00000000-0000-0000-0000-000000000003' AND name = '資料作成中';
UPDATE public.pipeline_stages SET is_won = true
  WHERE division_id = '00000000-0000-0000-0000-000000000003' AND name = '採択';
UPDATE public.pipeline_stages SET is_lost = true
  WHERE division_id = '00000000-0000-0000-0000-000000000003' AND name = '不採択';

-- ② 旧stage_id（文字列）のまま残っている商談を現行ステージへ正規化
--    リード・初回面談 → 資料作成中／受注 → 採択／失注 → 不採択
UPDATE public.deals SET stage_id = (
  SELECT id FROM public.pipeline_stages
  WHERE division_id = '00000000-0000-0000-0000-000000000003' AND name = '資料作成中'
) WHERE division_id = '00000000-0000-0000-0000-000000000003' AND stage_id IN ('リード', '初回面談');

UPDATE public.deals SET stage_id = (
  SELECT id FROM public.pipeline_stages
  WHERE division_id = '00000000-0000-0000-0000-000000000003' AND name = '採択'
) WHERE division_id = '00000000-0000-0000-0000-000000000003' AND stage_id = '受注';

UPDATE public.deals SET stage_id = (
  SELECT id FROM public.pipeline_stages
  WHERE division_id = '00000000-0000-0000-0000-000000000003' AND name = '不採択'
) WHERE division_id = '00000000-0000-0000-0000-000000000003' AND stage_id = '失注';
