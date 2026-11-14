// 智能填表：把群里的回款消息、水单截图交给服务端（Edge Function “receipt-ai”）让 Claude 认出来，
// 再在这里对到系统里的账户、车辆、客户上，变成到账录入页能直接填的内容。
// Claude 只负责“看懂”，不写数据库；填进表单以后由财务核对、保存。
import { FunctionsHttpError } from '@supabase/supabase-js'
import { money, num, round2, todayAccra } from './format'
import { currentLang, tr } from './i18n'
import { defaultNature } from './natures'
import type { SubmissionClaim } from './submissions'
import { supabase, VOUCHER_BUCKET } from './supabase'
import type { Account, Customer, Salesperson, Vehicle } from './supabase'

// ---------------------------------------------------------------- 服务端认出来的内容
export type AiLine = {
  customer: string
  model: string
  vins: string[]
  nature: string
  amount: number
  salesperson: string
  salesperson_id: number
  note: string
}

export type AiReceipt = {
  date: string
  currency: 'GHS' | 'USD' | ''
  amount: number
  account_id: number
  account_text: string
  fx_rate: number
  cheque_no: string
  bank_ref: string
  payer: string
  lines: AiLine[]
}

export type AiResult = { receipts: AiReceipt[]; warnings: string[]; model: string }
export type AiFile = { media_type: string; data: string }

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('receipt-ai', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const j = (await error.context.json().catch(() => null)) as { error?: string } | null
      throw new Error(j?.error ?? tr('操作失败，请稍后再试'))
    }
    throw new Error(tr('网络连接失败，请检查网络后重试'))
  }
  if (!(data as { ok?: boolean } | null)?.ok) throw new Error(tr('操作失败，请稍后再试'))
  return data as T
}

/** 管理员有没有配好 Claude 的 API 密钥 */
export async function aiConfigured(): Promise<boolean> {
  const r = await call<{ configured?: boolean }>({ action: 'status' })
  return r.configured === true
}

export async function recognize(text: string, files: AiFile[]): Promise<AiResult> {
  const r = await call<Partial<AiResult>>({ action: 'recognize', text, files, lang: currentLang(), today: todayAccra() })
  return { receipts: r.receipts ?? [], warnings: r.warnings ?? [], model: r.model ?? '' }
}

// ---------------------------------------------------------------- 凭证里的图片、PDF
/**
 * 智能填表的总开关。Rome 2026-11-14“把智能填表关了吧”：默认关，新建到账里不显示这张卡片，也不会调用识别服务。
 * 识别服务（Edge Function receipt-ai）和密钥都留着；要开回来，打包时带上 VITE_AI_FILL=on（发布流程 deploy.yml 的 build 那一步）。
 */
export const AI_FILL_ENABLED = import.meta.env.VITE_AI_FILL === 'on'

export const MAX_AI_FILES = 4
const MAX_PDF_BYTES = 4 * 1024 * 1024
const MAX_SEND_BYTES = 6 * 1024 * 1024
const LONG_EDGE = 2000

/** 这个凭证能不能拿去识别（图片或 PDF） */
export function aiReadable(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif|pdf)$/i.test(path)
}

// 图片统一缩到长边 2000、转成 JPEG：手机拍的水单动辄几 MB，缩完字还看得清，传得快也省钱
async function toJpeg(blob: Blob): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, LONG_EDGE / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  } catch {
    return null
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '')
    fr.onerror = () => reject(fr.error ?? new Error('read failed'))
    fr.readAsDataURL(blob)
  })
}

