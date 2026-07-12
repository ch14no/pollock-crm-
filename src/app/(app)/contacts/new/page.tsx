'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, CreditCard, UserPlus, CheckCircle2, AlertCircle,
  ChevronRight, RotateCw, X, Sparkles, MapPin, Phone, Mail,
  Users, Building2, Globe, Home, Camera, FolderOpen,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { LOCATIONS } from '@/lib/config'
import { getInitials, cn, isValidEmail } from '@/lib/utils'
import toast from 'react-hot-toast'
import { useAppStore } from '@/store/appStore'
import { isSupabaseConfigured } from '@/lib/db/client'
import { createContact } from '@/lib/db/contacts'
import { findOrCreateCompany } from '@/lib/db/companies'
import { createClient } from '@/lib/supabase/client'
import { Activity } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContactFields {
  name: string
  company: string
  position: string
  email: string
  phone: string
  mobile: string  // custom_attributes.mobile に保存
  address: string // custom_attributes.address に保存
  website: string
}

interface OcrField {
  key: keyof ContactFields
  label: string
  value: string
  confidence: 'high' | 'medium' | 'low'
}

type Flow = 'card' | 'manual'
type Step = 'select' | 'upload' | 'scanning' | 'review' | 'manual_fields' | 'meta' | 'confirm' | 'done'

const EMPTY_FIELDS: ContactFields = {
  name: '', company: '', position: '', email: '',
  phone: '', mobile: '', address: '', website: '',
}

// ─── OCR (Claude Vision API) ──────────────────────────────────────────────────

async function getAuthToken(): Promise<string | null> {
  try {
    const { data: { session } } = await createClient().auth.getSession()
    return session?.access_token ?? null
  } catch { return null }
}

async function runBusinessCardOcr(frontImage: string, backImage: string | null): Promise<OcrField[]> {
  const token = await getAuthToken()
  const res = await fetch('/api/ocr/business-card', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ frontImage, backImage: backImage ?? undefined }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? '名刺の読み取りに失敗しました。もう一度お試しください。')

  const fields = data.fields as Record<keyof ContactFields, { value: string; confidence: 'high' | 'medium' | 'low' }>
  return (Object.keys(FIELD_LABELS) as (keyof ContactFields)[]).map((key) => ({
    key,
    label: FIELD_LABELS[key].label,
    value: fields[key]?.value ?? '',
    confidence: fields[key]?.confidence ?? 'low',
  }))
}

// ─── Duplicate check（Supabase モードでは常に null） ──────────────────────────

function findDuplicate(_fields: Partial<ContactFields>): { name: string; companies?: { name: string } | null; id: string } | null {
  return null
}

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIDENCE_CONFIG = {
  high:   { icon: CheckCircle2, text: 'text-green-500', bg: 'bg-green-50 border-green-200', label: '高' },
  medium: { icon: AlertCircle,  text: 'text-yellow-500', bg: 'bg-yellow-50 border-yellow-200', label: '要確認' },
  low:    { icon: AlertCircle,  text: 'text-red-400',   bg: 'bg-red-50 border-red-200',    label: '低' },
}

const FIELD_LABELS: Record<keyof ContactFields, { label: string; icon: React.ElementType; required?: boolean }> = {
  name:     { label: '氏名',   icon: Users,     required: true },
  company:  { label: '会社名', icon: Building2, required: true },
  position: { label: '役職',   icon: Users },
  email:    { label: 'メール', icon: Mail },
  phone:    { label: '電話',   icon: Phone },
  mobile:   { label: '携帯',   icon: Phone },
  address:  { label: '住所',   icon: Home },
  website:  { label: 'URL',    icon: Globe },
}

