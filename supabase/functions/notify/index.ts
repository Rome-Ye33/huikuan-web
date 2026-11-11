// 待办提醒（Supabase Edge Function “notify”）：有新的待办时，发一封邮件给该处理的人
// - flush：数据库有新提醒时、以及每分钟定时（pg_cron）调用，请求头带 x-notify-secret
//          （口令上线时由数据库随机生成、存在 Vault，这里请数据库 notify_check_secret 核对，谁都不用经手）。
//          从数据库取待发的提醒（notify_claim_email），一封封发出去，再把结果报回去（notify_done）。
// - test：登录的人给自己发一封测试邮件，看收不收得到（页头“邮件提醒”里的“发一封测试邮件”）。
// - check：也要带口令。只连一下发信服务器、试试发信邮箱能不能登录，不发邮件（排查用，从数据库里叫）。
//
// 用 SMTP 发信，默认 Gmail（smtp.gmail.com 的 465 端口；Supabase 不让连 25 和 587 端口）。
// 密钥（Supabase → Edge Functions → Secrets）：
//   SMTP_USER   发信邮箱，比如 xxx@gmail.com
//   SMTP_PASS   这个邮箱的应用专用密码（Gmail：开了两步验证以后在“应用专用密码”里生成的 16 位，中间的空格有没有都行）
//   SMTP_HOST、SMTP_PORT（可选，默认 smtp.gmail.com、465；用公司邮箱时按邮箱服务商给的填，比如腾讯企业邮 smtp.exmail.qq.com、465）
//   MAIL_FROM_NAME（可选，发件人名字，默认“销售管理 Sales Management”）
//   SITE_URL（可选，邮件里按钮打开的网址，默认 https://rome-ye33.github.io/huikuan-web/）
// 部署时 verify_jwt = false：flush、check 用口令校验，test 自己校验登录。服务端密钥只在 Supabase 服务器上用，不会进浏览器。
import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@7'

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