/** 把已经传好的凭证取回来，准备成能发给 Claude 的样子；用不了的写在 notes 里 */
export async function prepareFiles(paths: string[]): Promise<{ files: AiFile[]; notes: string[] }> {
  const notes: string[] = []
  const usable = paths.filter(aiReadable)
  if (usable.length > MAX_AI_FILES) notes.push(tr('凭证超过 {n} 个，只识别了前 {n} 个', { n: MAX_AI_FILES }))
  const files: AiFile[] = []
  let total = 0
  for (const path of usable.slice(0, MAX_AI_FILES)) {
    const name = (path.split('/').pop() ?? path).slice(9) || path
    const { data: blob, error } = await supabase.storage.from(VOUCHER_BUCKET).download(path)
    if (error || !blob) {
      notes.push(tr('凭证 {name} 读不出来，没有识别', { name }))
      continue
    }
    let out: Blob | null = blob
    let type = 'application/pdf'
    if (/\.pdf$/i.test(path)) {
      if (blob.size > MAX_PDF_BYTES) {
        notes.push(tr('凭证 {name} 太大（PDF 最多 4 MB），没有识别', { name }))
        continue
      }
    } else {
      out = await toJpeg(blob)
      type = 'image/jpeg'
      if (!out) {
        notes.push(tr('凭证 {name} 这种图片浏览器打不开，没有识别，请换成截图或 JPG', { name }))
        continue
      }
    }
    if (total + out.size > MAX_SEND_BYTES) {
      notes.push(tr('凭证加起来太大，{name} 没有识别', { name }))
      continue
    }
    total += out.size
    files.push({ media_type: type, data: await toBase64(out) })
  }
  return { files, notes }
}

// ---------------------------------------------------------------- 对到系统里的车、客户、账户
export type AiClaim = {
  nature?: string
  vehicle_id?: number | null
  customer_id?: number | null
  amount_orig?: number | null
  report_note?: string
  model_desc?: string
  salesperson_id?: number | null
  /** 没对上车时：识别到的客户、车型、大架号（页面上提示，也给“新增车辆”预填） */
  sub?: SubmissionClaim
}

export type AiFilled = {
  header: {
    account_id?: number
    receipt_date?: string
    amount_orig?: number
    fx_rate?: number
    payer_summary?: string
    cheque_no?: string
    bank_ref?: string
  }
  claims: AiClaim[]
  vehicles: Vehicle[]
  /** 要人核对的地方 */
  notes: string[]
}

type Ctx = {
  accountById: Map<number, Account>
  customers: Customer[]
  salespersons: Salesperson[]
}

const norm = (s: string) => s.toUpperCase().replace(/[^0-9A-Z一-鿿]+/g, '')

/** 按名字找客户：先找一模一样的（不分大小写、空格、标点）；没有再找唯一一个互相包含的 */
export function matchCustomer(name: string, customers: Customer[]): { id: number | null; exact: boolean; name: string } {
  const none = { id: null, exact: false, name: '' }
  const q = norm(name)
  if (!q) return none
  const same = customers.filter((c) => norm(c.name) === q)
  if (same.length === 1) return { id: same[0].id, exact: true, name: same[0].name }
  if (same.length > 1 || q.length < 5) return none
  const near = customers.filter((c) => {
    const n = norm(c.name)
    return n.length >= 5 && (n.includes(q) || q.includes(n))
  })
  return near.length === 1 ? { id: near[0].id, exact: false, name: near[0].name } : none
}

type Hit = { v: Vehicle; how: 'exact' | 'fixed' | 'tail' }
// 大架号里没有字母 O、I、Q，抄错的时候当成数字再找一次
const fixVin = (s: string) => s.replace(/[OQ]/g, '0').replace(/I/g, '1')

async function findVehicles(vins: string[]): Promise<Map<string, Hit>> {
  const out = new Map<string, Hit>()
  const want = [...new Set(vins)]
  if (!want.length) return out
  const tries = [...new Set(want.flatMap((v) => (v.length === 17 ? [v, fixVin(v)] : [v])))]
  const { data, error } = await supabase.from('v_vehicle_ledger').select('*').in('vin', tries)
  if (error) throw error
  const byVin = new Map((data ?? []).map((v) => [String(v.vin).toUpperCase(), v]))
  for (const vin of want) {
    const a = byVin.get(vin)
    if (a) {
      out.set(vin, { v: a, how: 'exact' })
      continue
    }
    const b = vin.length === 17 ? byVin.get(fixVin(vin)) : undefined
    if (b) {
      out.set(vin, { v: b, how: 'fixed' })
      continue
    }
    if (vin.length < 6) continue
    // 完整的大架号：不分大小写再找一次；只写了后几位的：按结尾找，只有一台才算对上
    const full = vin.length >= 17
    const r = await supabase
      .from('v_vehicle_ledger')
      .select('*')
      .ilike('vin', full ? vin : `%${vin}`)
      .limit(2)
    if (r.error) throw r.error
    if (r.data?.length === 1) out.set(vin, { v: r.data[0], how: full ? 'exact' : 'tail' })
  }
  return out
}

