-- ============================================================
-- 041: contacts_delete が事業部を跨いで削除可能だった不具合を修正
-- ============================================================
-- 2026-08-21のエラーハンドリング横展開監査で発見。001の初期スキーマ以来、
-- contacts_delete は role IN ('super_admin','manager') のみを条件にしており、
-- contacts_select/update/insert が全て division_id を所属事業部に限定しているのに
-- 対して、DELETEだけ事業部チェックが無かった。他事業部のmanagerが自分の
-- 所属外の顧客を削除できてしまう状態だった（今回040でdeals_deleteを新設した際の
-- 権限モデル・025/037/039のtask_kanban系ポリシーとも不一致）。
--
-- 権限モデルをこのプロジェクトで確立済みのパターンに揃える:
-- super_admin（所属不問）OR 当該事業部所属のmanager。
-- ============================================================

DROP POLICY IF EXISTS "contacts_delete" ON public.contacts;
CREATE POLICY "contacts_delete" ON public.contacts FOR DELETE USING (
  (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  OR (
    division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
  )
);
