'use client'

import { Suspense, useEffect } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { BottomNav } from '@/components/layout/BottomNav'
import { NavigationProgress } from '@/components/layout/NavigationProgress'
import { TossupModal } from '@/components/tossup/TossupModal'
import { ActivityModal } from '@/components/activities/ActivityModal'
import { DealModal } from '@/components/deals/DealModal'
import { useAppStore } from '@/store/appStore'
import { getSupabase, isSupabaseConfigured } from '@/lib/db/client'
import {
  fetchDivisions, fetchUserDivisions,
  fetchDivisionStagesMapped, fetchDivisionTabsMapped, fetchDivisionCustomFields,
  fetchDivisionTaskStagesDb,
} from '@/lib/db/divisions'
import { fetchDivisionProductsData } from '@/lib/db/products'
import { MOCK_DIVISIONS, MOCK_USER, MOCK_USER_DIVISIONS } from '@/lib/mock-data'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { setDivisions, setCurrentUser, setUserOwnDivisions, setActiveDivision, initialized } = useAppStore()
  const activeDivisionId = useAppStore((s) => s.activeDivisionId)
  const setDivisionStages = useAppStore((s) => s.setDivisionStages)
  const setDivisionTabs = useAppStore((s) => s.setDivisionTabs)
  const setDivisionCustomFields = useAppStore((s) => s.setDivisionCustomFields)
  const setDivisionProducts = useAppStore((s) => s.setDivisionProducts)
  const setDivisionProductsEnabled = useAppStore((s) => s.setDivisionProductsEnabled)
  const setDivisionTaskStages = useAppStore((s) => s.setDivisionTaskStages)

  // 閲覧中の事業部が変わるたびに、その事業部のマスタ（ステージ・タブ・カスタム項目・商品）を
  // DBからストアへ同期する。従来は設定画面を開いた端末のlocalStorageにしか入らず、
  // 他ユーザーのカンバンが古いステージ定義やフォールバック表示のままになる原因だった。
  useEffect(() => {
    if (!activeDivisionId || !isSupabaseConfigured()) return
    let cancelled = false
    const load = async () => {
      try {
        const [stages, tabs, fields, productsData, taskStages] = await Promise.all([
          fetchDivisionStagesMapped(activeDivisionId),
          fetchDivisionTabsMapped(activeDivisionId),
          fetchDivisionCustomFields(activeDivisionId),
          fetchDivisionProductsData(activeDivisionId),
          // タスクカンバン列（025）。マイグレーション未適用でも他マスタの同期を
          // 巻き込んで失敗させないよう、ここだけ個別にフォールバックする
          fetchDivisionTaskStagesDb(activeDivisionId).catch(() => null),
        ])
        if (cancelled) return
        setDivisionStages(activeDivisionId, stages)
        setDivisionTabs(activeDivisionId, tabs)
        setDivisionCustomFields(activeDivisionId, fields)
        if (productsData) {
          setDivisionProducts(activeDivisionId, productsData.products)
          setDivisionProductsEnabled(activeDivisionId, productsData.enabled)
        }
        // 行が無い事業部（未設定）はlocalStorage→デフォルトの従来フォールバックを維持
        if (taskStages && taskStages.length > 0) {
          setDivisionTaskStages(activeDivisionId, taskStages)
        }
      } catch {
        // 取得失敗時は既存のローカルキャッシュ表示を維持する（画面を壊さない）
      }
    }
    load()
    return () => { cancelled = true }
  }, [activeDivisionId, setDivisionStages, setDivisionTabs, setDivisionCustomFields, setDivisionProducts, setDivisionProductsEnabled, setDivisionTaskStages])

  useEffect(() => {
    const supabase = getSupabase()

    const run = async () => {
      // rehydrate() は同期storage実装では同期完結するが、型上はPromiseを
      // 返し得るため、以降のactiveDivisionId読み取りより確実に先に完了させる
      await Promise.resolve(useAppStore.persist.rehydrate())

      // デモモード: Supabase未接続時はモックデータで初期化する
      // （setDivisionsがinitializedを立てないと全ページがスピナーのままになる）
      if (!isSupabaseConfigured()) {
        const state = useAppStore.getState()
        if (!state.currentUser) setCurrentUser(MOCK_USER)
        setUserOwnDivisions(MOCK_USER_DIVISIONS.map((d) => d.division_id))
        setDivisions(MOCK_DIVISIONS)
        return
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profileRaw } = await supabase
        .from('users')
        .select('id, name, email, role, created_at')
        .eq('id', user.id)
        .single()

      const profile = profileRaw as { id: string; name: string; email: string; role: string; created_at: string } | null

      if (profile) {
        setCurrentUser({
          id: profile.id,
          name: profile.name,
          email: profile.email,
          role: profile.role as 'super_admin' | 'manager' | 'user',
          created_at: profile.created_at,
        })
      }

      const divisions = await fetchDivisions()
      setDivisions(divisions)

      const userDivs = await fetchUserDivisions(user.id)
      if (profile?.role === 'super_admin') {
        const ownDivisionIds = divisions.map((d) => d.id)
        setUserOwnDivisions(ownDivisionIds)

        const currentActiveId = useAppStore.getState().activeDivisionId
        const needsDefaultDivision = !currentActiveId || !ownDivisionIds.includes(currentActiveId)
        if (needsDefaultDivision) {
          const primary = userDivs.find((d) => d.isPrimary)
          const defaultId = primary?.divisionId ?? ownDivisionIds[0] ?? divisions[0]?.id
          const defaultDivision = divisions.find((d) => d.id === defaultId)
          if (defaultDivision) setActiveDivision(defaultDivision)
        }
      } else {
        const ownDivisionIds = userDivs.map((d) => d.divisionId)
        setUserOwnDivisions(ownDivisionIds)

        const currentActiveId = useAppStore.getState().activeDivisionId
        const needsDefaultDivision = !currentActiveId || !ownDivisionIds.includes(currentActiveId)
        if (needsDefaultDivision) {
          const primary = userDivs.find((d) => d.isPrimary)
          const defaultId = primary?.divisionId ?? ownDivisionIds[0] ?? divisions[0]?.id
          const defaultDivision = divisions.find((d) => d.id === defaultId)
          if (defaultDivision) setActiveDivision(defaultDivision)
        }
      }
    }

    run()
  }, [setDivisions, setCurrentUser, setUserOwnDivisions, setActiveDivision])

  return (
    <div className="min-h-screen bg-gray-50">
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <Sidebar />
      <div className="md:pl-64 flex flex-col min-h-screen">
        <Header />
        <main className="flex-1 p-4 md:p-6 pb-24 md:pb-6">
          {initialized ? children : (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </main>
      </div>
      <BottomNav />
      <TossupModal />
      <ActivityModal />
      <DealModal />
    </div>
  )
}
