-- ============================================================
-- 033: タスクカンバンの列・並び順をDBのタイムスタンプで再同期できるようにする
-- ============================================================
-- 背景（2026-07-24・実際の不具合報告を受けて）:
--   タスクの列・並び順（taskStageMap/taskOrderMap）はブラウザのlocalStorageに
--   永続化され、DBからの反映は「ローカルに値が無いときだけ」行われる設計
--   だった（無いと自分の直近の操作が古いDB読み取りで上書きされてしまうため）。
--   この結果、一度でもローカルに値が記録されたタスクは、それ以降DBの内容が
--   誰かによって変更されても、そのブラウザでは二度と反映されない
--   （本人がそのカードを一度ドラッグするかブラウザのデータをクリアするまで直らない）
--   という弱点があった。
--
--   本マイグレーションでtask_metaにupdated_atを追加し、フロント側は
--   「DBのupdated_atが、ローカルに最後に反映した時点のものより新しければ
--   DBの値を採用する」という比較に切り替える（アプリ側の対応と対）。
--   これにより、リロードすれば必ず最新のDB状態に揃うようになる
--   （同一セッション内で自分が今まさに操作した直後の変更が、たまたま同時に
--   走った古い再取得で巻き戻されることだけは引き続き防ぐ）。
-- ============================================================

ALTER TABLE public.task_meta ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS task_meta_updated_at ON public.task_meta;
CREATE TRIGGER task_meta_updated_at BEFORE UPDATE ON public.task_meta
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
