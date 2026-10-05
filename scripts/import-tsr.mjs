// TSRソーシングリスト 一括取込スクリプト（053_tsr_prospects.sql 適用後に実行）
//
//   TSR_DB_URL="postgresql://..." node --max-old-space-size=6144 scripts/import-tsr.mjs --file <csv> [--dry-run] [--limit N]
//
// - CSV（UTF-8/BOM・RFC4180）をストリーミングで読み、企業コード単位で1件に統合してから
//   500件ずつ UPSERT する。企業コードが一致すれば上書き、運用列（status等）は保持する。
// - --dry-run はDBに接続せず、正規化・統合の統計とサンプルだけを表示する。
// - 接続文字列は環境変数 TSR_DB_URL でのみ受け取る（ファイルに保存しない）。
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const args = process.argv.slice(2)
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def }
const FILE = opt('--file', 'G:/マイドライブ/★自動化・効率化/AI/PJフォルダ/Pollock Core CRM/※社外秘※_TSR_20260918.csv')
const DRY_RUN = args.includes('--dry-run')
const LIMIT = Number(opt('--limit', '0')) || 0
const BATCH = Number(opt('--batch', '500')) || 500
const DIVISION_NAMES = ['M＆A事業部', 'M&A事業部']

const PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県']
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 }
const LISTING_FALLBACK = { '9': '未上場', '8': '他上場', 'B': 'プライム', 'C': 'スタンダード', 'D': 'グロース', 'E': '東ＰＲＯ' }
const today = new Date()
const todayYM = today.getFullYear() * 100 + (today.getMonth() + 1)

// ─── 正規化 ─────────────────────────────────────────────
const toHalfWidth = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[－−]/g, '-').replace(/，/g, ',')
const empty = (v) => v == null || v === ''
const nz = (v) => (empty(v) ? null : v)
// PDF抽出で日本語の途中に紛れ込む半角スペースだけを除く（全角スペース・英字間は触らない）
const CJK = '[\\u3040-\\u30FF\\u4E00-\\u9FFF\\u3001\\u3002\\uFF08\\uFF09\\uFF0C\\u30FC]'
const strayRe = new RegExp(`(?<=${CJK}) (?=${CJK})`, 'g')
const cleanLong = (s) => nz(s.trim().replace(strayRe, ''))

const unparsed = { month: new Map(), number: new Map(), birth: new Map(), date: new Map() }
const noteUnparsed = (kind, v) => { const m = unparsed[kind]; if (m.size < 20 && !m.has(v)) m.set(v, 1); else if (m.has(v)) m.set(v, m.get(v) + 1) }

// PDF抽出で「売 （千円）」「利益（千円）」等のラベルだけが残ったセルは未入力として扱う
function parseIntJa(raw) {
  if (empty(raw)) return null
  const s = toHalfWidth(raw).replace(/売\s*（千円）|利益\s*（千円）|千円|人|[,\s]/g, '')
  if (s === '') return null
  if (/^-?\d+$/.test(s)) return Number(s)
  noteUnparsed('number', raw); return null
}

// "Mon-YY" / "YYYY/M" / "YYYY/M/D" / "YYYY" → { year, month }
function parseYearMonth(raw) {
  if (empty(raw)) return { year: null, month: null }
  const s = toHalfWidth(raw).replace(/決算年月/g, '').trim()
  if (s === '') return { year: null, month: null }
  let m
  if ((m = /^([A-Z][a-z]{2})-(\d{2})$/.exec(s)) && MONTHS[m[1]]) {
    const yy = Number(m[2]); let year = yy <= (today.getFullYear() % 100) ? 2000 + yy : 1900 + yy
    if (year * 100 + MONTHS[m[1]] > todayYM) year -= 100   // 未来になる場合は前世紀
    return { year, month: MONTHS[m[1]] }
  }
  if ((m = /^(\d{4})\/(\d{1,2})(?:\/\d{1,2})?$/.exec(s))) return { year: Number(m[1]), month: Number(m[2]) }
  if ((m = /^(\d{4})$/.exec(s))) return { year: Number(m[1]), month: null }
  noteUnparsed('month', raw); return { year: null, month: null }
}
const toFirstOfMonth = ({ year, month }) => (year ? `${year}-${String(month ?? 1).padStart(2, '0')}-01` : null)

function parseDate(raw) {
  if (empty(raw)) return null
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(toHalfWidth(raw).trim())
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  noteUnparsed('date', raw); return null
}

