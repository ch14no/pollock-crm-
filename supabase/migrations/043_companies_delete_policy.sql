-- ============================================================
-- 043: companiesテーブルにDELETEポリシーが存在しなかったため追加
-- ============================================================
-- 2026-08-25報告「顧客ページで削除ができるようにしてほしい」を受けて
-- 個人（担当者）詳細ページに削除ボタンを追加したが、会社詳細ページ
-- （contacts/company/[id]）には元々削除機能自体が存在しなかった。
--
-- companiesは事業部を持たない全社共有マスタ（companies_updateはログイン済み
-- 全ユーザーに開放済み・019適用）。削除は更新より影響が大きい（他事業部からも
-- 見えなくなる）ため、更新より一段厳しくmanager/super_adminに限定する。
-- 事業部を持たないテーブルのため「同一事業部のmanager」という絞り込みは
-- 適用できず、managerロールであれば所属事業部を問わず削除可能とする。
--
-- contacts.company_id / tossups.company_id は ON DELETE SET NULL のため、
-- 会社を削除しても紐づく担当者・トスアップ自体は消えず「会社未設定」に
-- なるだけで、意図しないデータ消失は起きない。
-- ============================================================

CREATE POLICY "companies_delete" ON public.companies FOR DELETE USING (
  (SELECT role FROM public.users WHERE id = auth.uid()) IN ('super_admin', 'manager')
);
