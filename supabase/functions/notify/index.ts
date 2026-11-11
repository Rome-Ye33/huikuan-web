// 待办提醒（Supabase Edge Function “notify”）：有新的待办时，用 WhatsApp 发一条消息给该处理的人
// - flush：数据库有新提醒时、以及每分钟定时（pg_cron）调用，请求头带 x-notify-secret
//          （口令上线时由数据库随机生成、存在 Vault，这里请数据库 notify_check_secret 核对，谁都不用经手）。
//          从数据库取待发的提醒（notify_claim），一条条发出去，再把结果报回去（notify_done）。
// - test：登录的人给自己发一条测试消息，看号码对不对（页头“WhatsApp 提醒”里的“发一条测试消息”）。
//
// WhatsApp 用 Meta 官方的 WhatsApp Business Platform（Cloud API），消息模板 todo_notice（中文 zh_CN、英文 en，类别 Utility）：
//   正文：你在销售管理系统有一项新的待办：{{1}}。请点下面的按钮打开处理。
//         You have a new to-do in Sales Management: {{1}}. Tap the button below to open it.
//   按钮：访问网站，动态网址 https://rome-ye33.github.io/huikuan-web/?go={{1}}
// 密钥（Supabase → Edge Functions → Secrets）：
//   WHATSAPP_TOKEN            Meta 系统用户的永久令牌
//   WHATSAPP_PHONE_NUMBER_ID  发送号码的编号（WhatsApp Manager 里“Phone number ID”，不是手机号）
//   WHATSAPP_PIN              发送号码的两步验证 6 位数字（自己定；第一次发测试消息时用它把号码注册到 Cloud API）
//   WHATSAPP_TEMPLATE（可选，默认 todo_notice）、WHATSAPP_API_VERSION（可选，默认 v25.0）
//   WHATSAPP_API_BASE（可选，默认 https://graph.facebook.com；本地测试时指到假的服务）
// 部署时 verify_jwt = false：flush 用口令校验，test 自己校验登录。服务端密钥只在 Supabase 服务器上用，不会进浏览器。
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function serverKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>
      const first = parsed.default ?? Object.values(parsed)[0]
      if (first) return first
    } catch {
      // 格式不对就当没有
    }
  }
  throw new Error('服务端密钥没有配置')
}

const db = createClient(Deno.env.get('SUPABASE_URL')!, serverKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
})

const TOKEN = Deno.env.get('WHATSAPP_TOKEN') ?? ''
const PHONE_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? ''
const TEMPLATE = Deno.env.get('WHATSAPP_TEMPLATE') || 'todo_notice'
const VERSION = Deno.env.get('WHATSAPP_API_VERSION') || 'v25.0'
const API_BASE = (Deno.env.get('WHATSAPP_API_BASE') || 'https://graph.facebook.com').replace(/\/+$/, '')
const PIN = Deno.env.get('WHATSAPP_PIN') ?? ''
const BATCH = 20

type Claim = { id: number; to_number: string | null; lang: string | null; body: string | null; go: string | null }
type Result = { status: 'sent'; id: string } | { status: 'retry' | 'failed' | 'skipped'; error: string; code?: number }
type WaReply = {
  success?: boolean
  messages?: { id?: string }[]
  error?: { code?: number; message?: string; error_data?: { details?: string } }
}

// flush 带的口令对不对：请数据库和 Vault 里的 notify_secret 核对
async function flushAllowed(given: string): Promise<boolean> {
  if (!given) return false
  const { data, error } = await db.rpc('notify_check_secret', { p_secret: given })
  if (error) console.error('notify_check_secret', error.message)
  return !error && data === true
}

// WhatsApp 模板参数里不能有换行、制表符、连着好几个空格
const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 700)

// 暂时性的错误：过一会儿再发。号码不对、模板没批、令牌失效这类就不重发了
// 1/2 服务暂时出错，4/80007/130429/131048/131056 发得太快，131000 未知错误，131016 服务不可用
const RETRY_CODES = new Set([1, 2, 4, 80007, 130429, 131000, 131016, 131048, 131056])
// 发送号码还没注册到 Cloud API
const NOT_REGISTERED = 133010

const errorDetail = (status: number, j: WaReply | null) => {
  const err = j?.error ?? {}
  return `${status} ${err.code ?? ''} ${err.error_data?.details ?? err.message ?? ''}`.replace(/\s+/g, ' ').trim()
}

