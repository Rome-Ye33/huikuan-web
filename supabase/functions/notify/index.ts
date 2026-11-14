// 待办提醒（Supabase Edge Function “notify”）：工作日上午 10 点、下午 4 点（加纳时间），把每个人攒下的新待办合成一封邮件发给他
//   （30 起到账的抄送也在这封里，单独列成“抄送”：不用处理，看一眼就好）
// - flush：数据库每分钟的定时任务（pg_cron）在有到时间的提醒时调用，请求头带 x-notify-secret
//          （口令上线时由数据库随机生成、存在 Vault，这里请数据库 notify_check_secret 核对，谁都不用经手）。
//          从数据库按人取到时间的提醒（notify_claim_digest：一人一组），一人一封发出去，再把这一组的结果一起报回去（notify_done_many）。
//          发送时间在数据库里定（20_todo_digest.sql 的 notify_next_slot）；这里邮件结尾写的“工作日上午 10 点、下午 4 点”要和它一致。
// - test：登录的人给自己发一封测试邮件，看收不收得到（页头“邮件提醒”里的“发一封测试邮件”）。
// - check：也要带口令。只连一下发信服务器、试试发信邮箱能不能登录，不发邮件（排查用，从数据库里叫）。
//
// 用 SMTP 发信，默认 Gmail（smtp.gmail.com 的 465 端口；Supabase 不让连 25 和 587 端口）。
// 密钥（Supabase → Edge Functions → Secrets）：
//   SMTP_USER   发信邮箱，比如 xxx@gmail.com
//   SMTP_PASS   这个邮箱的应用专用密码（Gmail：开了两步验证以后在“应用专用密码”里生成的 16 位，中间的空格有没有都行）
//   SMTP_HOST、SMTP_PORT（可选，默认 smtp.gmail.com、465；用公司邮箱时按邮箱服务商给的填，比如腾讯企业邮 smtp.exmail.qq.com、465）
//   MAIL_FROM_NAME（可选，发件人名字，默认“业财管理 Sales & Finance”）
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
const FROM_NAME = (Deno.env.get('MAIL_FROM_NAME') || '业财管理 Sales & Finance').trim()
const SITE = (Deno.env.get('SITE_URL') || 'https://rome-ye33.github.io/huikuan-web/').trim().replace(/\/*$/, '/')
const BATCH = 20 // 一批 20 个人（一人一封）
const MAX_ROUNDS = 3 // 一次最多 3 批（60 封），剩下的等下一分钟的定时任务
const TIME_BUDGET = 60_000 // 发了一分钟还没发完的，也等下一分钟

const configured = () => SMTP_USER !== '' && SMTP_PASS !== ''

// 数据库给的：一个人攒下的待办（items 按记下的先后）
type Item = { id: number; body: string | null; go: string | null; kind?: string | null } // kind = cc 是抄送，其余是待办
type Digest = { to_email: string | null; to_name: string | null; lang: string | null; items: Item[] | null }
type Todo = { text: string; go: string; cc?: boolean }
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

/** 一封提醒邮件。todos = 这个人攒下的待办和抄送（数据库 notify_text 写好的文字 + 按钮参数，cc = 抄送）；空的 = 测试邮件。name 空的就不称呼名字 */
function compose(lang: string | null, name: string | null, todos: Todo[] | null): Mail {
  const en = lang === 'en'
  const test = todos === null
  const all = (todos ?? []).map((t) => ({ text: oneLine(t.text), link: `${SITE}?go=${encodeURIComponent(t.go)}`, cc: !!t.cc }))
  const list = all.filter((t) => !t.cc) // 待办
  const ccs = all.filter((t) => t.cc) // 抄送（到账生效后抄送给他看的，不用处理）
  const n = list.length
  const m = ccs.length
  const one = list[0]
  const oneCc = ccs[0]
  const who = name ? oneLine(name) : ''
  const wb = `${SITE}?go=wb`
  const greeting = en ? (who ? `Hello ${who},` : 'Hello,') : who ? `${who}，你好：` : '你好：'
  const each = en ? 'Open it' : '打开处理'
  const view = en ? 'View' : '查看'
  // 标题、正文第一句、按钮、按钮打开什么；几项的时候分段列出来（待办一段、抄送一段）
  let subject: string
  let line: string
  let button: string
  let link: string
  let opens: string
  const sections: { heading: string | null; items: typeof all; each: string }[] = []
  if (test) {
    subject = en ? '[Sales & Finance] Test email' : '【业财管理】测试邮件'
    line = en
      ? 'This is a test email. When something is waiting for you, you will get an email like this.'
      : '这是一封测试邮件。以后有待办，会像这样发到这个邮箱。'
    button = en ? 'Open the workbench' : '打开工作台'
    link = wb
    opens = en ? 'The button opens the website. After you sign in, it goes to the workbench.' : '点按钮会打开网站，登录后到工作台。'
  } else if (n === 1 && m === 0) {
    subject = en ? `[Sales & Finance] ${cut(cap(one.text), 150)}` : `【业财管理】${cut(one.text, 100)}`
    line = en ? `You have a new to-do in Sales & Finance: ${one.text}.` : `你在业财管理系统有一项新的待办：${one.text}。`
    button = en ? 'Open it' : '打开处理'
    link = one.link
    opens = en ? 'The button opens the website. After you sign in, it goes straight to this item.' : '点按钮会打开网站，登录后直接到这张单。'
  } else if (n === 0 && m === 1) {
    subject = en ? `[Sales & Finance] CC: ${cut(oneCc.text, 150)}` : `【业财管理】抄送：${cut(oneCc.text, 100)}`
    line = en
      ? `A receipt has been copied to you for information: ${oneCc.text}. Nothing to do, just have a look.`
      : `有一笔到账抄送给你：${oneCc.text}。不用处理，看一眼就好。`
    button = view
    link = oneCc.link
    opens = en ? 'The button opens the website. After you sign in, it goes straight to this receipt.' : '点按钮会打开网站，登录后直接到这笔到账。'
  } else if (m === 0) {
    subject = en ? `[Sales & Finance] You have ${n} new to-dos` : `【业财管理】你有 ${n} 项新的待办`
    line = en ? `You have ${n} new to-dos in Sales & Finance:` : `你在业财管理系统有 ${n} 项新的待办：`
    button = en ? 'Open the workbench' : '打开工作台'
    link = wb
    opens = en
      ? '“Open it” under each item opens the website and, after you sign in, goes straight to that item.'
      : '每项下面的“打开处理”会打开网站，登录后直接到那张单。'
    sections.push({ heading: null, items: list, each })
  } else if (n === 0) {
    subject = en ? `[Sales & Finance] ${m} receipts copied to you` : `【业财管理】有 ${m} 笔到账抄送给你`
    line = en ? `${m} receipts have been copied to you for information. Nothing to do, just have a look:` : `有 ${m} 笔到账抄送给你，不用处理，看一眼就好：`
    button = en ? 'Open the workbench' : '打开工作台'
    link = wb
    opens = en
      ? '“View” under each item opens the website and, after you sign in, goes straight to that receipt.'
      : '每项下面的“查看”会打开网站，登录后直接到那笔到账。'
    sections.push({ heading: null, items: ccs, each: view })
  } else {
    subject = en
      ? `[Sales & Finance] You have ${n} new to-do${n > 1 ? 's' : ''} and ${m} receipt${m > 1 ? 's' : ''} copied to you`
      : `【业财管理】你有 ${n} 项新的待办、${m} 笔抄送的到账`
    line = en ? `You have ${n} new to-do${n > 1 ? 's' : ''} in Sales & Finance:` : `你在业财管理系统有 ${n} 项新的待办：`
    button = en ? 'Open the workbench' : '打开工作台'
    link = wb
    opens = en
      ? '“Open it” and “View” under each item open the website and, after you sign in, go straight to that item.'
      : '每项下面的“打开处理”“查看”会打开网站，登录后直接到那张单。'
    sections.push({ heading: null, items: list, each })
    sections.push({
      heading: en ? `Also copied to you for information (nothing to do), ${m} receipt${m > 1 ? 's' : ''}:` : `另外有 ${m} 笔到账抄送给你（不用处理，看一眼就好）：`,
      items: ccs,
      each: view,
    })
  }
  const when = en
    ? 'Reminders go out on weekdays at 10:00 and 16:00 (Ghana time), with all new to-dos in one email.'
    : '提醒邮件在工作日上午 10 点、下午 4 点（加纳时间）各发一次，新的待办合在一封里。'
  const foot = en
    ? `${opens} ${when} To stop these emails, turn them off under “Email reminders” at the top right of the website. This email was sent automatically. Please do not reply.`
    : `${opens}${when}不想收到这类邮件，可以在网站右上角“邮件提醒”里关掉。这封邮件由系统自动发出，请不要回复。`
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',Arial,sans-serif"
  // 几项的时候：一项一段，每段自己的“打开处理”（抄送的是“查看”）；待办和抄送都有就分成两段
  const many = sections.length > 0
  const itemsHtml = sections
    .map(
      (sec) =>
        (sec.heading ? `<p style="margin:0 0 12px">${esc(sec.heading)}</p>\n` : '') +
        `<ol style="margin:0 0 20px;padding-left:22px">${sec.items
          .map((t) => `<li style="margin:0 0 12px">${esc(t.text)}${en ? '.' : '。'}<br><a href="${esc(t.link)}" style="color:#1d4ed8;font-weight:600">${esc(sec.each)}</a></li>`)
          .join('')}</ol>\n`,
    )
    .join('')
  const itemsText = sections
    .map(
      (sec) =>
        (sec.heading ? `${sec.heading}\n` : '') +
        sec.items.map((t, i) => `${i + 1}. ${t.text}${en ? '.' : '。'}\n   ${sec.each}${en ? ': ' : '：'}${t.link}`).join('\n') +
        '\n\n',
    )
    .join('')
  const html = `<!doctype html>
<html lang="${en ? 'en' : 'zh-CN'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f6fb">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:${font};font-size:15px;line-height:1.6;color:#1f2937">
<div style="margin:0 0 12px;font-size:16px;font-weight:600;color:#1d4ed8">${esc(en ? 'Sales & Finance' : '业财管理')}</div>
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:24px">
<p style="margin:0 0 12px">${esc(greeting)}</p>
<p style="margin:0 0 ${many ? 12 : 20}px">${esc(line)}</p>
${itemsHtml}<a href="${esc(link)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 24px;border-radius:6px">${esc(button)}</a>
</div>
<p style="margin:16px 0 0;font-size:12px;color:#6b7280">${esc(foot)}</p>
</div>
</body></html>`
  const textBody = `${greeting}\n\n${line}\n${many ? '' : '\n'}${itemsText}${button}${en ? ': ' : '：'}${link}\n\n${foot}\n`
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

// 一封邮件里的几条一起报结果
async function report(ids: number[], res: Result) {
  if (!ids.length) return
  const done = await db.rpc('notify_done_many', {
    p_ids: ids,
    p_status: res.status,
    p_wa_id: res.status === 'sent' ? res.id : null, // 邮件的 Message-ID
    p_error: res.status === 'sent' ? null : res.error,
  })
  if (done.error) console.error('notify_done_many', ids.join(','), done.error.message)
}

async function flush(): Promise<Response> {
  // mails = 发出去几封；其余按条数（一封里有几条待办算几条）
  const count = { mails: 0, sent: 0, retry: 0, failed: 0, skipped: 0 }
  const started = Date.now()
  let t: Transport | null = null
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { data, error } = await db.rpc('notify_claim_digest', { p_limit: BATCH })
      if (error) return reply(500, { error: error.message })
      const rows = (data ?? []) as Digest[]
      let stopped: Failure | null = null
      for (const r of rows) {
        const items = r.items ?? []
        const good = items.filter((i) => !!i.body && !!i.go)
        const bad = items.filter((i) => !i.body || !i.go) // 单据没了、文字写不出来：这一条不发，别的照发
        if (bad.length) {
          await report(bad.map((i) => i.id), { status: 'skipped', error: '没有内容' })
          count.skipped += bad.length
        }
        if (!good.length) continue
        let res: Result
        if (stopped) res = stopped // 登录不上、连不上：这一批剩下的不去试，一起等下次
        else if (!configured()) res = { status: 'skipped', error: '邮件提醒还没配置好' }
        else if (!r.to_email) res = { status: 'skipped', error: '没有邮箱' }
        else {
          t ??= transport(true)
          res = await sendMail(t, r.to_email, compose(r.lang, r.to_name, good.map((i) => ({ text: i.body as string, go: i.go as string, cc: i.kind === 'cc' }))))
          if (res.status === 'sent') count.mails++
          else if (res.stop) stopped = res
        }
        await report(good.map((i) => i.id), res)
        count[res.status] += good.length
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
    res = await sendMail(t, to, compose(prof.notify_lang, name, null))
  } finally {
    t.close()
  }
  if (res.status === 'sent') return reply(200, { ok: true, to })
  if (res.kind === 'auth') return reply(502, { error: '发信邮箱登录不上，请管理员检查发信邮箱和应用专用密码：' + res.detail })
  if (res.kind === 'net') return reply(502, { error: '连不上发信服务器：' + res.detail })
  return reply(502, { error: '邮件没有发出去：' + (res.detail ?? res.error) })
}

// 排查时报一下配置：发信邮箱、应用专用密码的位数（Gmail 的是 16 位；不是 16 位多半是填了登录密码、或带了引号）。密码本身不报。
// 也报发件人名字和按钮打开的网址（看 MAIL_FROM_NAME、SITE_URL 有没有另外设，改名、换网址以后核对用）
const setup = () => ({ configured: configured(), host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, passLength: SMTP_PASS.length, fromName: FROM_NAME, site: SITE })

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