function parseBirth(raw) {
  if (empty(raw)) return { y: null, m: null, d: null }
  const s = toHalfWidth(raw).replace(/\s*生$/, '').trim()
  const m = /^(\d{4})(?:\/(\d{1,2}))?(?:\/(\d{1,2}))?$/.exec(s)
  if (m) return { y: Number(m[1]), m: m[2] ? Number(m[2]) : null, d: m[3] ? Number(m[3]) : null }
  noteUnparsed('birth', raw); return { y: null, m: null, d: null }
}

function splitCodeName(raw, width) {
  if (empty(raw)) return { code: null, name: null }
  const s = toHalfWidth(raw).trim()
  const m = width === 1 ? /^([A-Z0-9])\s*(.*)$/.exec(s) : /^(\d{1,4})\s*(.*)$/.exec(s)
  if (!m) return { code: null, name: nz(s) }
  return { code: width === 1 ? m[1] : m[1].padStart(width, '0'), name: nz(m[2].trim()) }
}

const industryNames = new Map()   // code -> name（名称欠落行の補完用）
const listingNames = new Map()
const learn = (map, { code, name }) => { if (code && name && (!map.has(code) || map.get(code).length < name.length)) map.set(code, name) }

function normalize(rec) {
  const listing = splitCodeName(rec['上場'], 1); learn(listingNames, listing)
  const ind = [1, 2, 3].map((i) => { const r = splitCodeName(rec[`業種${i}`], 4); learn(industryNames, r); return r })
  const est = parseYearMonth(rec['設立年月'])
  const birth = parseBirth(rec['代表者_生年月日'])
  const address = cleanLong(rec['所在地'])
  const src = rec['ソースファイル名'].replace(/^TSR_/, '').replace(/\.pdf$/, '').replace(/ \(\d+\)$/, '')
  // 元データは「1」が最古期・「3」が直近期（2026-10-05の全量確認）。依頼書・DBは
  // 「1＝直近期」で設計しているため、決算年月の新しい順に並べ替えて格納する
  const periods = [1, 2, 3]
    .map((i) => ({ closing: toFirstOfMonth(parseYearMonth(rec[`業績_決算年月${i}`])), sales: parseIntJa(rec[`業績_売上（千円）${i}`]), profit: parseIntJa(rec[`業績_利益（千円）${i}`]) }))
    .filter((p) => p.closing || p.sales != null || p.profit != null)
    .sort((a, b) => (b.closing ?? '').localeCompare(a.closing ?? ''))
  const fy = (i) => periods[i] ?? { closing: null, sales: null, profit: null }
  return {
    tsr_code: toHalfWidth(rec['企業コード']).trim().padStart(9, '0'),
    listing_code: listing.code, listing_name: listing.name,
    name: rec['商号（漢字）'].trim(), name_kana: nz(rec['商号（カナ）'].trim()),
    surveyed_on: parseDate(rec['調査年月日']),
    postal_code: nz(rec['郵便番号'].replace(/^〒/, '').trim()),
    address, prefecture: PREFS.find((p) => (address ?? '').startsWith(p)) ?? null,
    phone: nz(rec['電話番号'].replace(/\s/g, '')),
    established_year: est.year, established_month: est.month,
    capital_thousand_yen: parseIntJa(rec['資本金']), employee_count: parseIntJa(rec['従業員数']),
    industry1_code: ind[0].code, industry1_name: ind[0].name,
    industry2_code: ind[1].code, industry2_name: ind[1].name,
    industry3_code: ind[2].code, industry3_name: ind[2].name,
    business_description: cleanLong(rec['営業種目']), officers: cleanLong(rec['役員']),
    major_shareholders: cleanLong(rec['大株主']), branches: cleanLong(rec['営業所・支店']),
    suppliers: cleanLong(rec['仕入先']), customers: cleanLong(rec['販売先']),
    banks: cleanLong(rec['取引銀行']), overview: cleanLong(rec['概況']),
    fy1_closing: fy(0).closing, fy1_sales: fy(0).sales, fy1_profit: fy(0).profit,
    fy2_closing: fy(1).closing, fy2_sales: fy(1).sales, fy2_profit: fy(1).profit,
    fy3_closing: fy(2).closing, fy3_sales: fy(2).sales, fy3_profit: fy(2).profit,
    source_files: [src],
    personal: {
      rep_name: nz(rec['代表者氏名'].trim()), rep_name_kana: nz(rec['代表者カナ'].trim()),
      rep_home_address: cleanLong(rec['代表者_現住所'].replace(/^〒\S+\s*/, '')),
      rep_birth_year: birth.y, rep_birth_month: birth.m, rep_birth_day: birth.d,
      rep_birthplace: nz(toHalfWidth(rec['代表者_出身地']).replace(/^\d+\s*/, '').trim()),
      rep_school: nz(rec['代表者_出身校'].trim()),
    },
  }
}

