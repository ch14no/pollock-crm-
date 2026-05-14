'use client'

import { useState } from 'react'
import { Search, Bell } from 'lucide-react'
import { useAppStore } from '@/store/appStore'

export function Header() {
  const [search, setSearch] = useState('')
  const { activeDivision } = useAppStore()

  return (
    <header className="hidden md:flex items-center h-16 px-6 bg-white border-b border-gray-200 sticky top-0 z-20 gap-4">
      {/* Search */}
      <div className="relative flex-1 max-w-96">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="顧客・商談を検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg
            focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent
            placeholder:text-gray-400"
        />
      </div>

      <div className="flex-1" />

      {/* Division indicator */}
      {activeDivision && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 rounded-lg">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: activeDivision.color_code ?? '#6b7280' }}
          />
          <span className="text-xs font-medium text-gray-600">{activeDivision.name}</span>
        </div>
      )}

      {/* Notifications */}
      <button className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
        <Bell size={20} />
        <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
      </button>
    </header>
  )
}
