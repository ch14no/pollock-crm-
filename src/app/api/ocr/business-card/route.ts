import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

// ─── Demo mode detection（src/proxy.ts の IS_DEMO_MODE と同じ判定） ─────────────

const IS_DEMO_MODE = process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://placeholder.supabase.co'

// ─── 認証チェック（ロール確認なし・認証済みユーザーなら誰でも利用可） ──────────

async function verifyAuthenticated(req: NextRequest): Promise<boolean> {
  if (IS_DEMO_MODE) return true
  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) return false
    const token = authHeader.slice(7)

    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    )

    const { data: { user }, error } = await supabase.auth.getUser(token)
    return !error && !!user
  } catch {
    return false
  }
}

// ─── サイズ上限チェック ──────────────────────────────────────────────────────
// Route Handlerにはボディサイズの組み込み上限がなく、本エンドポイントは
// ロールチェックなしで認証済みユーザーなら誰でも呼び出せるため、巨大な
// base64画像を送りつけられるとサーバー負荷・Anthropic API課金コストの
// リスクになる。content-lengthヘッダーとパース後のbase64長の両方でガードする。

// UIは表・裏それぞれ最大10MB（生バイト）まで許可している（page.tsx参照）。
// base64は生データの約4/3に膨れるため、2枚合計の理論上限は
// 10MB × 4/3 × 2 ≈ 26.7MB相当。JSON側のオーバーヘッド分も見込んで
// 32MBを合算上限とする（1枚あたりの上限はMAX_BASE64_CHARSで別途担保）。
const MAX_REQUEST_BYTES = 32 * 1024 * 1024 // リクエストボディ全体（front+back合算）の上限目安
const MAX_BASE64_CHARS = 19_000_000 // 1文字1バイト換算で約14MB相当。画像1枚あたりの上限
const IMAGE_TOO_LARGE_ERROR = '画像サイズが大きすぎます（各10MB以内にしてください）'

// ─── データURLのパース ──────────────────────────────────────────────────────

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number]

interface ParsedImage {
  mediaType: string
  base64Data: string
}

function parseDataUrl(dataUrl: string): ParsedImage | null {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(dataUrl)
  if (!match) return null
  return { mediaType: match[1], base64Data: match[2] }
}

function isAllowedMediaType(mediaType: string): mediaType is AllowedMediaType {
  return (ALLOWED_MEDIA_TYPES as readonly string[]).includes(mediaType)
}

// ─── 名刺フィールドの構造化スキーマ ──────────────────────────────────────────

type ContactFieldKey = 'name' | 'company' | 'position' | 'email' | 'phone' | 'mobile' | 'address' | 'website'

const CONTACT_FIELD_KEYS: ContactFieldKey[] = [
  'name', 'company', 'position', 'email', 'phone', 'mobile', 'address', 'website',
]

interface OcrFieldResult {
  value: string
  confidence: 'high' | 'medium' | 'low'
}

type OcrResult = Record<ContactFieldKey, OcrFieldResult>

function fieldSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      value: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['value', 'confidence'],
    additionalProperties: false,
  }
}

const CONTACT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: CONTACT_FIELD_KEYS.reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = fieldSchema()
    return acc
  }, {}),
  required: CONTACT_FIELD_KEYS,
  additionalProperties: false,
}

// ─── プロンプト ──────────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `あなたは名刺のOCR（文字認識）を行うアシスタントです。
提供された名刺画像から、以下の8項目を抽出してください。

- name（氏名）
- company（会社名）
- position（役職）
- email（メールアドレス）
- phone（電話番号）
- mobile（携帯電話番号）
- address（住所）
- website（ウェブサイトURL）

画像が2枚提供された場合、2枚目は同じ名刺の裏面として扱い、表面の情報と矛盾しない形で
マージしてください。日本の名刺では裏面に携帯番号・別住所・追加の連絡先が記載されている
ことがよくあります。

ルール:
- 名刺に記載がない項目は value を空文字列("")にしてください。存在しない情報を推測・
  捏造しないでください。
