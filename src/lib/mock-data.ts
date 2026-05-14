import type { Division, User, UserDivision, Company, Contact, Deal, Activity, Tossup } from '@/types/database'
import type { DivisionCustomField, DivisionStage } from '@/store/appStore'

export const MOCK_DIVISIONS: Division[] = [
  { id: 'div-1', name: 'ITソリューション', color_code: '#f97316', created_at: '2026-01-01' },
  { id: 'div-2', name: '人材',             color_code: '#3b82f6', created_at: '2026-01-01' },
  { id: 'div-3', name: '財務',             color_code: '#22c55e', created_at: '2026-01-01' },
  { id: 'div-4', name: 'Bowers',           color_code: '#a855f7', created_at: '2026-01-01' },
  { id: 'div-5', name: 'メディケア',       color_code: '#ec4899', created_at: '2026-01-01' },
]

export const MOCK_USER: User = {
  id: 'user-1',
  name: '田中 太郎',
  email: 'tanaka@pollock.co.jp',
  role: 'manager',
  created_at: '2026-01-01',
}

export const MOCK_ADMIN_USER: User = {
  id: 'user-azuma',
  name: '東 千代之助',
  email: 'azuma_c@pollock.co.jp',
  role: 'super_admin',
  created_at: '2026-01-01',
}

// 事業部のチームメンバー（タスク割り当て用）
export const MOCK_TEAM_MEMBERS: User[] = [
  MOCK_USER,
  { id: 'user-2', name: '佐藤 花子', email: 'sato@pollock.co.jp',   role: 'user',    created_at: '2026-01-01' },
  { id: 'user-3', name: '鈴木 一郎', email: 'suzuki@pollock.co.jp', role: 'user',    created_at: '2026-01-01' },
  { id: 'user-4', name: '山本 健一', email: 'yamamoto@pollock.co.jp', role: 'user',  created_at: '2026-01-01' },
]

// デモで選択可能な全ユーザー
export const MOCK_ALL_DEMO_USERS: User[] = [MOCK_USER, MOCK_ADMIN_USER]

// このユーザーが実際に所属している事業部（編集権限の基準）
export const MOCK_USER_DIVISIONS: UserDivision[] = [
  { user_id: 'user-1', division_id: 'div-1', is_primary: true },
]

export const MOCK_COMPANIES: Company[] = [
  { id: 'co-1', name: '株式会社サンプル商事', corporate_number: '1234567890123', website: 'https://example.com', created_at: '2026-01-01', updated_at: '2026-05-01' },
  { id: 'co-2', name: '株式会社テックパートナーズ', website: 'https://tech.example.com', created_at: '2026-01-01', updated_at: '2026-05-01' },
  { id: 'co-3', name: '合同会社フューチャーワークス', created_at: '2026-01-01', updated_at: '2026-05-01' },
  { id: 'co-4', name: '株式会社グローバルリンク', website: 'https://global.example.com', created_at: '2026-01-01', updated_at: '2026-05-01' },
  { id: 'co-5', name: '医療法人はなぞの', created_at: '2026-01-01', updated_at: '2026-05-01' },
]

