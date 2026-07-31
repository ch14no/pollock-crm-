import { useEffect, useRef } from 'react'
import { getSupabase, isSupabaseConfigured } from '@/lib/db/client'
import { useAppStore } from '@/store/appStore'
import { fetchDivisionTaskStagesDb, fetchTaskStageVisibility } from '@/lib/db/divisions'

// タスクカンバンの列・並び順（036でRealtime対象化したtask_meta / task_kanban_stages）を
// 購読し、他ユーザーの変更を手動リロードなしで反映する。
//
// task_metaの変更は新しい経路を作らず、既存のhydrateTaskMeta（DBのupdated_atと
// ローカルの記録時刻を比較して新しい方だけ採用するマージ）にそのまま合流させる。
// これにより自分自身の操作のecho（PostgresがRealtime経由で送り返してくる自分の
// 書き込み）も「同値・同時刻」で無害にマージされ、特別なフィルタが要らない。
//
// websocket切断・イベント取りこぼしへの保険として、再接続時とタブ復帰時に
// onRefresh（pull型の再読込）を呼ぶ。Realtimeを「速報」、pull再読込を
// 「真実の回復」と位置づける。
export function useTaskRealtime(divisionId: string | null, onRefresh: () => void) {
  const hydrateTaskMeta = useAppStore((s) => s.hydrateTaskMeta)
  const setDivisionTaskStages = useAppStore((s) => s.setDivisionTaskStages)
  const setTaskStageVisibility = useAppStore((s) => s.setTaskStageVisibility)

  // onRefreshは呼び出し元（tasks/page.tsxのloadTasks）が毎レンダー新しい関数
  // 参照になりうるため、購読エフェクトの依存配列には入れずrefで最新値を参照する
  // （入れると値が変わるたびにチャンネルを張り直すことになってしまう）
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => { onRefreshRef.current = onRefresh }, [onRefresh])

  useEffect(() => {
    if (!divisionId || !isSupabaseConfigured()) return
    const supabase = getSupabase()

    const channel = supabase
      .channel(`task-kanban-${divisionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_meta' },
        (payload: { new: Record<string, unknown> | null; old: Record<string, unknown> | null }) => {
          const row = payload.new ?? payload.old
          const activityId = row?.activity_id as string | undefined
          if (!activityId) return
          hydrateTaskMeta({
            [activityId]: {
              stageId: (row?.kanban_stage_id as string | null | undefined) ?? undefined,
              sortOrder: (row?.sort_order as number | null | undefined) ?? undefined,
              updatedAt: (row?.updated_at as string | undefined) ?? new Date(0).toISOString(),
            },
          })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_kanban_stages', filter: `division_id=eq.${divisionId}` },
        () => {
          // 列自体の追加・削除・色変更・並び替え。差分反映は複雑なため単純に再取得する
          fetchDivisionTaskStagesDb(divisionId)
            .then((rows) => { if (rows.length > 0) setDivisionTaskStages(divisionId, rows) })
            .catch(() => { /* 取得失敗時は既存表示を維持（画面を壊さない） */ })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_stage_user_visibility', filter: `division_id=eq.${divisionId}` },
        () => {
          // 管理者が個人ビューの表示列allowlistを変更したときの即時反映（037のマイグレーション
          // コメントで約束している挙動）。差分反映は複雑なため単純に再取得する
          fetchTaskStageVisibility(divisionId)
            .then((vis) => setTaskStageVisibility(divisionId, vis))
            .catch(() => { /* 取得失敗時は既存表示を維持（画面を壊さない） */ })
        }
      )
      .subscribe((status: string) => {
        // 再接続時（初回接続・切断からの復帰いずれも含む）は、購読が途切れていた間の
        // イベントを取りこぼしている可能性があるため、pull型の再読込で必ず一度揃え直す
        if (status === 'SUBSCRIBED') onRefreshRef.current()
      })

    // バックグラウンドタブでのwebsocket切断・イベント取りこぼしへの保険
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') onRefreshRef.current()
    }
    const handleFocus = () => onRefreshRef.current()
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleFocus)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleFocus)
      supabase.removeChannel(channel)
    }
  }, [divisionId, hydrateTaskMeta, setDivisionTaskStages, setTaskStageVisibility])
}