- confidence は以下の基準で判定してください:
  - "high": 文字が明瞭に読み取れ、確信を持って判定できる場合
  - "medium": おおむね読み取れるが、完全な確信はない場合
  - "low": かすれている・不鮮明・推測を含むなど、確信度が低い場合
- company（会社名）は「株式会社〇〇」のように、印字されている正式名称をそのまま使用して
  ください。
- 電話番号が複数記載されている場合、名刺上のラベルで判断してください:
  - 「携帯」「Mobile」「Cell」と記載されている番号 → mobile
  - 「電話」「TEL」「Office」と記載されている番号 → phone
  - ラベルがなく判別できない場合は phone に入れてください。`

// ─── POST: 名刺画像から情報を抽出 ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!(await verifyAuthenticated(req))) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  }

  // content-lengthヘッダーがある場合は、本文をパースする前に早期リジェクトする。
  // ヘッダーが無い（chunked転送等）場合はここを素通りし、後続のbase64長チェックで
  // 課金コストは防げるが、req.json()時点で巨大ボディを一度メモリに読む可能性は残る
  // （通常のfetch+JSON文字列送信では常にcontent-lengthが付くため実害は低い許容リスク）。
  const contentLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: IMAGE_TOO_LARGE_ERROR }, { status: 400 })
  }

  let body: { frontImage?: string; backImage?: string }
  try {
    body = (await req.json()) as { frontImage?: string; backImage?: string }
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が正しくありません' }, { status: 400 })
  }

  const { frontImage, backImage } = body
  if (!frontImage) {
    return NextResponse.json({ error: '表面の画像が必要です' }, { status: 400 })
  }

  const front = parseDataUrl(frontImage)
  if (!front || !isAllowedMediaType(front.mediaType)) {
    return NextResponse.json(
      { error: '対応していない画像形式です（JPEG/PNG/GIF/WebPのみ対応）' },
      { status: 400 }
    )
  }
  if (front.base64Data.length > MAX_BASE64_CHARS) {
    return NextResponse.json({ error: IMAGE_TOO_LARGE_ERROR }, { status: 400 })
  }

  let back: ParsedImage | null = null
  if (backImage) {
    back = parseDataUrl(backImage)
    if (!back || !isAllowedMediaType(back.mediaType)) {
      return NextResponse.json(
        { error: '対応していない画像形式です（JPEG/PNG/GIF/WebPのみ対応）' },
        { status: 400 }
      )
    }
    if (back.base64Data.length > MAX_BASE64_CHARS) {
      return NextResponse.json({ error: IMAGE_TOO_LARGE_ERROR }, { status: 400 })
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          'サーバー設定エラー: ANTHROPIC_API_KEY が設定されていません。Vercel → Settings → Environment Variables で追加してください。',
      },
      { status: 500 }
    )
  }

  const client = new Anthropic({ apiKey })

  const imageBlocks: Anthropic.ImageBlockParam[] = [
    {
      type: 'image',
      source: { type: 'base64', media_type: front.mediaType as AllowedMediaType, data: front.base64Data },
    },
  ]
  if (back) {
    imageBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: back.mediaType as AllowedMediaType, data: back.base64Data },
    })
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      thinking: { type: 'disabled' },
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: CONTACT_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [...imageBlocks, { type: 'text', text: EXTRACTION_PROMPT }],
        },
      ],
    })

    if (response.stop_reason === 'refusal') {
      console.error('OCR refusal from Claude:', response.stop_details)
      return NextResponse.json(
        { error: '名刺の読み取りに失敗しました。もう一度お試しください。' },
        { status: 502 }
      )
    }

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    )
    if (!textBlock) {
      console.error('OCR: レスポンスにtextブロックがありません', response)
      return NextResponse.json(
        { error: '名刺の読み取りに失敗しました。もう一度お試しください。' },
        { status: 502 }
      )
    }

    const fields = JSON.parse(textBlock.text) as OcrResult
    return NextResponse.json({ fields })
  } catch (error) {
    console.error('OCR error:', error)
    return NextResponse.json(
      { error: '名刺の読み取りに失敗しました。もう一度お試しください。' },
      { status: 502 }
    )
  }
}
