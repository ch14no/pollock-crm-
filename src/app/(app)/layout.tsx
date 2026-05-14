'use client'

import { useEffect } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { BottomNav } from '@/components/layout/BottomNav'
import { TossupModal } from '@/components/tossup/TossupModal'
import { ActivityModal } from '@/components/activities/ActivityModal'
import { DealModal } from '@/components/deals/DealModal'
import { useAppStore } from '@/store/appStore'
import { MOCK_DIVISIONS, MOCK_USER, MOCK_ALL_DEMO_USERS, MOCK_USER_DIVISIONS } from '@/lib/mock-data'
import { isSupabaseConfigured, getSupabase } from '@/lib/db/client'
import { fetchDivisions, fetchUserDivisions } from '@/lib/db/divisions'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { setDivisions, setCurrentUser, setUserOwnDivisions, initialized } = useAppStore()

  useEffect(() => {
    useAppStore.persist.rehydrate()

    if (isSupabaseConfigured()) {
      // ── Supabase モード ──────────────────────────────────────────
      const supabase = getSupabase()
      supabase.auth.getUser().then(async ({ data: { user } }) => {
        if (!user) return

        // ユーザープロフィール取得
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

        // 事業部一覧取得
        const divisions = await fetchDivisions()
        setDivisions(divisions)

        // 所属事業部取得
        const userDivs = await fetchUserDivisions(user.id)
        if (profile?.role === 'super_admin') {
          setUserOwnDivisions(divisions.map((d) => d.id))
        } else {
          setUserOwnDivisions(userDivs.map((d) => d.divisionId))
        }
      })
    } else {
      // ── デモモード（mock data）────────────────────────────────────
      setDivisions(MOCK_DIVISIONS)

      const state = useAppStore.getState()
      const demoUserId = state.activeDemoUserId
      const mockUser = MOCK_ALL_DEMO_USERS.find((u) => u.id === demoUserId) ?? MOCK_USER

      const stored = state.currentUser
      if (!stored || stored.id !== mockUser.id) {
        setCurrentUser(mockUser)
      }

      const user = stored?.id === mockUser.id ? stored : mockUser
      if (user.role === 'super_admin') {
        setUserOwnDivisions(MOCK_DIVISIONS.map((d) => d.id))
      } else {
        const adminUser = state.adminUsers.find((u) => u.id === user.id)
        if (adminUser) {
          setUserOwnDivisions(adminUser.divisionIds)
        } else {
          const ownIds = MOCK_USER_DIVISIONS
            .filter((ud: { user_id: string; division_id: string }) => ud.user_id === user.id)
            .map((ud: { user_id: string; division_id: string }) => ud.division_id)
          setUserOwnDivisions(ownIds)
        }
      }
    }
  }, [setDivisions, setCurrentUser, setUserOwnDivisions])

  return (
    <div className="min-h-screen bg-gray-50">
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
