-- ============================================================
-- 015: 商談ステージ変更の自動アクティビティ記録（M&A事業部要望⑨の第1段）
--
-- ※ このマイグレーションは自動適用されません。
--    Supabaseダッシュボードの SQL Editor で人間がレビューの上、手動実行してください。
--
-- 背景:
--   これまで商談のステージ変更（カンバンのドラッグ&ドロップ・編集モーダル）は
--   activities に一切記録されず、進捗履歴が手動記録頼みだった。
--   DBトリガーで記録することで、更新経路（カンバン/モーダル/将来のAPI）を問わず
--   一元的に履歴が残る。活動履歴ページ・タイムラインにそのまま表示される。
--
-- 仕様:
--   - stage_id が実際に変わったUPDATEのみ記録（他フィールドの更新では記録しない）
--   - 操作者は auth.uid()。サービスロール等で操作者不明の場合は記録しない
--   - ステージ名は pipeline_stages から解決し、見つからなければ生の値を使う
--     （フォールバック時代の日本語ステージ名にも対応）
-- ============================================================

CREATE OR REPLACE FUNCTION public.log_deal_stage_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  old_name TEXT;
  new_name TEXT;
  actor UUID;
BEGIN
  IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  actor := auth.uid();
  IF actor IS NULL THEN
    RETURN NEW; -- 操作者不明（サービスロール・バッチ等）は記録しない
  END IF;

  SELECT name INTO old_name FROM public.pipeline_stages WHERE id::text = OLD.stage_id;
  SELECT name INTO new_name FROM public.pipeline_stages WHERE id::text = NEW.stage_id;

  INSERT INTO public.activities (target_type, target_id, user_id, activity_type, title, memo, status, action_date)
  VALUES (
    'deal',
    NEW.id,
    actor,
    'note',
    'ステージ変更: ' || NEW.title,
    COALESCE(old_name, OLD.stage_id) || ' → ' || COALESCE(new_name, NEW.stage_id),
    'done',
    NOW()
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS log_deal_stage_change ON public.deals;
CREATE TRIGGER log_deal_stage_change
  AFTER UPDATE OF stage_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.log_deal_stage_change();