export const MOCK_CONTACTS: Contact[] = [
  {
    id: 'ct-1', company_id: 'co-1', division_id: 'div-1', assigned_user_id: 'user-1',
    name: '山田 一郎', email: 'yamada@sample.co.jp', phone: '03-1234-5678',
    position: '情報システム部長', tags: ['東京', 'VIP', 'キーマン'],
    custom_attributes: { it_skill: 'React', budget: '500万' },
    created_at: '2026-03-01', updated_at: '2026-05-10',
    companies: MOCK_COMPANIES[0],
  },
  {
    id: 'ct-2', company_id: 'co-2', division_id: 'div-1', assigned_user_id: 'user-1',
    name: '鈴木 花子', email: 'suzuki@tech.example.com', phone: '03-9876-5432',
    position: 'CTO', tags: ['東京', '見込み客'],
    custom_attributes: { it_skill: 'AWS', decision_maker: true },
    created_at: '2026-03-15', updated_at: '2026-05-08',
    companies: MOCK_COMPANIES[1],
  },
  {
    id: 'ct-3', company_id: 'co-3', division_id: 'div-1',
    name: '佐藤 次郎', email: 'sato@future.co.jp', phone: '06-1111-2222',
    position: '代表社員', tags: ['大阪', '要フォロー'],
    custom_attributes: {},
    created_at: '2026-04-01', updated_at: '2026-05-01',
    companies: MOCK_COMPANIES[2],
  },
  {
    id: 'ct-4', company_id: 'co-4', division_id: 'div-2',
    name: '高橋 美咲', email: 'takahashi@global.example.com',
    position: '人事部長', tags: ['大阪', '新規'],
    custom_attributes: { company_size: '500名', hiring_plan: '10名' },
    created_at: '2026-04-10', updated_at: '2026-05-05',
    companies: MOCK_COMPANIES[3],
  },
  {
    id: 'ct-5', company_id: 'co-5', division_id: 'div-5',
    name: '伊藤 健太', email: 'ito@hanazono.jp', phone: '075-555-6666',
    position: '院長', tags: ['福岡', 'VIP'],
    custom_attributes: { specialty: '内科', beds: 50 },
    created_at: '2026-04-20', updated_at: '2026-05-12',
    companies: MOCK_COMPANIES[4],
  },
]

export const MOCK_STAGES = [
  { id: 'リード',       name: 'リード',       sort_order: 0 },
  { id: '初回面談',     name: '初回面談',     sort_order: 1 },
  { id: '提案中',       name: '提案中',       sort_order: 2 },
  { id: 'クロージング', name: 'クロージング', sort_order: 3 },
  { id: '受注',         name: '受注',         sort_order: 4, is_won: true },
]

export const MOCK_DEALS: Deal[] = [
  {
    id: 'deal-1', contact_id: 'ct-1', division_id: 'div-1', assigned_user_id: 'user-1',
    title: '基幹システム刷新プロジェクト', amount: 5000000, stage_id: '提案中',
    close_date: '2026-06-30',
    created_at: '2026-04-01', updated_at: '2026-05-10',
    contacts: MOCK_CONTACTS[0],
  },
  {
    id: 'deal-2', contact_id: 'ct-2', division_id: 'div-1', assigned_user_id: 'user-1',
    title: 'クラウド移行支援', amount: 2800000, stage_id: '初回面談',
    close_date: '2026-07-15',
    created_at: '2026-04-15', updated_at: '2026-05-08',
    contacts: MOCK_CONTACTS[1],
  },
  {
    id: 'deal-3', contact_id: 'ct-3', division_id: 'div-1',
    title: 'セキュリティ監査', amount: 800000, stage_id: 'リード',
    created_at: '2026-05-01', updated_at: '2026-05-01',
    contacts: MOCK_CONTACTS[2],
  },
  {
    id: 'deal-4', contact_id: 'ct-1', division_id: 'div-1', assigned_user_id: 'user-1',
    title: 'DXコンサルティング', amount: 3500000, stage_id: 'クロージング',
    close_date: '2026-05-31',
    created_at: '2026-03-01', updated_at: '2026-05-03',
    contacts: MOCK_CONTACTS[0],
  },
  {
    id: 'deal-5', contact_id: 'ct-2', division_id: 'div-1',
    title: 'ゼロトラスト導入支援', amount: 1200000, stage_id: '受注',
    close_date: '2026-05-01',
    created_at: '2026-02-01', updated_at: '2026-05-01',
    contacts: MOCK_CONTACTS[1],
  },
]