// ─── 重複統合: 調査年月日が新しい方を優先、同日は項目ごとに情報量の多い方 ───
function richer(a, b) {
  if (empty(a)) return b; if (empty(b)) return a
  if (typeof a === 'string' && typeof b === 'string' && b.length > a.length) return b
  return a
}
function merge(cur, inc) {
  let base = cur, other = inc
  if ((inc.surveyed_on ?? '') > (cur.surveyed_on ?? '')) { base = inc; other = cur }
  for (const k of Object.keys(base)) {
    if (k === 'personal') { for (const pk of Object.keys(base.personal)) base.personal[pk] = richer(base.personal[pk], other.personal[pk]) }
    else if (k === 'source_files') { for (const s of other.source_files) if (!base.source_files.includes(s)) base.source_files.push(s) }
    else base[k] = richer(base[k], other[k])
  }
  return base
}

// ─── CSV ストリーミング（RFC4180） ────────────────────────
async function readCsv(file, onRow) {
  let header = null, field = '', fields = [], inQuotes = false, prev = '', rows = 0
  const flushRow = () => {
    fields.push(field); field = ''
    if (!header) header = fields.map((h) => h.replace(/^\uFEFF/, ''))
    else if (fields.length === header.length) { rows++; onRow(Object.fromEntries(header.map((h, i) => [h, fields[i]]))) }
    fields = []
  }
  for await (const chunk of fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 })) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]
      if (inQuotes) { if (ch === '"') inQuotes = false; else field += ch }
      else if (ch === '"') { inQuotes = true; if (prev === '"') field += '"' }
      else if (ch === ',') { fields.push(field); field = '' }
      else if (ch === '\n') { flushRow(); if (LIMIT && rows >= LIMIT) return rows }
      else if (ch !== '\r') field += ch
      prev = ch
    }
  }
  if (field.length || fields.length) flushRow()
  return rows
}

// ─── メイン ─────────────────────────────────────────────
const merged = new Map()
const startedAt = new Date()
console.log(`[import-tsr] reading ${FILE}${DRY_RUN ? ' (dry-run)' : ''}`)
const rowsRead = await readCsv(FILE, (rec) => {
  const n = normalize(rec)
  const cur = merged.get(n.tsr_code)
  merged.set(n.tsr_code, cur ? merge(cur, n) : n)
  if (merged.size % 100000 === 0 && !cur) console.log(`  ... ${merged.size} companies`)
})
for (const r of merged.values()) {
  if (!r.listing_name && r.listing_code) r.listing_name = listingNames.get(r.listing_code) ?? LISTING_FALLBACK[r.listing_code] ?? null
  for (const i of [1, 2, 3]) if (!r[`industry${i}_name`] && r[`industry${i}_code`]) r[`industry${i}_name`] = industryNames.get(r[`industry${i}_code`]) ?? null
}
console.log(`[import-tsr] rows=${rowsRead} companies=${merged.size} industryDict=${industryNames.size} listingDict=${listingNames.size}`)

if (DRY_RUN) {
  const list = [...merged.values()]
  const nullRate = (f, from = (r) => r) => (100 * list.filter((r) => empty(from(r)[f])).length / list.length).toFixed(1) + '%'
  console.log('null rates:', Object.fromEntries(['surveyed_on', 'prefecture', 'phone', 'established_year', 'capital_thousand_yen', 'employee_count', 'industry1_code', 'industry1_name', 'industry2_code', 'fy1_closing', 'fy1_sales', 'fy1_profit', 'fy3_sales', 'overview'].map((f) => [f, nullRate(f)])))
  console.log('personal null rates:', Object.fromEntries(['rep_name', 'rep_birth_year', 'rep_birth_month', 'rep_home_address', 'rep_birthplace', 'rep_school'].map((f) => [f, nullRate(f, (r) => r.personal)])))
  console.log('unparsed samples:', Object.fromEntries(Object.entries(unparsed).map(([k, m]) => [k, [...m.entries()].slice(0, 8)])))
  const multi = list.filter((r) => r.source_files.length > 1)
  console.log('multi-source companies:', multi.length)
  console.log('fiscal order check:', {
    fy1_older_than_fy3: list.filter((r) => r.fy1_closing && r.fy3_closing && r.fy1_closing < r.fy3_closing).length,
    no_closing_at_all: list.filter((r) => !r.fy1_closing).length,
    fy1_sales_without_closing: list.filter((r) => r.fy1_sales != null && !r.fy1_closing).length,
    fy1_latest_year_hist: Object.fromEntries([...list.reduce((m, r) => { const y = (r.fy1_closing ?? 'none').slice(0, 4); return m.set(y, (m.get(y) ?? 0) + 1) }, new Map())].sort()),
  })
  console.log('sample[0]:', JSON.stringify(list[0], null, 1))
  console.log('sample[multi]:', JSON.stringify(multi[0], null, 1))
  console.log('sample[partial birth]:', JSON.stringify(list.find((r) => r.personal.rep_birth_year && !r.personal.rep_birth_month) ?? null, null, 1))
  process.exit(0)
}

