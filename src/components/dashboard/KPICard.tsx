import { cn } from '@/lib/utils'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface KPICardProps {
  label: string
  value: string | number
  unit?: string
  sublabel?: string
  trend?: number
  icon?: React.ReactNode
  highlight?: boolean
}

export function KPICard({ label, value, unit, sublabel, trend, icon, highlight }: KPICardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl p-5 border',
        highlight
          ? 'bg-gradient-to-br from-orange-50 to-white border-orange-100'
          : 'bg-white border-gray-100 shadow-sm'
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {icon && (
          <div className={cn('p-2 rounded-lg', highlight ? 'bg-orange-100' : 'bg-gray-100')}>
            <span className={highlight ? 'text-orange-600' : 'text-gray-500'}>{icon}</span>
          </div>
        )}
      </div>
      <div className="flex items-end gap-1">
        <span className="text-3xl font-black text-gray-800">{value}</span>
        {unit && <span className="text-sm text-gray-500 mb-0.5">{unit}</span>}
      </div>
      {sublabel && (
        <p className="mt-1.5 text-xs text-gray-400">{sublabel}</p>
      )}
      {trend !== undefined && (
        <div className={cn('flex items-center gap-1 mt-1.5 text-xs font-medium', trend >= 0 ? 'text-green-600' : 'text-red-500')}>
          {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          <span>先月比 {trend >= 0 ? '+' : ''}{trend}%</span>
        </div>
      )}
    </div>
  )
}