export const MOCK_ACTIVITIES: Activity[] = [
  {
    id: 'act-1', target_type: 'contact', target_id: 'ct-1', user_id: 'user-1',
    activity_type: 'meeting', title: '初回訪問・課題ヒアリング',
    memo: '基幹システムの現状課題を確認。老朽化した既存システムのリプレイス検討中。予算は500万程度。5月末に提案書を提出することで合意。',
    status: 'done', action_date: '2026-05-10T10:00:00Z', created_at: '2026-05-10T10:30:00Z',
    users: MOCK_USER,
  },
  {
    id: 'act-2', target_type: 'deal', target_id: 'deal-1', user_id: 'user-1',
    activity_type: 'call', title: '提案フォロー電話',
    memo: '提案内容について山田部長と確認。決裁者（役員）との打合せを6/3に設定できそう。日程調整中。',
    status: 'done', action_date: '2026-05-12T14:00:00Z', created_at: '2026-05-12T14:20:00Z',
    users: MOCK_USER,
  },
  {
    id: 'act-3', target_type: 'contact', target_id: 'ct-1', user_id: 'user-1',
    activity_type: 'task', title: '提案書を作成して送付',
    memo: 'システム構成案とコスト比較表を含める。',
    due_date: '2026-05-20T18:00:00Z', status: 'todo',
    action_date: '2026-05-13T09:00:00Z', created_at: '2026-05-13T09:00:00Z',
    users: MOCK_USER,
  },
  {
    id: 'act-4', target_type: 'contact', target_id: 'ct-2', user_id: 'user-1',
    activity_type: 'email', title: 'AWS移行事例資料を送付',
    memo: '先日の面談でリクエストのあった事例3社分を送付。1週間後にフォロー電話予定。',
    status: 'done', action_date: '2026-05-08T09:00:00Z', created_at: '2026-05-08T09:10:00Z',
    users: MOCK_USER,
  },
  {
    id: 'act-5', target_type: 'contact', target_id: 'ct-2', user_id: 'user-1',
    activity_type: 'task', title: '鈴木CTOへフォロー電話',
    memo: '資料送付後のフォロー。予算承認の見通しを確認する。',
    due_date: '2026-05-15T12:00:00Z', status: 'todo',
    action_date: '2026-05-08T09:30:00Z', created_at: '2026-05-08T09:30:00Z',
    users: MOCK_USER,
  },
  {
    id: 'act-6', target_type: 'deal', target_id: 'deal-4', user_id: 'user-1',
    activity_type: 'meeting', title: 'DX推進の方向性確認MTG',
    memo: '役員同席で実施。DX推進の全体ロードマップを説明。予算確保の見通しあり。次回クロージング面談へ。',
    status: 'done', action_date: '2026-05-05T15:00:00Z', created_at: '2026-05-05T15:30:00Z',
    users: MOCK_USER,
  },
  {
    id: 'act-7', target_type: 'contact', target_id: 'ct-3', user_id: 'user-1',
    activity_type: 'note', title: '名刺交換メモ',
    memo: '交流会で接触。IT投資に積極的ではないが、業務効率化には興味あり。来月以降に改めてアプローチ予定。',
    status: 'done', action_date: '2026-05-01T18:00:00Z', created_at: '2026-05-01T18:30:00Z',
    users: MOCK_USER,
  },
  {
    id: 'act-8', target_type: 'contact', target_id: 'ct-1', user_id: 'user-1',
    activity_type: 'task', title: '役員面談の事前資料を準備',
    memo: 'ROI試算とリスク分析を含む。',
    due_date: '2026-06-01T18:00:00Z', status: 'todo',
    action_date: '2026-05-13T09:00:00Z', created_at: '2026-05-13T09:00:00Z',
    users: MOCK_USER,
  },
]

