'use client'

import { useEffect } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { BottomNav } from '@/components/layout/BottomNav'
import { TossupModal } from '@/components/tossup/TossupModal'
import { ActivityModal } from '@/components/activities/ActivityModal'
import { DealModal } from '@/components/deals/DealModal'
import { useAppStore } from '@/store/appStore'
import { getSupabase } from '@/lib/db/client'
import { fetchDivisions, fetchUserDivisions } from '@/lib/db/divisions'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { setDivisions, setCurrentUser, setUserOwnDivisions, initialized } = useAppStore()

  useEffect(() => {
    useAppStore.persist.rehydrate()

    const supabase = getSupabase()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
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
        setUserOwnDivisions(divisions.map((d) => d.id))
      } else {
        setUserOwnDivisions(userDivs.map((d) => d.divisionId))
      }
    })
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
