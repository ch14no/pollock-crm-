-- ============================================================
-- 056: TSRソーシングリスト 短い検索語（1〜2文字）の前方一致用の列（055の続き）
--
-- 本番の実行計画（2026-10-06）で、「穴吹」「建設」のような2文字の部分一致が trgm
-- インデックスを使えず全件走査（10〜20秒）になっていることが判明した。pg_trgm は
-- 検索語から3文字の塊（トライグラム）を取り出して索引を引くため、2文字以下の語では
-- 原理的にインデックスが使えない。
--
-- 対策: 2文字以下の検索語は「法人格（株式会社・（株）等）を取り除いた商号」の前方一致に
-- 切り替える。「穴吹」→「穴吹興産」「穴吹工務店」が引ける。そのための列 name_core /
-- name_kana_core（自動算出）と、前方一致に使える btree（text_pattern_ops）を用意する。
-- 3文字以上は従来どおり trgm の部分一致。使い分けはアプリ側（applyFilters）。
--
-- ※ 055 適用済みが前提。STORED 生成列の追加はテーブルの書き直しを伴うため数分かかる。
-- ============================================================

-- 法人格・法人種別の表記を先頭・末尾から取り除く（漢字・記号・カナ）
CREATE OR REPLACE FUNCTION public.tsr_name_core(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT NULLIF(btrim(regexp_replace(regexp_replace(p,
    '^\s*(株式会社|有限会社|合同会社|合資会社|合名会社|医療法人社団|医療法人財団|医療法人|社会福祉法人|社会医療法人|学校法人|宗教法人|一般社団法人|公益社団法人|一般財団法人|公益財団法人|特定非営利活動法人|ＮＰＯ法人|NPO法人|農事組合法人|企業組合|協同組合|生活協同組合|\(株\)|（株）|㈱|\(有\)|（有）|㈲|\(同\)|（同）|カブシキガイシャ|カブシキカイシャ|ユウゲンガイシャ|ユウゲンカイシャ|ゴウドウガイシャ|ゴウドウカイシャ|イリョウホウジン|シャカイフクシホウジン|ガッコウホウジン|イッパンシャダンホウジン|イッパンザイダンホウジン)\s*', ''),
    '\s*(株式会社|有限会社|合同会社|合資会社|合名会社|\(株\)|（株）|㈱|\(有\)|（有）|㈲|\(同\)|（同）|カブシキガイシャ|カブシキカイシャ|ユウゲンガイシャ|ユウゲンカイシャ|ゴウドウガイシャ|ゴウドウカイシャ)\s*$', '')), '')
$$;

ALTER TABLE public.tsr_prospects
  ADD COLUMN IF NOT EXISTS name_core      TEXT GENERATED ALWAYS AS (public.tsr_name_core(name)) STORED,
  ADD COLUMN IF NOT EXISTS name_kana_core TEXT GENERATED ALWAYS AS (public.tsr_name_core(name_kana)) STORED;

-- 前方一致（LIKE 'xx%'）に使える btree。通常の照合順序では LIKE に使えないため text_pattern_ops
CREATE INDEX IF NOT EXISTS idx_tsr_prospects_name_core_prefix
  ON public.tsr_prospects (name_core text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_tsr_prospects_name_kana_core_prefix
  ON public.tsr_prospects (name_kana_core text_pattern_ops);

-- ビューは p.* なので列は自動的に露出する（作り直し不要）