const SMTP_HOST = (Deno.env.get('SMTP_HOST') || 'smtp.gmail.com').trim()
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT')) || 465
const SMTP_USER = (Deno.env.get('SMTP_USER') ?? '').trim()
const SMTP_PASS = (Deno.env.get('SMTP_PASS') ?? '').replace(/\s+/g, '') // Gmail 显示的应用专用密码中间有空格
const FROM_NAME = (Deno.env.get('MAIL_FROM_NAME') || '销售管理 Sales Management').trim()
const SITE = (Deno.env.get('SITE_URL') || 'https://rome-ye33.github.io/huikuan-web/').trim().replace(/\/*$/, '/')
const BATCH = 20
const MAX_ROUNDS = 3 // 一次最多 3 批（60 封），剩下的等下一分钟的定时任务
const TIME_BUDGET = 60_000 // 发了一分钟还没发完的，也等下一分钟

const configured = () => SMTP_USER !== '' && SMTP_PASS !== ''

type Claim = { id: number; to_email: string | null; to_name: string | null; lang: string | null; body: string | null; go: string | null }
// 发送结果。没发出去的：kind = auth 发信邮箱登录不上 / net 连不上发信服务器 / quota 今天发太多了；stop = 这一批剩下的也发不出去，先停下
type Failure = { status: 'retry' | 'failed' | 'skipped'; error: string; detail?: string; kind?: 'auth' | 'net' | 'quota'; stop?: boolean }
type Result = { status: 'sent'; id: string } | Failure
type MailErr = { code?: string; responseCode?: number; response?: string; message?: string }
type Transport = {
  sendMail: (m: Record<string, unknown>) => Promise<{ messageId?: string }>
  verify: () => Promise<unknown>
  close: () => void
}

function transport(pool: boolean): Transport {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // 465 一连上就加密；别的端口先连上再升级加密（STARTTLS），不加密不发
    requireTLS: SMTP_PORT !== 465,
    auth: configured() ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    pool,
    maxConnections: 1,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  }) as Transport
}

// flush、check 带的口令对不对：请数据库和 Vault 里的 notify_secret 核对
async function flushAllowed(given: string): Promise<boolean> {
  if (!given) return false
  const { data, error } = await db.rpc('notify_check_secret', { p_secret: given })
  if (error) console.error('notify_check_secret', error.message)
  return !error && data === true
}

// ---------------------------------------------------------------- 邮件的样子
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

type Mail = { subject: string; text: string; html: string }

/** 一封提醒邮件。text = 提醒的文字（数据库 notify_text 写好的那一段）；空的 = 测试邮件。name 空的就不称呼名字 */
function compose(lang: string | null, name: string | null, text: string | null, go: string): Mail {
  const en = lang === 'en'
  const test = text === null
  const what = test ? '' : oneLine(text)
  const who = name ? oneLine(name) : ''
  const link = `${SITE}?go=${encodeURIComponent(go)}`
  const subject = test
    ? en ? '[Sales Management] Test email' : '【销售管理】测试邮件'
    : en ? `[Sales Management] ${cut(cap(what), 150)}` : `【销售管理】${cut(what, 100)}`
  const greeting = en ? (who ? `Hello ${who},` : 'Hello,') : who ? `${who}，你好：` : '你好：'
  const line = test
    ? en
      ? 'This is a test email. When something is waiting for you, you will get an email like this.'
      : '这是一封测试邮件。以后有待办，会像这样发到这个邮箱。'
    : en
      ? `You have a new to-do in Sales Management: ${what}.`
      : `你在销售管理系统有一项新的待办：${what}。`
  const button = test ? (en ? 'Open the workbench' : '打开工作台') : en ? 'Open it' : '打开处理'
  const opens = test
    ? en ? 'The button opens the website. After you sign in, it goes to the workbench.' : '点按钮会打开网站，登录后到工作台。'
    : en ? 'The button opens the website. After you sign in, it goes straight to this item.' : '点按钮会打开网站，登录后直接到这张单。'
  const foot = en
    ? `${opens} To stop these emails, turn them off under “Email reminders” at the top right of the website. This email was sent automatically. Please do not reply.`
    : `${opens}不想收到这类邮件，可以在网站右上角“邮件提醒”里关掉。这封邮件由系统自动发出，请不要回复。`
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',Arial,sans-serif"
  const html = `<!doctype html>
<html lang="${en ? 'en' : 'zh-CN'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f6fb">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:${font};font-size:15px;line-height:1.6;color:#1f2937">
<div style="margin:0 0 12px;font-size:16px;font-weight:600;color:#1d4ed8">${en ? 'Sales Management' : '销售管理'}</div>
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:24px">
<p style="margin:0 0 12px">${esc(greeting)}</p>
<p style="margin:0 0 20px">${esc(line)}</p>
<a href="${esc(link)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 24px;border-radius:6px">${esc(button)}</a>
</div>
<p style="margin:16px 0 0;font-size:12px;color:#6b7280">${esc(foot)}</p>
</div>
</body></html>`
  const textBody = `${greeting}\n\n${line}\n\n${button}${en ? ': ' : '：'}${link}\n\n${foot}\n`
  return { subject, text: textBody, html }
}

// ---------------------------------------------------------------- 发信
const NET_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ETLS', 'EPROTOCOL', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH'])

// 发信服务器回的话：好几行的（550-5.1.1 …\n550 5.1.1 …）合成一行，代码只留开头一个
function smtpText(resp: string): string {
  const lines = resp.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const head = /^(\d{3})[ -](?:(\d\.\d{1,3}\.\d{1,3}) )?/.exec(lines[0] ?? '')
  if (!head) return oneLine(resp)
  const rest = lines.map((l) => l.replace(/^\d{3}[ -](?:\d\.\d{1,3}\.\d{1,3} )?/, '')).join(' ')
  return oneLine(`${head[1]}${head[2] ? ' ' + head[2] : ''} ${rest}`)
}

// 4xx、连不上、超时：过一会儿再发；5xx（收件人不存在、地址不对）：不重发。
// 登录不上、连不上发信服务器、今天发太多了：这一批剩下的也发不出去，先停下（stop）
function mailError(e: unknown): Failure {
  const err = (e ?? {}) as MailErr
  const rc = Number(err.responseCode) || 0
  const detail = (err.response ? smtpText(err.response) : oneLine(`${err.code ?? ''} ${err.message ?? String(e)}`)).slice(0, 300)
  if (err.code === 'EAUTH') return { status: 'retry', error: '发信邮箱登录不上：' + detail, detail, kind: 'auth', stop: true }
  if (/5\.4\.5|sending (limit|quota) exceeded/i.test(detail)) return { status: 'failed', error: '发信邮箱今天发太多了：' + detail, detail, kind: 'quota', stop: true }
  if (rc >= 500) return { status: 'failed', error: detail, detail }
  if (rc >= 400) return { status: 'retry', error: detail, detail }
  if (NET_CODES.has(err.code ?? '')) return { status: 'retry', error: '连不上发信服务器：' + detail, detail, kind: 'net', stop: true }
  if (err.code === 'EENVELOPE' || err.code === 'EMESSAGE') return { status: 'failed', error: detail, detail }
  return { status: 'retry', error: detail, detail }
}