// ─── 事業部別デフォルトカスタムフィールド ───────────────────────────
export const DEFAULT_DIVISION_CUSTOM_FIELDS: Record<string, DivisionCustomField[]> = {
  'div-1': [ // ITソリューション
    { id: 'div1-f1', name: 'project_type',    label: '案件区分',         fieldType: 'select', options: ['人だし', '案件', '両方'],                                  required: false, sortOrder: 0 },
    { id: 'div1-f2', name: 'client_type',     label: 'クライアント区分', fieldType: 'select', options: ['ベンダー', 'エンドユーザー', 'ソフトハウス', '受託会社'], required: false, sortOrder: 1 },
    { id: 'div1-f3', name: 'tech_type',       label: '技術区分',         fieldType: 'select', options: ['インフラ', '開発', '両方'],                               required: false, sortOrder: 2 },
    { id: 'div1-f4', name: 'employee_count',  label: '社員数',           fieldType: 'number',                                                                     required: false, sortOrder: 3 },
    { id: 'div1-f5', name: 'unit_price',      label: '単価目安（万円）', fieldType: 'number',                                                                     required: false, sortOrder: 4 },
    { id: 'div1-f6', name: 'it_memo',         label: '備考',             fieldType: 'text',                                                                       required: false, sortOrder: 5 },
  ],
  'div-2': [ // 人材
    { id: 'div2-f1', name: 'hiring_count',    label: '採用目標人数',     fieldType: 'number',                                                                     required: false, sortOrder: 0 },
    { id: 'div2-f2', name: 'hiring_timing',   label: '採用時期',         fieldType: 'select', options: ['3ヶ月以内', '半年以内', '1年以内', '未定'],              required: false, sortOrder: 1 },
    { id: 'div2-f3', name: 'desired_job',     label: '希望職種',         fieldType: 'text',                                                                       required: false, sortOrder: 2 },
    { id: 'div2-f4', name: 'hr_memo',         label: '備考',             fieldType: 'text',                                                                       required: false, sortOrder: 3 },
  ],
  'div-3': [ // 財務
    { id: 'div3-f1', name: 'issue_type',      label: '課題区分',         fieldType: 'select', options: ['資金調達', '財務改善', 'M&A', '税務', 'その他'],        required: false, sortOrder: 0 },
    { id: 'div3-f2', name: 'issue_memo',      label: '課題詳細',         fieldType: 'text',                                                                       required: false, sortOrder: 1 },
    { id: 'div3-f3', name: 'employee_count',  label: '従業員数',         fieldType: 'number',                                                                     required: false, sortOrder: 2 },
    { id: 'div3-f4', name: 'fin_memo',        label: '備考',             fieldType: 'text',                                                                       required: false, sortOrder: 3 },
  ],
  'div-4': [ // Bowers
    { id: 'div4-f1', name: 'industry',        label: '業種',             fieldType: 'select', options: ['IT', '製造', '医療', '流通', 'サービス', 'その他'],      required: false, sortOrder: 0 },
    { id: 'div4-f2', name: 'revenue_size',    label: '売上規模',         fieldType: 'select', options: ['〜1億', '1〜10億', '10〜50億', '50億〜'],               required: false, sortOrder: 1 },
    { id: 'div4-f3', name: 'challenge_type',  label: '課題（大枠）',     fieldType: 'select', options: ['コスト削減', '業務効率化', '採用難', 'DX推進', '売上拡大', 'その他'], required: false, sortOrder: 2 },
    { id: 'div4-f4', name: 'challenge_memo',  label: '課題（詳細）',     fieldType: 'text',                                                                       required: false, sortOrder: 3 },
    { id: 'div4-f5', name: 'strength_type',   label: '強み（大枠）',     fieldType: 'select', options: ['技術力', '営業力', 'ブランド', '価格競争力', '人材', 'その他'], required: false, sortOrder: 4 },
    { id: 'div4-f6', name: 'strength_memo',   label: '強み（詳細）',     fieldType: 'text',                                                                       required: false, sortOrder: 5 },
  ],
  'div-5': [ // メディケア
    { id: 'div5-f1', name: 'department',      label: '診療科目',         fieldType: 'text',                                                                       required: false, sortOrder: 0 },
    { id: 'div5-f2', name: 'bed_count',       label: '病床数',           fieldType: 'number',                                                                     required: false, sortOrder: 1 },
    { id: 'div5-f3', name: 'current_system',  label: '導入システム',     fieldType: 'text',                                                                       required: false, sortOrder: 2 },
    { id: 'div5-f4', name: 'med_memo',        label: '備考',             fieldType: 'text',                                                                       required: false, sortOrder: 3 },
  ],
}

