'use client'

import { Lock } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Section, Row } from '@/components/sourcing/fields'
import { PRIORITY_BADGE, fmtEst, fmtThousand, fmtInt, fmtYm, fmtPct, fmtBirth, hasPersonalInfo, isManualProspect } from '@/lib/tsrFormat'
import type { TsrProspect } from '@/lib/db/tsrProspects'

interface ProspectInfoPanelProps {
  prospect: TsrProspect
}

// 企業詳細 ①企業情報（TSR）: 基本情報／業績／事業・組織／代表者。手動登録の会社は TSR 由来の
// 業績・事業情報が無いので、その旨を表示して該当セクションは出さない
export function ProspectInfoPanel({ prospect: p }: ProspectInfoPanelProps) {
  const manual = isManualProspect(p)
  const fin = [
    { label: '直近期', closing: p.fy1_closing, sales: p.fy1_sales, profit: p.fy1_profit },
    { label: '前期', closing: p.fy2_closing, sales: p.fy2_sales, profit: p.fy2_profit },
    { label: '前々期', closing: p.fy3_closing, sales: p.fy3_sales, profit: p.fy3_profit },
  ]
  const industries = ([
    [p.industry1_code, p.industry1_name], [p.industry2_code, p.industry2_name], [p.industry3_code, p.industry3_name],
  ] as const).map(([code, name]) => (code || name ? `${code ?? ''} ${name ?? ''}`.trim() : null)).filter(Boolean).join(' ／ ')

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        {manual ? <Badge variant="info">手動登録</Badge> : <Badge variant={PRIORITY_BADGE[p.approach_priority]}>優先度 {p.approach_priority}</Badge>}
        {p.listing_name && <Badge>{p.listing_name}</Badge>}
        <span className="text-xs text-gray-400">
          {manual ? `コード ${p.tsr_code}` : `企業コード ${p.tsr_code} · 調査 ${p.surveyed_on ?? '—'}（${p.data_age_years ?? '—'}年前）`}
        </span>
      </div>

      <Section title="基本情報">
        <Row label="商号カナ" value={p.name_kana} />
        <Row label="所在地" value={`${p.postal_code ? `〒${p.postal_code} ` : ''}${p.address ?? ''}`} />
        <Row label="電話番号" value={p.phone} />
        <Row label="設立" value={fmtEst(p.established_year, p.established_month)} />
        <Row label="資本金" value={fmtThousand(p.capital_thousand_yen)} />
        <Row label="従業員数" value={fmtInt(p.employee_count, '人')} />
        <Row label="業種" value={industries} />
      </Section>

      {manual ? (
        <p className="text-xs text-gray-400">手動登録の会社のため、TSR由来の業績・事業情報はありません。会社情報は「CRMの会社ページ」から編集できます。</p>
      ) : (
        <>
          <Section title="業績">
            <table className="w-full text-xs">
              <thead><tr className="text-gray-400"><th className="text-left font-medium py-1">期</th><th className="text-left font-medium">決算年月</th><th className="text-right font-medium">売上（千円）</th><th className="text-right font-medium">利益（千円）</th></tr></thead>
              <tbody>
                {fin.map((f) => (
                  <tr key={f.label} className="border-t border-gray-50">
                    <td className="py-1 text-gray-500">{f.label}</td>
                    <td className="text-gray-700">{fmtYm(f.closing)}</td>
                    <td className="text-right text-gray-700">{fmtInt(f.sales)}</td>
                    <td className="text-right text-gray-700">{fmtInt(f.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex gap-4 mt-2 text-xs text-gray-500">
              <span>売上CAGR（3期）: <b className="text-gray-700">{fmtPct(p.sales_cagr)}</b></span>
              <span>直近期利益率: <b className="text-gray-700">{fmtPct(p.profit_margin)}</b></span>
            </div>
          </Section>

          <Section title="事業・組織">
            <Row label="営業種目" value={p.business_description} />
            <Row label="概況" value={p.overview} />
            <Row label="役員" value={p.officers} />
            <Row label="大株主" value={p.major_shareholders} />
            <Row label="営業所・支店" value={p.branches} />
            <Row label="仕入先" value={p.suppliers} />
            <Row label="販売先" value={p.customers} />
            <Row label="取引銀行" value={p.banks} />
          </Section>
        </>
      )}

      {hasPersonalInfo(p) ? (
        <Section title="代表者" note="個人情報（閲覧は記録されます）">
          <Row label="氏名" value={p.rep_name ? `${p.rep_name}${p.rep_name_kana ? `（${p.rep_name_kana}）` : ''}` : null} />
          <Row label="年齢" value={p.rep_age != null ? `${p.rep_age}歳（${fmtBirth(p.rep_birth_year, p.rep_birth_month, p.rep_birth_day)}生）` : '不明'} />
          <Row label="現住所" value={p.rep_home_address} />
          <Row label="出身地" value={p.rep_birthplace} />
          <Row label="出身校" value={p.rep_school} />
        </Section>
      ) : (
        <p className="text-xs text-gray-400 flex items-center gap-1"><Lock size={11} />代表者情報はありません（元データに記載がないか、閲覧権限がありません）</p>
      )}

      {!manual && p.source_files.length > 0 && (
        <p className="text-[11px] text-gray-400">出典PDF: {p.source_files.join(' / ')}</p>
      )}
    </div>
  )
}
