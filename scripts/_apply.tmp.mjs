import pg from 'pg'
import { readFileSync } from 'node:fs'
const file = process.argv[2]
const sql = readFileSync(file, 'utf8')
const c = new pg.Client({ connectionString: process.env.TSR_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 })
let uid = null
const asUser = async (fn) => {
  await c.query('BEGIN')
  try {
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid])
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])
    await c.query('SET LOCAL ROLE authenticated')
    await c.query("SET LOCAL statement_timeout = '8s'")
    return await fn()
  } finally { await c.query('ROLLBACK').catch(() => {}) }
}
const timed = async (label, filters, sort = 'priority') => {
  try {
    return await asUser(async () => {
      const t = Date.now()
      const r = await c.query('select tsr_code from public.tsr_search($1, $2::jsonb, $3, 51, 0, true)', [div, JSON.stringify(filters), sort])
      const t2 = Date.now()
      const cnt = await c.query('select public.tsr_search_count($1, $2::jsonb) as n', [div, JSON.stringify(filters)])
      return { label, page_ms: t2 - t, count_ms: Date.now() - t2, rows: r.rows.length, count: cnt.rows[0].n }
    })
  } catch (e) { return { label, FAIL: `[${e.code}] ${e.message}` } }
}
let div = null
try {
  await c.connect()
  await c.query('SET statement_timeout = 0')
  const t0 = Date.now()
  for (const stmt of sql.split(/;\s*\n/).map((s) => s.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await c.query(stmt)
  console.log('APPLIED', file, `${Date.now() - t0}ms`)
  await c.query('VACUUM ANALYZE public.tsr_prospects')
  await c.query('VACUUM ANALYZE public.tsr_prospect_personal')
  uid = (await c.query("select u.id from public.user_divisions ud join public.users u on u.id = ud.user_id join public.divisions d on d.id = ud.division_id where d.name = 'M＆A事業部' and u.role <> 'super_admin' limit 1")).rows[0].id
  div = (await c.query("select id from public.divisions where name='M＆A事業部'")).rows[0].id
  const r = []
  r.push(await timed('東京都 + S + age>=70', { prefecture: '東京都', priority: 'S', ageMin: 70 }))
  r.push(await timed('age>=70 only', { ageMin: 70 }))
  r.push(await timed('age 60-65', { ageMin: 60, ageMax: 65 }, 'age_desc'))
  r.push(await timed('age>=65 + sales>=1億', { ageMin: 65, salesMin: 100000 }))
  r.push(await timed('東京都 only', { prefecture: '東京都' }))
  r.push(await timed('status + promoted', { status: 'リスト投入', promoted: 'no' }))
  r.push(await timed('default', {}))
  r.push(await timed('工務店', { query: '工務店' }))
  r.push(await timed('工務店 (warm)', { query: '工務店' }))
  console.log(JSON.stringify(r, null, 1))
} catch (e) {
  console.log('ERR', e.code ?? '', e.message)
} finally {
  await c.end().catch(() => {})
}
