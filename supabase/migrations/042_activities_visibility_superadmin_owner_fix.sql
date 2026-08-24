-- ============================================================
-- 042: super_adminが記録した活動が同僚から見えない不具合を修正
-- ============================================================
-- 背景（2026-08-24報告）:
--   石川紅さん（一般ユーザー、財務支援事業部）の顧客詳細画面で、
--   齋藤香奈さん（super_admin）が記録した活動履歴（8件）が一切表示されず、
--   自分が記録した分（5件）しか見えていなかった。同じ顧客を齋藤さん自身の
--   画面（会社詳細ページ）で見ると全13件が見えており、表示内容の食い違いが
--   報告された。
--
-- 原因:
--   activities_select（034）は「同一事業部メンバーの活動を閲覧可」を
--   shares_division_with(user_id)（028）で判定している。この関数は
--   呼び出し元（mine）と対象（theirs＝活動の記録者）の両方が
--   user_divisions テーブルに行を持つことを前提に事業部の一致を見る。
--
--   しかし本プロジェクトの既存の設計判断（2026-07-23の教訓、
--   pollock-crmメモリ参照）により、super_adminはRLSのrole分岐で
--   全データにアクセスできるため、user_divisionsへの所属登録が
--   「タスク看板の担当候補として表示するかどうか」のopt-inとしてのみ
--   使われ、必須ではない。そのため多くのsuper_adminアカウントは
--   user_divisionsに1行も持たない。
--
--   活動の記録者（activities.user_id）がこのようなuser_divisions無し
--   のsuper_adminだった場合、shares_division_with(user_id)は
--   「theirs側が見つからない」ため常にFALSEを返す。閲覧者側の
--   ロールチェック（(SELECT role...) = 'super_admin'）は閲覧者自身が
--   super_adminの場合しか救わないため、一般ユーザーがsuper_adminの
--   活動を閲覧しようとすると全ての分岐がFALSEになり拒否される。
--
--   034で未担当タスク（user_id IS NULL）向けに導入した
--   shares_division_with_activity_target（活動の対象＝contact/dealの
--   division_idで判定、記録者のuser_divisionsに依存しない）を、
--   user_id が非NULLのケースにも無条件のOR分岐として追加し、
--   「対象（顧客/商談）が自分の事業部のものであれば、誰が記録した
--   活動でも閲覧・編集できる」という、業務実態に即した判定に統一する。
-- ============================================================

DROP POLICY IF EXISTS "activities_select" ON public.activities;
CREATE POLICY "activities_select" ON public.activities
  FOR SELECT USING (
    user_id = auth.uid()
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (user_id IS NOT NULL AND public.shares_division_with(user_id))
    OR public.shares_division_with_activity_target(target_type, target_id)
  );

-- activities_update も同じ理由で同期させる（見えるのに編集できない、という
-- 次の紛らわしい不具合を防ぐ）
DROP POLICY IF EXISTS "activities_update" ON public.activities;
CREATE POLICY "activities_update" ON public.activities
  FOR UPDATE USING (
    user_id = auth.uid()
    OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
    OR (user_id IS NOT NULL AND public.shares_division_with(user_id))
    OR public.shares_division_with_activity_target(target_type, target_id)
  );

-- task_meta_select/update（タスクカンバンの列・並び順）も同じ判定式を使っているため揃える
DROP POLICY IF EXISTS "task_meta_select" ON public.task_meta;
CREATE POLICY "task_meta_select" ON public.task_meta
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.id = task_meta.activity_id
        AND (
          a.user_id = auth.uid()
          OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
          OR (a.user_id IS NOT NULL AND public.shares_division_with(a.user_id))
          OR public.shares_division_with_activity_target(a.target_type, a.target_id)
        )
    )
  );

DROP POLICY IF EXISTS "task_meta_update" ON public.task_meta;
CREATE POLICY "task_meta_update" ON public.task_meta
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.id = task_meta.activity_id
        AND (
          a.user_id = auth.uid()
          OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
          OR (a.user_id IS NOT NULL AND public.shares_division_with(a.user_id))
          OR public.shares_division_with_activity_target(a.target_type, a.target_id)
        )
    )
  );

-- activities_delete（026/034）はあえて変更しない。deleteは「本人 or
-- manager（同事業部の二重結合判定、既知の欠陥あり・026のコメント参照）or
-- 未担当ならshares_division_with_activity_target」のままとし、
-- 一般ユーザーが他人（super_admin含む）の活動を削除できる範囲を
-- 無条件には広げない（閲覧・編集と削除は誤操作の重大性が異なるため、
-- 今回の報告＝閲覧不可の解消に必要な範囲に留める）。