/** 一笔钱付几台车、材料里没写每台多少：各台的余额加起来正好就按余额分，不然平均分 */
function splitAmount(total: number, hits: (Hit | undefined)[], rate: number): { amounts: number[]; how: 'one' | 'balance' | 'even' } {
  const k = hits.length
  if (k <= 1 || !(total > 0)) return { amounts: hits.map(() => total), how: 'one' }
  const rest = (list: number[]) => [...list.slice(0, -1), round2(total - list.slice(0, -1).reduce((s, x) => s + x, 0))]
  if (rate > 0 && hits.every((h) => h && num(h.v.balance_usd) > 0)) {
    const want = hits.map((h) => round2(num(h?.v.balance_usd) * rate))
    const sum = want.reduce((s, x) => s + x, 0)
    if (Math.abs(sum - total) <= Math.max(1, total * 0.01)) return { amounts: rest(want), how: 'balance' }
  }
  return { amounts: rest(hits.map(() => round2(total / k))), how: 'even' }
}

/** 把认出来的一笔到账，对到系统里的账户、车、客户上 */
export async function resolveAi(r: AiReceipt, ctx: Ctx): Promise<AiFilled> {
  const notes = new Set<string>()
  const header: AiFilled['header'] = {}

  const acc = r.account_id ? ctx.accountById.get(r.account_id) : undefined
  if (acc?.active) header.account_id = acc.id
  else
    notes.add(
      r.account_text ? tr('没认出收款账户（材料里写的是“{text}”），请手选', { text: r.account_text }) : tr('没认出收款账户，请手选'),
    )
  const account = acc?.active ? acc : undefined
  const currency = account?.currency ?? r.currency
  if (account && r.currency && account.currency !== r.currency)
    notes.add(tr('收款账户是 {a} 账户，识别到的币种是 {b}，请核对', { a: account.currency, b: r.currency }))
  if (r.date) header.receipt_date = r.date
  else notes.add(tr('没认出到账日期，先按今天，请核对'))
  if (r.amount > 0) header.amount_orig = r.amount
  else notes.add(tr('没认出到账金额，请手填'))
  if (currency !== 'USD') {
    if (r.fx_rate > 0) header.fx_rate = r.fx_rate
    else notes.add(tr('材料里没写汇率，请核对汇率'))
  }
  if (r.payer) header.payer_summary = r.payer
  if (r.cheque_no) header.cheque_no = r.cheque_no
  if (r.bank_ref) header.bank_ref = r.bank_ref

  const found = await findVehicles(r.lines.flatMap((l) => l.vins))
  const rate = currency === 'USD' ? 1 : r.fx_rate
  const spName = (id: number | null | undefined) => ctx.salespersons.find((s) => s.id === id)?.name ?? ''
  const claims: AiClaim[] = []
  const vehicles: Vehicle[] = []

  for (const l of r.lines) {
    const lineAmount = l.amount > 0 ? l.amount : r.lines.length === 1 && r.amount > 0 ? r.amount : 0
    const cust = matchCustomer(l.customer, ctx.customers)
    // 每个大架号一行；一个大架号都没写的也占一行
    const vins: (string | null)[] = l.vins.length ? l.vins : [null]
    const hits = vins.map((vin) => (vin ? found.get(vin) : undefined))
    const split = splitAmount(lineAmount, hits, rate)
    if (split.how !== 'one')
      notes.add(
        split.how === 'balance'
          ? tr('第 {n} 行起：{amt} 付 {k} 台车，材料里没写每台多少，按各台的余额分的，请核对', {
              n: claims.length + 1,
              amt: money(lineAmount),
              k: vins.length,
            })
          : tr('第 {n} 行起：{amt} 付 {k} 台车，材料里没写每台多少，先平均分了，请改成实际金额', {
              n: claims.length + 1,
              amt: money(lineAmount),
              k: vins.length,
            }),
      )

    vins.forEach((vin, i) => {
      const n = claims.length + 1
      const hit = hits[i]
      const amount = split.amounts[i] > 0 ? split.amounts[i] : null
      if (!amount) notes.add(tr('第 {n} 行没认出金额，请填', { n }))
      if (hit) {
        const v = hit.v
        vehicles.push(v)
        if (hit.how === 'tail') notes.add(tr('大架号 {a} 按后几位对上了系统里的 {b}，请核对', { a: vin, b: v.vin }))
        if (hit.how === 'fixed')
          notes.add(tr('大架号 {a} 系统里没有，对上了相近的 {b}（字母 O、I 当成了数字），请核对', { a: vin, b: v.vin }))
        const mine = norm(l.customer)
        const theirs = norm(v.customer_name ?? '')
        if (mine && theirs && !(mine.includes(theirs) || theirs.includes(mine)) && cust.id !== v.customer_id)
          notes.add(tr('大架号 {vin} 在系统里是“{a}”的车，材料里写的客户是“{b}”，请核对', { vin: v.vin, a: v.customer_name, b: l.customer }))
        if (l.salesperson_id && v.salesperson_id && l.salesperson_id !== v.salesperson_id)
          notes.add(
            tr('大架号 {vin} 在系统里的业务员是 {a}，材料里写的是 {b}，请核对', {
              vin: v.vin,
              a: v.salesperson_name ?? spName(v.salesperson_id),
              b: spName(l.salesperson_id) || l.salesperson,
            }),
          )
        claims.push({
          nature: l.nature || defaultNature(v),
          vehicle_id: v.id,
          customer_id: v.customer_id,
          amount_orig: amount,
          report_note: l.note,
        })
        return
      }
      // 没对上车：先按“大架号未锁定”记到客户名下
      if (vin) notes.add(tr('大架号 {vin} 系统里没找到：可以点 + 新增这台车，或者先记到客户名下以后再选车', { vin }))
      if (!l.customer) notes.add(tr('第 {n} 行没认出客户，请手选', { n }))
      else if (!cust.id) notes.add(tr('客户“{name}”系统里没找到，或者有几个相近的，请手选或新建', { name: l.customer }))
      else if (!cust.exact) notes.add(tr('客户“{a}”对上了系统里的“{b}”，请核对', { a: l.customer, b: cust.name }))
      if (!l.nature) notes.add(tr('第 {n} 行没认出款项性质，请选', { n }))
      const custSp = cust.id ? (ctx.customers.find((c) => c.id === cust.id)?.salesperson_id ?? null) : null
      claims.push({
        nature: l.nature || undefined,
        vehicle_id: null,
        customer_id: cust.id,
        amount_orig: amount,
        report_note: l.note,
        model_desc: l.model,
        salesperson_id: l.salesperson_id || custSp,
        sub: { customer_id: cust.id, customer_name: l.customer, vin: vin ?? '', model: l.model },
      })
    })
  }

  const total = round2(claims.reduce((s, c) => s + num(c.amount_orig), 0))
  if (!r.lines.length) notes.add(tr('没认出这笔钱是哪台车、哪个客户的，请自己拆分'))
  else if (r.amount > 0 && total > r.amount + 0.005)
    notes.add(tr('拆分加起来 {a}，比到账金额 {b} 多，请核对', { a: money(total), b: money(r.amount) }))
  else if (r.amount > 0 && total > 0 && total < r.amount - 0.005)
    notes.add(tr('拆分加起来 {a}，比到账金额 {b} 少，剩下的还没分到车上', { a: money(total), b: money(r.amount) }))

  return { header, claims, vehicles, notes: [...notes] }
}

// ---------------------------------------------------------------- 一次认出好几笔到账
// 一张表只能录一笔，剩下的先记在这里（只在这个页面的内存里），下次新建到账时接着填，不用再认一遍
export type AiSession = {
  uid: string
  at: number
  result: AiResult
  /** 识别时带的凭证，下一笔接着挂上 */
  attachments: string[]
  /** 凭证没识别上的说明 */
  fileNotes: string[]
  /** 已经保存成到账的是第几笔 */
  saved: number[]
}

const KEEP_MS = 2 * 60 * 60 * 1000
let session: AiSession | null = null

export const aiSession = {
  get(uid: string | undefined): AiSession | null {
    if (!session || session.uid !== uid || Date.now() - session.at > KEEP_MS) return null
    return session
  },
  set(s: AiSession | null) {
    session = s
  },
  /** 第 index 笔已经保存了；都保存完就清掉 */
  markSaved(index: number) {
    if (!session || session.saved.includes(index)) return
    session = { ...session, saved: [...session.saved, index] }
    if (session.saved.length >= session.result.receipts.length) session = null
  },
}