async function sendMail(t: Transport, to: string, mail: Mail): Promise<Result> {
  try {
    const info = await t.sendMail({ from: { name: FROM_NAME, address: SMTP_USER }, to, ...mail })
    return { status: 'sent', id: String(info?.messageId ?? '') }
  } catch (e) {
    return mailError(e)
  }
}

async function report(id: number, res: Result) {
  const done = await db.rpc('notify_done', {
    p_id: id,
    p_status: res.status,
    p_wa_id: res.status === 'sent' ? res.id : null, // 邮件的 Message-ID
    p_error: res.status === 'sent' ? null : res.error,
  })
  if (done.error) console.error('notify_done', id, done.error.message)
}

async function flush(): Promise<Response> {
  const count = { sent: 0, retry: 0, failed: 0, skipped: 0 }
  const started = Date.now()
  let t: Transport | null = null
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { data, error } = await db.rpc('notify_claim_email', { p_limit: BATCH })
      if (error) return reply(500, { error: error.message })
      const rows = (data ?? []) as Claim[]
      let stopped: Failure | null = null
      for (const r of rows) {
        let res: Result
        if (stopped) res = stopped // 登录不上、连不上：这一批剩下的不去试，一起等下次
        else if (!configured()) res = { status: 'skipped', error: '邮件提醒还没配置好' }
        else if (!r.to_email || !r.body || !r.go) res = { status: 'skipped', error: '没有邮箱或内容' }
        else {
          t ??= transport(true)
          res = await sendMail(t, r.to_email, compose(r.lang, r.to_name, r.body, r.go))
          if (res.status !== 'sent' && res.stop) stopped = res
        }
        await report(r.id, res)
        count[res.status]++
      }
      if (stopped || rows.length < BATCH || Date.now() - started > TIME_BUDGET) break
    }
  } finally {
    t?.close()
  }
  return reply(200, { ok: true, ...count })
}

// 给自己发一封测试邮件
async function test(req: Request): Promise<Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return reply(401, { error: '请先登录' })
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return reply(401, { error: '登录已过期，请重新登录' })
  const { data: prof } = await db.from('profiles').select('email, full_name, notify_lang, role, active').eq('id', data.user.id).maybeSingle()
  if (!prof || !prof.active || !prof.role) return reply(403, { error: '账号还没有开通' })
  const to = String(prof.email ?? '').trim()
  if (!to) return reply(400, { error: '你的账号没有邮箱' })
  if (!configured()) return reply(503, { error: '邮件提醒还没开通，等管理员配置好以后再试' })
  // 没填名字的，注册时名字记成了邮箱：不称呼
  const name = prof.full_name && !String(prof.full_name).includes('@') ? String(prof.full_name) : null
  const t = transport(false)
  let res: Result
  try {
    res = await sendMail(t, to, compose(prof.notify_lang, name, null, 'wb'))
  } finally {
    t.close()
  }
  if (res.status === 'sent') return reply(200, { ok: true, to })
  if (res.kind === 'auth') return reply(502, { error: '发信邮箱登录不上，请管理员检查发信邮箱和应用专用密码：' + res.detail })
  if (res.kind === 'net') return reply(502, { error: '连不上发信服务器：' + res.detail })
  return reply(502, { error: '邮件没有发出去：' + (res.detail ?? res.error) })
}

// 排查时报一下配置：发信邮箱、应用专用密码的位数（Gmail 的是 16 位；不是 16 位多半是填了登录密码、或带了引号）。密码本身不报
const setup = () => ({ configured: configured(), host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, passLength: SMTP_PASS.length })

// 排查：连一下发信服务器、试试发信邮箱能不能登录（不发邮件）。没配发信邮箱时只看连不连得上
async function check(): Promise<Response> {
  const t = transport(false)
  try {
    await t.verify()
    return reply(200, { ok: true, ...setup() })
  } catch (e) {
    return reply(200, { ok: false, ...setup(), error: mailError(e).error })
  } finally {
    t.close()
  }
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
    if (body.action === 'flush' || body.action === 'check') {
      if (!(await flushAllowed(req.headers.get('x-notify-secret') ?? ''))) return reply(401, { error: '口令不对' })
      return body.action === 'flush' ? await flush() : await check()
    }
    if (body.action === 'test') return await test(req)
    return reply(400, { error: '未知操作' })
  } catch (e) {
    console.error(e)
    return reply(500, { error: '操作失败，请稍后再试' })
  }
})
