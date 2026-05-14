// 拠点マスター - ここに追加するだけで全体に反映される
export const LOCATIONS = [
  { id: '東京',  label: '東京',  color: 'bg-blue-100 text-blue-700' },
  { id: '大阪',  label: '大阪',  color: 'bg-green-100 text-green-700' },
  { id: '福岡',  label: '福岡',  color: 'bg-purple-100 text-purple-700' },
] as const

export type LocationId = typeof LOCATIONS[number]['id']

export function getLocationConfig(id: string) {
  return LOCATIONS.find((l) => l.id === id)
}

// 顧客タグのソート順（拠点タグを先頭に）
export function sortTags(tags: string[]): string[] {
  const locationIds = LOCATIONS.map((l) => l.id)
  return [
    ...tags.filter((t) => locationIds.includes(t as LocationId)),
    ...tags.filter((t) => !locationIds.includes(t as LocationId)),
  ]
}
