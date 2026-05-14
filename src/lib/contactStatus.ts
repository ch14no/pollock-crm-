import { Star, Heart, TrendingUp, Skull, ThumbsUp } from 'lucide-react'
import type { ContactStatus } from '@/store/appStore'

export const STATUS_CONFIG: {
  status: ContactStatus
  icon: React.ElementType
  label: string
  activeClass: string
  inactiveClass: string
  activeFill: boolean
}[] = [
  { status: 'star',      icon: Star,       label: '重点顧客',      activeClass: 'text-yellow-400', inactiveClass: 'text-gray-200', activeFill: true  },
  { status: 'heart',     icon: Heart,      label: '仲良くしたい',  activeClass: 'text-pink-500',   inactiveClass: 'text-gray-200', activeFill: true  },
  { status: 'rising',    icon: TrendingUp, label: '今後伸びる',    activeClass: 'text-green-500',  inactiveClass: 'text-gray-200', activeFill: false },
  { status: 'blacklist', icon: Skull,      label: 'NG/BL',         activeClass: 'text-gray-600',   inactiveClass: 'text-gray-200', activeFill: true  },
  { status: 'trophy',    icon: ThumbsUp,   label: '自慢/引き抜き', activeClass: 'text-blue-500',   inactiveClass: 'text-gray-200', activeFill: true  },
]
