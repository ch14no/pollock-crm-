-- ============================================================
-- 一回限りのseed: M&A事業部のパイプラインタブ＋ステージ
-- ============================================================
-- 人間によるレビュー必須。M&A事業部は現時点でpipeline_stagesが0件・
-- dealsも0件のため、既存データとの衝突リスクはない。
--
-- 確認済みの仕様:
-- - 「クロージング」は受注（is_won=true）として扱う（🎉表示になる）
-- - 両タブの末尾に実在する「失注」ステージ（is_lost=true）を追加
--   （失注ステージが無いとKanban/DealModalの失注処理が壊れるため必須）
--
-- 前提: 007_pipeline_tabs.sql が適用済みであること（pipeline_tabsテーブル・
-- pipeline_stages.tab_idカラムが存在すること）。
-- ============================================================

DO $$
DECLARE
  ma_id UUID;
  seller_tab_id UUID;
  buyer_tab_id UUID;
BEGIN
  SELECT id INTO ma_id FROM public.divisions WHERE name = 'M＆A事業部';
  IF ma_id IS NULL THEN
    RAISE EXCEPTION 'M＆A事業部が見つかりません。divisions.nameを確認してください。';
  END IF;

  INSERT INTO public.pipeline_tabs (division_id, name, sort_order)
  VALUES (ma_id, '売主', 0)
  RETURNING id INTO seller_tab_id;

  INSERT INTO public.pipeline_tabs (division_id, name, sort_order)
  VALUES (ma_id, '買主', 1)
  RETURNING id INTO buyer_tab_id;

  INSERT INTO public.pipeline_stages (division_id, tab_id, name, sort_order, is_won, is_lost) VALUES
    (ma_id, seller_tab_id, '初回面談',                       0, false, false),
    (ma_id, seller_tab_id, 'NDA：法務確認中',                1, false, false),
    (ma_id, seller_tab_id, 'NDA：押印対応中',                2, false, false),
    (ma_id, seller_tab_id, 'NDA：押印完了',                  3, false, false),
    (ma_id, seller_tab_id, '株価診断：各種資料の受領完了',   4, false, false),
    (ma_id, seller_tab_id, '株価診断：株価診断資料の作成中', 5, false, false),
    (ma_id, seller_tab_id, '株価診断：株価診断報告の完了',   6, false, false),
    (ma_id, seller_tab_id, 'AD契：法務確認中',               7, false, false),
    (ma_id, seller_tab_id, 'AD契：押印対応中',               8, false, false),
    (ma_id, seller_tab_id, 'AD契：押印完了',                 9, false, false),
    (ma_id, seller_tab_id, 'IM／NNS：仕掛の作成完了',       10, false, false),
    (ma_id, seller_tab_id, 'IM／NNS：売主確認完了',         11, false, false),
    (ma_id, seller_tab_id, 'IM／NNS：最終版の作成完了',     12, false, false),
    (ma_id, seller_tab_id, 'トップ面談',                    13, false, false),
    (ma_id, seller_tab_id, '基本合意',                      14, false, false),
    (ma_id, seller_tab_id, 'DD',                            15, false, false),
    (ma_id, seller_tab_id, '最終合意',                      16, false, false),
    (ma_id, seller_tab_id, 'クロージング',                  17, true,  false),
    (ma_id, seller_tab_id, '失注',                          18, false, true);

  INSERT INTO public.pipeline_stages (division_id, tab_id, name, sort_order, is_won, is_lost) VALUES
    (ma_id, buyer_tab_id, '初回面談',            0, false, false),
    (ma_id, buyer_tab_id, 'NDA：法務確認中',     1, false, false),
    (ma_id, buyer_tab_id, 'NDA：押印対応中',     2, false, false),
    (ma_id, buyer_tab_id, 'NDA：押印完了',       3, false, false),
    (ma_id, buyer_tab_id, 'NNS送付',             4, false, false),
    (ma_id, buyer_tab_id, 'IM送付',              5, false, false),
    (ma_id, buyer_tab_id, '買手面談',            6, false, false),
    (ma_id, buyer_tab_id, 'AD契：法務確認中',    7, false, false),
    (ma_id, buyer_tab_id, 'AD契：押印対応中',    8, false, false),
    (ma_id, buyer_tab_id, 'AD契：押印完了',      9, false, false),
    (ma_id, buyer_tab_id, 'トップ面談',         10, false, false),
    (ma_id, buyer_tab_id, '基本合意',           11, false, false),
    (ma_id, buyer_tab_id, 'DD',                 12, false, false),
    (ma_id, buyer_tab_id, '最終合意',           13, false, false),
    (ma_id, buyer_tab_id, 'クロージング',       14, true,  false),
    (ma_id, buyer_tab_id, '失注',               15, false, true);
END $$;