async function sendWhatsApp(to: string, lang: string | null, text: string, go: string): Promise<Result> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/${VERSION}/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: TEMPLATE,
          language: { code: lang === 'en' ? 'en' : 'zh_CN' },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: clean(text) }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: go }] },
          ],
        },
      }),
      signal: AbortSignal.timeout(15000),
    })
  } catch (e) {
    return { status: 'retry', error: '连不上 WhatsApp：' + String(e) }
  }
  const j = (await res.json().catch(() => null)) as WaReply | null
  const id = j?.messages?.[0]?.id
  if (res.ok && id) return { status: 'sent', id }
  const code = Number(j?.error?.code) || undefined
  const retry = res.status === 429 || res.status >= 500 || RETRY_CODES.has(code ?? 0)
  return { status: retry ? 'retry' : 'failed', error: errorDetail(res.status, j), code }
}

// 发送号码要先注册到 Cloud API 才能发，而且只能用接口注册（WhatsApp Manager 里做不了）。
// 注册每 72 小时最多 10 次，所以只在有人点“发一条测试消息”、碰到“号码没注册”时注册一次，定时发提醒时不做。
// 返回 null = 注册好了，否则是原因
async function registerNumber(): Promise<string | null> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/${VERSION}/${PHONE_ID}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin: PIN }),
      signal: AbortSignal.timeout(15000),
    })
  } catch (e) {
    return '连不上 WhatsApp：' + String(e)
  }
  const j = (await res.json().catch(() => null)) as WaReply | null
  return res.ok && j?.success ? null : errorDetail(res.status, j)
}

async function flush(): Promise<Response> {
  const count = { sent: 0, retry: 0, failed: 0, skipped: 0 }
  // 一次最多处理 5 批，剩下的等下一分钟的定时任务
  for (let round = 0; round < 5; round++) {
    const { data, error } = await db.rpc('notify_claim', { p_limit: BATCH })
    if (error) return reply(500, { error: error.message })
    const rows = (data ?? []) as Claim[]
    for (const r of rows) {
      let res: Result
      if (!TOKEN || !PHONE_ID) res = { status: 'skipped', error: 'WhatsApp 还没配置好' }
      else if (!r.to_number || !r.body || !r.go) res = { status: 'skipped', error: '没有号码或内容' }
      else res = await sendWhatsApp(r.to_number, r.lang, r.body, r.go)
      const done = await db.rpc('notify_done', {
        p_id: r.id,
        p_status: res.status,
        p_wa_id: res.status === 'sent' ? res.id : null,
        p_error: res.status === 'sent' ? null : res.error,
      })
      if (done.error) console.error('notify_done', r.id, done.error.message)
      count[res.status]++
    }
    if (rows.length < BATCH) break
  }
  return reply(200, { ok: true, ...count })
}

// 给自己发一条测试消息
async function test(req: Request): Promise<Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return reply(401, { error: '请先登录' })
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return reply(401, { error: '登录已过期，请重新登录' })
  const { data: prof } = await db.from('profiles').select('whatsapp, notify_lang, role, active').eq('id', data.user.id).maybeSingle()
  if (!prof || !prof.active || !prof.role) return reply(403, { error: '账号还没有开通' })
  if (!prof.whatsapp) return reply(400, { error: '请先填 WhatsApp 号码并保存' })
  if (!TOKEN || !PHONE_ID) return reply(503, { error: 'WhatsApp 提醒还没开通，等管理员配置好以后再试' })
  const text =
    prof.notify_lang === 'en'
      ? 'this is a test message. When something is waiting for you, you will get a message like this'
      : '这是一条测试消息，以后有待办会像这样提醒你'
  let res = await sendWhatsApp(prof.whatsapp, prof.notify_lang, text, 'wb')
  if (res.status !== 'sent' && res.code === NOT_REGISTERED) {
    // 第一次用：先把发送号码注册好，再发一次
    if (!/^\d{6}$/.test(PIN)) return reply(503, { error: '发送号码还没注册：请管理员在 Supabase 密钥里加上 WHATSAPP_PIN（6 位数字）以后再试' })
    const failed = await registerNumber()
    if (failed) return reply(502, { error: '发送号码注册没成功：' + failed })
    res = await sendWhatsApp(prof.whatsapp, prof.notify_lang, text, 'wb')
  }
  if (res.status === 'sent') return reply(200, { ok: true })
  return reply(502, { error: 'WhatsApp 没有发出去：' + res.error })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: '只接受 POST' })
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    // 没有内容就当空的
  }
  try {
    if (body.action === 'flush') {
      if (!(await flushAllowed(req.headers.get('x-notify-secret') ?? ''))) return reply(401, { error: '口令不对' })
      return await flush()
    }
    if (body.action === 'test') return await test(req)
    return reply(400, { error: '未知操作' })
  } catch (e) {
    console.error(e)
    return reply(500, { error: '操作失败，请稍后再试' })
  }
})