// ─── 事業部別デフォルトパイプラインステージ ──────────────────────────
// ※ id はステージ名と同一にすることで MOCK_DEALS の stage_id と整合させる
export const DEFAULT_DIVISION_STAGES: Record<string, DivisionStage[]> = {
  'div-1': [ // ITソリューション
    { id: 'リード',     name: 'リード',     sortOrder: 0, isWon: false, isLost: false },
    { id: '初回面談',   name: '初回面談',   sortOrder: 1, isWon: false, isLost: false },
    { id: '一次面談',   name: '一次面談',   sortOrder: 2, isWon: false, isLost: false },
    { id: '提案中',     name: '提案中',     sortOrder: 3, isWon: false, isLost: false },
    { id: '最終面談',   name: '最終面談',   sortOrder: 4, isWon: false, isLost: false },
    { id: '受注',       name: '受注',       sortOrder: 5, isWon: true,  isLost: false },
    { id: '失注',       name: '失注',       sortOrder: 6, isWon: false, isLost: true  },
  ],
  'div-2': [ // 人材
    { id: 'リード',       name: 'リード',       sortOrder: 0, isWon: false, isLost: false },
    { id: '初回面談',     name: '初回面談',     sortOrder: 1, isWon: false, isLost: false },
    { id: '提案中',       name: '提案中',       sortOrder: 2, isWon: false, isLost: false },
    { id: 'クロージング', name: 'クロージング', sortOrder: 3, isWon: false, isLost: false },
    { id: '受注',         name: '受注',         sortOrder: 4, isWon: true,  isLost: false },
    { id: '失注',         name: '失注',         sortOrder: 5, isWon: false, isLost: true  },
  ],
  'div-3': [ // 財務
    { id: 'リード',       name: 'リード',       sortOrder: 0, isWon: false, isLost: false },
    { id: '初回面談',     name: '初回面談',     sortOrder: 1, isWon: false, isLost: false },
    { id: '提案中',       name: '提案中',       sortOrder: 2, isWon: false, isLost: false },
    { id: 'クロージング', name: 'クロージング', sortOrder: 3, isWon: false, isLost: false },
    { id: '受注',         name: '受注',         sortOrder: 4, isWon: true,  isLost: false },
    { id: '失注',         name: '失注',         sortOrder: 5, isWon: false, isLost: true  },
  ],
  'div-4': [ // Bowers
    { id: 'リード',     name: 'リード',     sortOrder: 0, isWon: false, isLost: false },
    { id: 'ヒアリング', name: 'ヒアリング', sortOrder: 1, isWon: false, isLost: false },
    { id: '無料登録',   name: '無料登録',   sortOrder: 2, isWon: false, isLost: false },
    { id: 'トライアル', name: 'トライアル', sortOrder: 3, isWon: false, isLost: false },
    { id: '受注',       name: '受注',       sortOrder: 4, isWon: true,  isLost: false },
    { id: '失注',       name: '失注',       sortOrder: 5, isWon: false, isLost: true  },
  ],
  'div-5': [ // メディケア
    { id: 'リード',       name: 'リード',       sortOrder: 0, isWon: false, isLost: false },
    { id: '初回訪問',     name: '初回訪問',     sortOrder: 1, isWon: false, isLost: false },
    { id: '提案中',       name: '提案中',       sortOrder: 2, isWon: false, isLost: false },
    { id: 'クロージング', name: 'クロージング', sortOrder: 3, isWon: false, isLost: false },
    { id: '受注',         name: '受注',         sortOrder: 4, isWon: true,  isLost: false },
    { id: '失注',         name: '失注',         sortOrder: 5, isWon: false, isLost: true  },
  ],
}

export const MOCK_TOSSUPS: Tossup[] = [
  {
    id: 'toss-1',
    from_user_id: 'user-1', from_division_id: 'div-1', to_division_id: 'div-2',
    company_id: 'co-1', contact_id: 'ct-1',
    message: '基幹システム刷新の中で、SE採用ニーズが出てきました。ITエンジニア5名規模で年内採用したいとのこと。',
    status: 'in_progress',
    created_at: '2026-05-10T11:00:00Z', updated_at: '2026-05-11T09:00:00Z',
    from_user: MOCK_USER,
    from_division: MOCK_DIVISIONS[0],
    to_division: MOCK_DIVISIONS[1],
    companies: MOCK_COMPANIES[0],
    contacts: MOCK_CONTACTS[0],
  },
  {
    id: 'toss-2',
    from_user_id: 'user-1', from_division_id: 'div-1', to_division_id: 'div-3',
    company_id: 'co-2',
    message: '急成長中のスタートアップで、CFO候補を探している模様。財務顧問の紹介ニーズあり。',
    status: 'unread',
    created_at: '2026-05-12T15:30:00Z', updated_at: '2026-05-12T15:30:00Z',
    from_user: MOCK_USER,
    from_division: MOCK_DIVISIONS[0],
    to_division: MOCK_DIVISIONS[2],
    companies: MOCK_COMPANIES[1],
  },
]
