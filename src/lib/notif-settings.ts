// 通知設定（設定ページで保存し、ヘッダーの通知ベルが参照する）
// localStorage保存のためユーザー・ブラウザ単位の設定になる

export interface NotifSettings {
  tossup: boolean       // トスアップを受信したとき
  dealStage: boolean    // 商談フェーズが変更されたとき
  taskDue: boolean      // タスクの期限が近づいたとき（通知元未実装・準備中）
  teamActivity: boolean // チームメンバーの活動更新（通知元未実装・準備中）
}

export const NOTIF_SETTINGS_KEY = 'pollock-notif-settings'

export const DEFAULT_NOTIF_SETTINGS: NotifSettings = {
  tossup: true,
  dealStage: true,
  taskDue: true,
  teamActivity: false,
}

export function loadNotifSettings(): NotifSettings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(NOTIF_SETTINGS_KEY) ?? '{}')
    const parsed = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
    // 壊れた保存値（文字列や配列）が真偽値として紛れ込まないよう、boolean のみ採用する
    const next = { ...DEFAULT_NOTIF_SETTINGS }
    for (const key of Object.keys(next) as (keyof NotifSettings)[]) {
      if (typeof parsed[key] === 'boolean') next[key] = parsed[key] as boolean
    }
    return next
  } catch {
    return DEFAULT_NOTIF_SETTINGS
  }
}

export function saveNotifSettings(next: NotifSettings): void {
  try { localStorage.setItem(NOTIF_SETTINGS_KEY, JSON.stringify(next)) } catch {}
}
