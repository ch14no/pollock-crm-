// 拠点マスター（47都道府県）- ここに追加するだけで全体に反映される
// 地方別に色分け
export const LOCATIONS = [
  // 北海道
  { id: '北海道', label: '北海道', color: 'bg-sky-100 text-sky-700', region: '北海道' },
  // 東北
  { id: '青森', label: '青森', color: 'bg-indigo-100 text-indigo-700', region: '東北' },
  { id: '岩手', label: '岩手', color: 'bg-indigo-100 text-indigo-700', region: '東北' },
  { id: '宮城', label: '宮城', color: 'bg-indigo-100 text-indigo-700', region: '東北' },
  { id: '秋田', label: '秋田', color: 'bg-indigo-100 text-indigo-700', region: '東北' },
  { id: '山形', label: '山形', color: 'bg-indigo-100 text-indigo-700', region: '東北' },
  { id: '福島', label: '福島', color: 'bg-indigo-100 text-indigo-700', region: '東北' },
  // 関東
  { id: '茨城', label: '茨城', color: 'bg-orange-100 text-orange-700', region: '関東' },
  { id: '栃木', label: '栃木', color: 'bg-orange-100 text-orange-700', region: '関東' },
  { id: '群馬', label: '群馬', color: 'bg-orange-100 text-orange-700', region: '関東' },
  { id: '埼玉', label: '埼玉', color: 'bg-orange-100 text-orange-700', region: '関東' },
  { id: '千葉', label: '千葉', color: 'bg-orange-100 text-orange-700', region: '関東' },
  { id: '東京', label: '東京', color: 'bg-orange-100 text-orange-700', region: '関東' },
  { id: '神奈川', label: '神奈川', color: 'bg-orange-100 text-orange-700', region: '関東' },
  // 中部
  { id: '新潟', label: '新潟', color: 'bg-green-100 text-green-700', region: '中部' },
  { id: '富山', label: '富山', color: 'bg-green-100 text-green-700', region: '中部' },
  { id: '石川', label: '石川', color: 'bg-green-100 text-green-700', region: '中部' },
  { id: '福井', label: '福井', color: 'bg-green-100 text-green-700', region: '中部' },
  { id: '山梨', label: '山梨', color: 'bg-green-100 text-green-700', region: '中部' },
  { id: '長野', label: '長野', color: 'bg-green-100 text-green-700', region: '中部' },
  { id: '岐阜', label: '岐阜', color: 'bg-green-100 text-green-700', region: '中部' },
  { id: '静岡', label: '静岡', color: 'bg-green-100 text-green-700', region: '中部' },
  { id: '愛知', label: '愛知', color: 'bg-green-100 text-green-700', region: '中部' },
  // 近畿
  { id: '三重', label: '三重', color: 'bg-purple-100 text-purple-700', region: '近畿' },
  { id: '滋賀', label: '滋賀', color: 'bg-purple-100 text-purple-700', region: '近畿' },
  { id: '京都', label: '京都', color: 'bg-purple-100 text-purple-700', region: '近畿' },
  { id: '大阪', label: '大阪', color: 'bg-purple-100 text-purple-700', region: '近畿' },
  { id: '兵庫', label: '兵庫', color: 'bg-purple-100 text-purple-700', region: '近畿' },
  { id: '奈良', label: '奈良', color: 'bg-purple-100 text-purple-700', region: '近畿' },
  { id: '和歌山', label: '和歌山', color: 'bg-purple-100 text-purple-700', region: '近畿' },
  // 中国
  { id: '鳥取', label: '鳥取', color: 'bg-teal-100 text-teal-700', region: '中国' },
  { id: '島根', label: '島根', color: 'bg-teal-100 text-teal-700', region: '中国' },
  { id: '岡山', label: '岡山', color: 'bg-teal-100 text-teal-700', region: '中国' },
  { id: '広島', label: '広島', color: 'bg-teal-100 text-teal-700', region: '中国' },
  { id: '山口', label: '山口', color: 'bg-teal-100 text-teal-700', region: '中国' },
  // 四国
  { id: '徳島', label: '徳島', color: 'bg-yellow-100 text-yellow-700', region: '四国' },
  { id: '香川', label: '香川', color: 'bg-yellow-100 text-yellow-700', region: '四国' },
  { id: '愛媛', label: '愛媛', color: 'bg-yellow-100 text-yellow-700', region: '四国' },
  { id: '高知', label: '高知', color: 'bg-yellow-100 text-yellow-700', region: '四国' },
  // 九州・沖縄
  { id: '福岡', label: '福岡', color: 'bg-red-100 text-red-700', region: '九州' },
  { id: '佐賀', label: '佐賀', color: 'bg-red-100 text-red-700', region: '九州' },
  { id: '長崎', label: '長崎', color: 'bg-red-100 text-red-700', region: '九州' },
  { id: '熊本', label: '熊本', color: 'bg-red-100 text-red-700', region: '九州' },
  { id: '大分', label: '大分', color: 'bg-red-100 text-red-700', region: '九州' },
  { id: '宮崎', label: '宮崎', color: 'bg-red-100 text-red-700', region: '九州' },
  { id: '鹿児島', label: '鹿児島', color: 'bg-red-100 text-red-700', region: '九州' },
  { id: '沖縄', label: '沖縄', color: 'bg-red-100 text-red-700', region: '九州' },
] as const

export type LocationId = typeof LOCATIONS[number]['id']

export function getLocationConfig(id: string) {
  return LOCATIONS.find((l) => l.id === id)
}

// 地方ごとにグループ化
export function getLocationsByRegion(): Record<string, (typeof LOCATIONS[number])[]> {
  const map: Record<string, (typeof LOCATIONS[number])[]> = {}
  for (const loc of LOCATIONS) {
    if (!map[loc.region]) map[loc.region] = []
    map[loc.region].push(loc)
  }
  return map
}

// 顧客タグのソート順（拠点タグを先頭に）
export function sortTags(tags: string[]): string[] {
  const locationIds = LOCATIONS.map((l) => l.id)
  return [
    ...tags.filter((t) => locationIds.includes(t as LocationId)),
    ...tags.filter((t) => !locationIds.includes(t as LocationId)),
  ]
}