const CARD_STEPS: { id: Step; label: string }[] = [
  { id: 'upload',  label: '名刺アップロード' },
  { id: 'review',  label: '読み取り確認' },
  { id: 'meta',    label: '取得状況' },
  { id: 'confirm', label: '確認・保存' },
]
const MANUAL_STEPS: { id: Step; label: string }[] = [
  { id: 'manual_fields', label: '基本情報' },
  { id: 'meta',          label: '取得状況' },
  { id: 'confirm',       label: '確認・保存' },
]

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NewContactPage() {
  const router    = useRouter()
  const params    = useSearchParams()
  const { activeDivision, openActivityModal } = useAppStore()

  // Derive initial flow from query param
  const initialMode = params.get('mode')
  const [flow, setFlow] = useState<Flow | null>(
    initialMode === 'card' ? 'card' : initialMode === 'manual' ? 'manual' : null
  )
  const [step, setStep] = useState<Step>(
    initialMode === 'card' ? 'upload' :
    initialMode === 'manual' ? 'manual_fields' : 'select'
  )

  // Card images – separate refs to avoid reuse caching issue
  const frontRef = useRef<HTMLInputElement>(null)
  const backRef  = useRef<HTMLInputElement>(null)
  // カメラ起動用（capture="environment"）。スマホでは背面カメラが直接起動する
  const frontCameraRef = useRef<HTMLInputElement>(null)
  const backCameraRef  = useRef<HTMLInputElement>(null)
  const [frontImage, setFrontImage] = useState<string | null>(null)
  const [backImage,  setBackImage]  = useState<string | null>(null)
  const [isRotating, setIsRotating] = useState(false)
  const [activeCard, setActiveCard] = useState<'front' | 'back'>('front')
  const [isDragOver, setIsDragOver] = useState(false)

  // Fields
  const [ocrFields,     setOcrFields]     = useState<OcrField[]>([])
  const [fields,        setFields]        = useState<ContactFields>(EMPTY_FIELDS)
  const [fieldErrors,   setFieldErrors]   = useState<Partial<Record<keyof ContactFields, string>>>({})

  // Meta
  const [location,        setLocation]        = useState('')
  const [meetingContext,  setMeetingContext]   = useState('')
  const [customTags,      setCustomTags]       = useState('')

  const [saving,    setSaving]    = useState(false)

  // Compute duplicate at any time so we can show early warnings
  const duplicate = findDuplicate(fields)

  // Merge OCR results into fields (OCR results = base, manual edits = override)
  const applyOcr = useCallback((ocr: OcrField[]) => {
    const merged = { ...EMPTY_FIELDS }
    ocr.forEach((f) => { if (f.value) (merged as Record<string, string>)[f.key] = f.value })
    setFields(merged)
  }, [])

  // ─── Image handling ────────────────────────────────────────────────────────

  const rotateImageDataUrl = (dataUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.height
        canvas.height = img.width
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('canvas unsupported')); return }
        ctx.translate(canvas.width / 2, canvas.height / 2)
        ctx.rotate(Math.PI / 2)
        ctx.drawImage(img, -img.width / 2, -img.height / 2)
        const mediaType = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/jpeg'
        const outputType = mediaType === 'image/png' || mediaType === 'image/gif' ? mediaType : 'image/jpeg'
        resolve(canvas.toDataURL(outputType, 0.92))
      }
      img.onerror = () => reject(new Error('画像の読み込みに失敗しました'))
      img.src = dataUrl
    })
  }

  const rotateActiveImage = async () => {
    const current = activeCard === 'front' ? frontImage : backImage
    if (!current) return
    setIsRotating(true)
    try {
      const rotated = await rotateImageDataUrl(current)
      if (activeCard === 'front') setFrontImage(rotated)
      else setBackImage(rotated)
    } catch {
      toast.error('画像の回転に失敗しました')
    } finally {
      setIsRotating(false)
    }
  }

  const loadImage = (file: File, side: 'front' | 'back') => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ファイルサイズは10MB以内にしてください')
      return
    }
    if (!file.type.startsWith('image/')) {
      toast.error('画像ファイルを選択してください（JPG・PNG・HEIC）')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      if (side === 'front') setFrontImage(dataUrl)
      else setBackImage(dataUrl)
    }
    reader.readAsDataURL(file)
    // Reset input value so same file can be re-selected
    if (side === 'front' && frontRef.current) frontRef.current.value = ''
    if (side === 'back'  && backRef.current)  backRef.current.value  = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) loadImage(file, activeCard)
  }

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true) }
  const handleDragLeave = () => setIsDragOver(false)

  const startOcr = async () => {
    if (!frontImage) { toast.error('表面の画像をアップロードしてください'); return }
    setStep('scanning')
    try {
      const ocr = await runBusinessCardOcr(frontImage, backImage)
      setOcrFields(ocr)
      applyOcr(ocr)
      setStep('review')
    } catch (e) {
      toast.error((e as Error).message || '名刺の読み取りに失敗しました。もう一度お試しください。')
      setStep('upload')
    }
  }

  // ─── Validation ───────────────────────────────────────────────────────────

  const validateFields = (): boolean => {
    const errors: Partial<Record<keyof ContactFields, string>> = {}
    if (!fields.name.trim())    errors.name    = '氏名は必須です'
    if (!fields.company.trim()) errors.company = '会社名は必須です'
    if (fields.email && !isValidEmail(fields.email)) {
      errors.email = 'メールアドレスの形式が正しくありません'
    }
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleNextFromManualFields = () => {
    if (!validateFields()) {
      toast.error('入力内容を確認してください')
      return
    }
    setStep('meta')
  }

  const handleNextFromReview = () => {
    if (!fields.name.trim() || !fields.company.trim()) {
      toast.error('氏名と会社名は必須です')
      return
    }
    setStep('meta')
  }

  // ─── Save ─────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true)
    try {
      const tags: string[] = [
        ...(location ? [location] : []),
        ...customTags.split(/[,、\s]+/).map((t) => t.trim()).filter(Boolean),
      ]
      const customAttributes: Record<string, unknown> = {}
      if (fields.mobile)        customAttributes.mobile = fields.mobile
      if (fields.website)       customAttributes.website = fields.website
      if (meetingContext)       customAttributes.meeting_context = meetingContext

      // 事業部が未確定のまま進むと、保存せずに成功トーストだけ出す「偽の成功」になる。
      // 本番モードでは必ず保存できる状態かを先に確認する
      if (isSupabaseConfigured() && !activeDivision) {
        toast.error('事業部が選択されていません。サイドバーで事業部を選んでからもう一度お試しください')
        return
      }
      if (isSupabaseConfigured() && activeDivision) {
        const companyId = fields.company
          ? (await findOrCreateCompany(fields.company)) ?? undefined
          : undefined
        await createContact({
          divisionId: activeDivision.id,
          name: fields.name,
          email: fields.email || undefined,
          phone: fields.phone || undefined,
          position: fields.position || undefined,
          address: fields.address || undefined,
          companyId,
          tags,
          customAttributes,
        })
      }
      setStep('done')
      toast.success(`${fields.name}さんを登録しました！`)
    } catch {
      toast.error('保存に失敗しました。もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  const handleContinue = () => {
    setFields(EMPTY_FIELDS)
    setOcrFields([])
    setFrontImage(null)
    setBackImage(null)
    setLocation('')
    setMeetingContext('')
    setCustomTags('')
    setFieldErrors({})
    setFlow(null)
    setStep('select')
  }

  // ─── Step progress ────────────────────────────────────────────────────────

  const steps = flow === 'card' ? CARD_STEPS : MANUAL_STEPS
  const stepIdx = steps.findIndex((s) => s.id === step)

  // ─── Render ───────────────────────────────────────────────────────────────

  if (step === 'select') {
    return (
      <div className="w-full max-w-lg mx-auto">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors">
          <ArrowLeft size={16} /> 顧客一覧へ戻る
        </button>
        <h1 className="text-2xl font-black text-gray-800 mb-2">顧客を追加</h1>
        <p className="text-sm text-gray-500 mb-6">登録方法を選択してください</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => { setFlow('card'); setStep('upload') }}
            className="group flex flex-col gap-4 p-7 bg-white border-2 border-gray-200
              rounded-2xl hover:border-orange-400 hover:bg-orange-50/40 transition-all text-left"
          >
            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center group-hover:bg-orange-200 transition-colors">
              <CreditCard size={24} className="text-orange-600" />
            </div>
            <div>
              <p className="font-bold text-gray-800 mb-1">名刺から登録</p>
              <p className="text-xs text-gray-500 leading-relaxed">写真をアップロードするとAIが自動で読み取ります</p>
              <div className="flex items-center gap-1 mt-2">
                <Sparkles size={11} className="text-orange-400" />
                <span className="text-xs text-orange-500 font-medium">AI自動読み取り</span>
              </div>
            </div>
          </button>

          <button
            onClick={() => { setFlow('manual'); setStep('manual_fields') }}
            className="group flex flex-col gap-4 p-7 bg-white border-2 border-gray-200
              rounded-2xl hover:border-gray-400 hover:bg-gray-50 transition-all text-left"
          >
            <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center group-hover:bg-gray-200 transition-colors">
              <UserPlus size={24} className="text-gray-600" />
            </div>
            <div>
              <p className="font-bold text-gray-800 mb-1">手動で入力</p>
              <p className="text-xs text-gray-500 leading-relaxed">氏名・会社名・連絡先などを直接入力して登録します</p>
            </div>
          </button>
        </div>
      </div>
    )
  }

  if (step === 'done') {
    return (
      <div className="w-full max-w-sm mx-auto text-center py-16">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={32} className="text-green-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">登録完了！</h2>
        <p className="text-sm text-gray-500 mb-2">
          {fields.name} さんを {activeDivision?.name ?? ''} に登録しました
        </p>
        {/* 活動記録の誘導 */}
        <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 mb-6 text-left">
          <p className="text-sm font-medium text-orange-700 mb-1 flex items-center gap-1.5">
            <Activity size={14} />
            ファーストコンタクトを記録しますか？
          </p>
          <p className="text-xs text-orange-600 mb-3">
            どこで出会ったか、最初の印象など、今すぐ記録しておきましょう。
          </p>
          <Button
            size="sm"
            className="w-full"
            onClick={() => {
              openActivityModal({
                contactName: `${fields.name}（${fields.company}）`,
              })
            }}
          >
            活動を記録する
          </Button>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button variant="secondary" className="min-h-11" onClick={() => router.push('/contacts')}>顧客一覧へ</Button>
          <Button className="min-h-11" onClick={handleContinue}>続けて登録</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-2xl">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors">
        <ArrowLeft size={16} />
        {flow === 'card' ? '名刺から顧客登録' : '顧客を手動登録'}へ戻る
      </button>
      <h1 className="text-2xl font-black text-gray-800 mb-5">
        {flow === 'card' ? '名刺から顧客登録' : '顧客を手動登録'}
      </h1>

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-1">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1 flex-shrink-0">
            <div className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              i === stepIdx ? 'bg-orange-500 text-white' :
              i < stepIdx  ? 'bg-green-100 text-green-700 cursor-pointer hover:bg-green-200' :
              'bg-gray-100 text-gray-400'
            )}>
              {i < stepIdx && <CheckCircle2 size={11} />}
              {s.label}
            </div>
            {i < steps.length - 1 && <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />}
          </div>
        ))}
      </div>

      {/* ─── Upload step ─── */}
      {step === 'upload' && (
        <div className="space-y-4">
          <div className="flex gap-2 bg-gray-100 p-1 rounded-xl w-fit">
            {(['front', 'back'] as const).map((side) => (
              <button
                key={side}
                onClick={() => setActiveCard(side)}
                className={cn(
                  'px-4 py-2.5 sm:py-1.5 rounded-lg text-sm font-medium transition-colors relative',
                  activeCard === side ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
                )}
              >
                {side === 'front' ? '表面' : '裏面（任意）'}
                {side === 'front' && frontImage && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                )}
                {side === 'back' && backImage && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                )}
              </button>
            ))}
          </div>

          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => (activeCard === 'front' ? frontRef : backRef).current?.click()}
            className={cn(
              'relative border-2 border-dashed rounded-2xl cursor-pointer transition-all',
              'flex flex-col items-center justify-center overflow-hidden',
              isDragOver ? 'border-orange-500 bg-orange-50 scale-[1.01]' :
              (activeCard === 'front' ? frontImage : backImage)
                ? 'border-green-300 p-2'
                : 'border-gray-200 p-6 sm:p-12 hover:border-orange-400 hover:bg-orange-50/20'
            )}
            style={{ aspectRatio: '1.586 / 1', maxHeight: 300 }}
          >
            {isDragOver && (
              <div className="absolute inset-0 bg-orange-50/80 flex items-center justify-center z-10">
                <p className="text-orange-600 font-bold text-lg">ここにドロップ</p>
              </div>
            )}

            {(activeCard === 'front' ? frontImage : backImage) ? (
              <>
                <img
                  src={activeCard === 'front' ? frontImage! : backImage!}
                  alt={`名刺${activeCard === 'front' ? '表面' : '裏面'}`}
                  className="w-full h-full object-cover rounded-xl"
                />
                <div className="absolute top-2 right-2 flex gap-1.5">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); rotateActiveImage() }}
                    disabled={isRotating}
                    title="90度回転"
                    aria-label="画像を90度回転"
                    className="w-11 h-11 flex items-center justify-center bg-white/90 rounded-full shadow-md hover:bg-white disabled:opacity-50"
                  >
                    <RotateCw size={16} className={cn('text-gray-600', isRotating && 'animate-spin')} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      activeCard === 'front' ? setFrontImage(null) : setBackImage(null)
                    }}
                    title="削除"
                    aria-label="画像を削除"
                    className="w-11 h-11 flex items-center justify-center bg-white/90 rounded-full shadow-md hover:bg-white"
                  >
                    <X size={16} className="text-gray-600" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mb-3">
                  <CreditCard size={26} className="text-gray-400" />
                </div>
                <p className="text-gray-600 font-medium mb-0.5 text-center">
                  {activeCard === 'front' ? '名刺の表面をアップロード' : '名刺の裏面をアップロード（任意）'}
                </p>
                <p className="text-xs text-gray-400 hidden sm:block">ドラッグ＆ドロップ、またはタップして選択</p>
                <p className="text-xs text-gray-300 mt-1 mb-4">JPG / PNG / HEIC / 最大10MB</p>

                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto px-4 sm:px-0">
                  <Button
                    type="button"
                    size="sm"
                    className="w-full sm:w-auto min-h-11"
                    icon={<Camera size={15} />}
                    onClick={(e) => {
                      e.stopPropagation()
                      ;(activeCard === 'front' ? frontCameraRef : backCameraRef).current?.click()
                    }}
                  >
                    カメラで撮影
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full sm:w-auto min-h-11"
                    icon={<FolderOpen size={15} />}
                    onClick={(e) => {
                      e.stopPropagation()
                      ;(activeCard === 'front' ? frontRef : backRef).current?.click()
                    }}
                  >
                    ファイルを選択
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Separate inputs for front and back to avoid same-file caching */}
          <input ref={frontRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && loadImage(e.target.files[0], 'front')} />
          <input ref={backRef}  type="file" accept="image/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && loadImage(e.target.files[0], 'back')} />
          {/* カメラ起動用（capture="environment"）。PCでは無視され通常のファイル選択になる */}
          <input ref={frontCameraRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => e.target.files?.[0] && loadImage(e.target.files[0], 'front')} />
          <input ref={backCameraRef}  type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => e.target.files?.[0] && loadImage(e.target.files[0], 'back')} />

          <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
            <span>💡</span>
            <span>名刺は明るい場所で水平に撮影すると読み取り精度が上がります。向きが横向きの場合は右上の回転ボタンで直せます。裏面に住所や別連絡先がある場合は追加すると自動でマージされます。</span>
          </div>

          <div className="flex justify-between gap-2">
            <Button variant="secondary" className="min-h-11" onClick={() => { setFlow(null); setStep('select') }}>戻る</Button>
            <Button className="min-h-11" onClick={startOcr} disabled={!frontImage} icon={<Sparkles size={15} />}>
              AIで読み取る
            </Button>
          </div>
        </div>
      )}

      {/* ─── Scanning step ─── */}
      {step === 'scanning' && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="relative w-20 h-20 mb-6">
            <div className="absolute inset-0 rounded-full border-4 border-orange-200 animate-ping" />
            <div className="w-20 h-20 rounded-full bg-orange-100 flex items-center justify-center relative z-10">
              <Sparkles size={30} className="text-orange-500 animate-pulse" />
            </div>
          </div>
          <h2 className="text-lg font-bold text-gray-800 mb-2">AI読み取り中...</h2>
          <p className="text-sm text-gray-500 mb-4">名刺の文字情報を解析しています</p>
          <div className="flex gap-4 text-xs text-gray-400">
            {['社名を認識', '氏名を抽出', '連絡先を確認'].map((s, i) => (
              <span key={s} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }} />
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ─── Review OCR results ─── */}
      {step === 'review' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
            <CheckCircle2 size={15} className="flex-shrink-0" />
            <span>読み取り完了。内容を確認・修正してください。<strong>オレンジ枠</strong>は修正済みのフィールドです。</span>
          </div>

          {/* Early duplicate warning */}
          {duplicate && (
            <div className="flex items-start gap-2 px-4 py-3 bg-yellow-50 border border-yellow-300 rounded-xl text-sm text-yellow-800">
              <AlertCircle size={15} className="flex-shrink-0 text-yellow-500 mt-0.5" />
              <span>
                <strong>{duplicate.name}</strong>（{duplicate.companies?.name}）が既に登録されています。
                <button onClick={() => router.push(`/contacts/${duplicate.id}`)} className="ml-1 underline hover:text-yellow-900">確認する</button>
              </span>
            </div>
          )}

          {frontImage && (
            <div className="flex gap-2 items-start">
              <img src={frontImage} alt="表面" className="h-14 w-auto rounded-lg border border-gray-200 object-cover shadow-sm" />
              {backImage && <img src={backImage} alt="裏面" className="h-14 w-auto rounded-lg border border-gray-200 object-cover shadow-sm" />}
              <button onClick={() => setStep('upload')} className="text-xs text-gray-400 hover:text-orange-600 underline mt-auto">
                撮り直す
              </button>
            </div>
          )}

          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <p className="text-sm font-medium text-gray-700">読み取り結果</p>
              <div className="flex gap-3 text-xs text-gray-400">
                <span className="flex items-center gap-1"><CheckCircle2 size={11} className="text-green-500" />高信頼</span>
                <span className="flex items-center gap-1"><AlertCircle size={11} className="text-yellow-500" />要確認</span>
                <span className="flex items-center gap-1"><AlertCircle size={11} className="text-red-400" />低信頼</span>
              </div>
            </div>
            <div className="divide-y divide-gray-50">
              {ocrFields.map((f) => {
                const cfg = CONFIDENCE_CONFIG[f.confidence]
                const Ico = cfg.icon
                const isEdited = fields[f.key] !== f.value
                return (
                  <div key={f.key} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2 sm:contents">
                      <span className="text-xs text-gray-400 font-medium sm:w-14 sm:flex-shrink-0">{f.label}</span>
                      <div className={cn('sm:hidden flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border flex-shrink-0', cfg.bg)}>
                        <Ico size={10} className={cfg.text} />
                        <span className={cfg.text}>{cfg.label}</span>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={fields[f.key]}
                      onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))}
                      className={cn(
                        'flex-1 min-w-0 px-2.5 py-2 sm:py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500',
                        isEdited ? 'border-orange-400 bg-orange-50' : 'border-gray-200 bg-gray-50'
                      )}
                    />
                    <div className={cn('hidden sm:flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border flex-shrink-0', cfg.bg)}>
                      <Ico size={10} className={cfg.text} />
                      <span className={cfg.text}>{cfg.label}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex justify-between gap-2">
            <Button variant="secondary" className="min-h-11" onClick={() => setStep('upload')}>戻る</Button>
            <Button className="min-h-11" onClick={handleNextFromReview}>次へ：取得状況</Button>
          </div>
        </div>
      )}

      {/* ─── Manual fields step ─── */}
      {step === 'manual_fields' && (
        <div className="space-y-4">
          {/* Early duplicate warning */}
          {duplicate && (fields.name || fields.company) && (
            <div className="flex items-start gap-2 px-4 py-3 bg-yellow-50 border border-yellow-300 rounded-xl text-sm text-yellow-800">
              <AlertCircle size={15} className="flex-shrink-0 text-yellow-500 mt-0.5" />
              <span>
                <strong>{duplicate.name}</strong>（{duplicate.companies?.name}）が既に登録されています。
                <button onClick={() => router.push(`/contacts/${duplicate.id}`)} className="ml-1 underline">確認する</button>
              </span>
            </div>
          )}

          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-700">基本情報</p>
            </div>
            <div className="p-4 space-y-3">
              {(Object.keys(FIELD_LABELS) as (keyof ContactFields)[]).map((key) => {
                const { label, required } = FIELD_LABELS[key]
                const error = fieldErrors[key]
                return (
                  <div key={key}>
                    <div className="flex items-center gap-3">
                      <label className="w-16 text-xs text-gray-500 font-medium flex-shrink-0">
                        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
                      </label>
                      <input
                        type={key === 'email' ? 'email' : 'text'}
                        value={fields[key]}
                        onChange={(e) => {
                          setFields((p) => ({ ...p, [key]: e.target.value }))
                          if (fieldErrors[key]) setFieldErrors((p) => ({ ...p, [key]: undefined }))
                        }}
                        className={cn(
                          'flex-1 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2',
                          error
                            ? 'border-red-400 bg-red-50 focus:ring-red-400'
                            : 'border-gray-200 bg-gray-50 focus:ring-orange-500'
                        )}
                        placeholder={
                          key === 'name' ? '山田 太郎' :
                          key === 'company' ? '株式会社〇〇' :
                          key === 'position' ? '営業部長' :
                          key === 'email' ? 'example@company.co.jp' :
                          key === 'phone' ? '03-0000-0000' :
                          key === 'mobile' ? '090-0000-0000' :
                          key === 'address' ? '東京都渋谷区...' :
                          key === 'website' ? 'https://...' : ''
                        }
                      />
                    </div>
                    {error && <p className="text-xs text-red-500 mt-1 pl-[76px]">{error}</p>}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex justify-between gap-2">
            <Button variant="secondary" className="min-h-11" onClick={() => { setFlow(null); setStep('select') }}>戻る</Button>
            <Button className="min-h-11" onClick={handleNextFromManualFields}>次へ：取得状況</Button>
          </div>
        </div>
      )}

      {/* ─── Meta step ─── */}
      {step === 'meta' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                どこで取得しましたか？
              </label>
              <input
                type="text"
                value={meetingContext}
                onChange={(e) => setMeetingContext(e.target.value)}
                placeholder="例: 〇〇展示会、紹介（田中さん経由）、飛び込み..."
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                  focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">拠点</label>
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setLocation('')}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                    !location ? 'bg-orange-500 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  )}
                >
                  未設定
                </button>
                {LOCATIONS.map((loc) => (
                  <button
                    key={loc.id}
                    type="button"
                    onClick={() => setLocation(location === loc.id ? '' : loc.id)}
                    className={cn(
                      'inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                      location === loc.id
                        ? loc.color + ' ring-2 ring-offset-1 ring-current'
                        : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                    )}
                  >
                    <MapPin size={12} />
                    {loc.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                タグ（スペース区切りで複数入力）
              </label>
              <input
                type="text"
                value={customTags}
                onChange={(e) => setCustomTags(e.target.value)}
                placeholder="例: VIP キーマン 要フォロー"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                  focus:outline-none focus:ring-2 focus:ring-orange-500 bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">登録先事業部</label>
              <div className="px-3 py-2 bg-orange-50 border border-orange-100 rounded-lg text-sm font-medium text-orange-700">
                {activeDivision?.name ?? '—'}
              </div>
            </div>
          </div>

          <div className="flex justify-between gap-2">
            <Button variant="secondary" className="min-h-11" onClick={() => setStep(flow === 'card' ? 'review' : 'manual_fields')}>戻る</Button>
            <Button className="min-h-11" onClick={() => setStep('confirm')}>次へ：確認</Button>
          </div>
        </div>
      )}

      {/* ─── Confirm step ─── */}
      {step === 'confirm' && (
        <div className="space-y-4">
          {/* Duplicate warning with merge option */}
          {duplicate && (
            <div className="flex items-start gap-3 px-4 py-4 bg-yellow-50 border border-yellow-300 rounded-xl text-sm text-yellow-800">
              <AlertCircle size={16} className="flex-shrink-0 text-yellow-500 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold mb-1">類似顧客が既に登録されています</p>
                <p className="text-sm">
                  <strong>{duplicate.name}</strong>（{duplicate.companies?.name}）が
                  {activeDivision?.name}に登録済みです。同一人物の可能性があります。
                </p>
                <div className="flex gap-2 mt-2 flex-wrap">
                  <Button size="sm" variant="secondary" onClick={() => router.push(`/contacts/${duplicate.id}`)}>
                    既存顧客を確認
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => {}}>
                    別人として登録続行
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Preview */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-4">登録内容プレビュー</p>
            <div className="flex items-start gap-3 sm:gap-4 mb-4">
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-orange-100 flex items-center justify-center
                text-orange-600 font-black text-lg flex-shrink-0">
                {fields.name ? getInitials(fields.name) : '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-lg font-bold text-gray-800 truncate">{fields.name || '（未入力）'}</p>
                {fields.position && <p className="text-sm text-gray-500 truncate">{fields.position}</p>}
                <p className="text-sm font-medium text-gray-600 truncate">{fields.company || '（未入力）'}</p>
              </div>
              {flow === 'card' && frontImage && (
                <img src={frontImage} alt="" className="h-12 sm:h-14 rounded-lg object-cover border border-gray-200 opacity-80 ml-auto flex-shrink-0" />
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-500">
              {fields.email   && <span className="flex items-center gap-1"><Mail size={11} />{fields.email}</span>}
              {fields.phone   && <span className="flex items-center gap-1"><Phone size={11} />{fields.phone}</span>}
              {fields.mobile  && <span className="flex items-center gap-1"><Phone size={11} />携帯: {fields.mobile}</span>}
              {fields.website && <span className="flex items-center gap-1"><Globe size={11} />{fields.website}</span>}
              {meetingContext && <span className="flex items-center gap-1"><MapPin size={11} />{meetingContext}</span>}
              {location       && <span className="flex items-center gap-1"><MapPin size={11} />{location}拠点</span>}
              {customTags && customTags.trim().split(/\s+/).map((t) => (
                <span key={t} className="inline-flex items-center px-2 py-0.5 bg-gray-100 rounded-full text-gray-600">{t}</span>
              ))}
            </div>

            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-400">
              <Building2 size={11} />
              <span>{activeDivision?.name ?? '—'} に登録</span>
            </div>
          </div>

          <div className="flex justify-between gap-2">
            <Button variant="secondary" className="min-h-11" onClick={() => setStep('meta')}>戻って修正</Button>
            <Button className="min-h-11" loading={saving} onClick={handleSave} icon={<CheckCircle2 size={15} />}>
              登録する
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