const url = process.env.TSR_DB_URL
if (!url) { console.error('TSR_DB_URL が未設定です'); process.exit(1) }
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
const { rows: divRows } = await client.query('SELECT id FROM public.divisions WHERE name = ANY($1)', [DIVISION_NAMES])
if (divRows.length !== 1) { console.error('M&A事業部が特定できません:', divRows); process.exit(1) }
const divisionId = divRows[0].id
const batchId = randomUUID()

const COLS = ['tsr_code', 'division_id', 'listing_code', 'listing_name', 'name', 'name_kana', 'surveyed_on', 'postal_code', 'address', 'prefecture', 'phone',
  'established_year', 'established_month', 'capital_thousand_yen', 'employee_count',
  'industry1_code', 'industry1_name', 'industry2_code', 'industry2_name', 'industry3_code', 'industry3_name',
  'business_description', 'officers', 'major_shareholders', 'branches', 'suppliers', 'customers', 'banks', 'overview',
  'fy1_closing', 'fy1_sales', 'fy1_profit', 'fy2_closing', 'fy2_sales', 'fy2_profit', 'fy3_closing', 'fy3_sales', 'fy3_profit',
  'source_files', 'import_batch_id']
const PCOLS = ['tsr_code', 'division_id', 'rep_name', 'rep_name_kana', 'rep_home_address', 'rep_birth_year', 'rep_birth_month', 'rep_birth_day', 'rep_birthplace', 'rep_school']
// 運用列・company_id は上書きしない
const UPDATE_COLS = COLS.filter((c) => !['tsr_code', 'division_id'].includes(c))
const PUPDATE_COLS = PCOLS.filter((c) => !['tsr_code', 'division_id'].includes(c))

function buildUpsert(table, cols, updateCols, rows, returning) {
  const values = [], params = []
  rows.forEach((r, i) => {
    values.push(`(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(',')})`)
    params.push(...cols.map((c) => r[c]))
  })
  const sql = `INSERT INTO public.${table} (${cols.join(',')}) VALUES ${values.join(',')}
    ON CONFLICT (tsr_code) DO UPDATE SET ${updateCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}${table === 'tsr_prospects' ? ', imported_at = NOW()' : ''}
    ${returning ? 'RETURNING (xmax = 0) AS inserted' : ''}`
  return { sql, params }
}

let inserted = 0, updated = 0, done = 0
const all = [...merged.values()]
for (let i = 0; i < all.length; i += BATCH) {
  const chunk = all.slice(i, i + BATCH)
  const main = chunk.map((r) => ({ ...r, division_id: divisionId, import_batch_id: batchId }))
  const personal = chunk.map((r) => ({ tsr_code: r.tsr_code, division_id: divisionId, ...r.personal }))
  await client.query('BEGIN')
  try {
    const q = buildUpsert('tsr_prospects', COLS, UPDATE_COLS, main, true)
    const res = await client.query(q.sql, q.params)
    for (const row of res.rows) row.inserted ? inserted++ : updated++
    const p = buildUpsert('tsr_prospect_personal', PCOLS, PUPDATE_COLS, personal, false)
    await client.query(p.sql, p.params)
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error(`batch at ${i} failed:`, e.message)
    throw e
  }
  done += chunk.length
  if (done % 20000 < BATCH) console.log(`  upserted ${done}/${all.length} (inserted=${inserted} updated=${updated})`)
}
await client.query(
  `INSERT INTO public.tsr_import_logs (division_id, file_name, rows_read, unique_companies, inserted_count, updated_count, started_at, note)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
  [divisionId, FILE.split('/').pop(), rowsRead, merged.size, inserted, updated, startedAt, `batch=${batchId}`])
// 業種の絞り込み選択肢（マテリアライズドビュー）は取込時にしか変わらないのでここで更新する
console.log('[import-tsr] refreshing tsr_industry_options ...')
// CONCURRENTLY: 更新中も画面側の読み取りを止めない（一意インデックス idx_tsr_industry_options_key が前提）
await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY public.tsr_industry_options')
await client.end()
console.log(`[import-tsr] DONE rows=${rowsRead} companies=${merged.size} inserted=${inserted} updated=${updated} batch=${batchId}`)
