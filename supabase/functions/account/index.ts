// 账号服务（Supabase Edge Function “account”）
// - register：邀请名单上的邮箱直接开通账号，不发确认邮件（免费版的邮件服务发不到员工邮箱）
// - set_password：管理员给某个账号重设密码（员工忘记密码时用）
// - delete_user：管理员删除注册错的账号；录过数据的账号只能停用
// 服务端密钥只在 Supabase 服务器上用，不会进浏览器。
// 部署时 verify_jwt = false：register 时还没登录；管理员操作在下面自己校验登录和角色。
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MIN_PASSWORD = 8
const ALREADY = '这个邮箱已经注册过了，请直接登录；忘记密码请找管理员重设'

function checkPassword(p: unknown): string | null {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) return `密码至少 ${MIN_PASSWORD} 位`
  if (p.length > 72) return '密码最多 72 位'
  return null
}

// 校验调用的人是启用中的管理员
async function requireAdmin(req: Request): Promise<{ id: string } | Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return reply(401, { error: '请先登录' })
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return reply(401, { error: '登录已过期，请重新登录' })
  const { data: prof } = await db.from('profiles').select('role, active').eq('id', data.user.id).maybeSingle()
  if (!prof || prof.role !== 'admin' || !prof.active) return reply(403, { error: '只有管理员能做这个操作' })
  return { id: data.user.id }
}

async function register(body: Record<string, unknown>) {
  const email = String(body.email ?? '').trim().toLowerCase()
  const fullName = String(body.full_name ?? '').trim().slice(0, 60)
  if (!EMAIL_RE.test(email)) return reply(400, { error: '请填正确的邮箱' })
  const bad = checkPassword(body.password)
  if (bad) return reply(400, { error: bad })

  const { data: invite, error: e1 } = await db.from('user_invites').select('email').eq('email', email).maybeSingle()
  if (e1) return reply(500, { error: e1.message })
  if (!invite) return reply(403, { error: '这个邮箱不在邀请名单上，请联系管理员' })
  const { data: existing, error: e2 } = await db.from('profiles').select('id').eq('email', email).maybeSingle()
  if (e2) return reply(500, { error: e2.message })
  if (existing) return reply(409, { error: ALREADY })

  const { error } = await db.auth.admin.createUser({
    email,
    password: body.password as string,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : {},
  })
  if (error) {
    if (/already been registered|already exists|already registered/i.test(error.message)) return reply(409, { error: ALREADY })
    if (/password/i.test(error.message)) return reply(400, { error: '密码不符合要求：' + error.message })
    return reply(500, { error: error.message })
  }
  return reply(200, { ok: true })
}

async function setPassword(req: Request, body: Record<string, unknown>) {
  const caller = await requireAdmin(req)
  if (caller instanceof Response) return caller
  const userId = String(body.user_id ?? '')
  if (!UUID_RE.test(userId)) return reply(400, { error: '账号不对' })
  const bad = checkPassword(body.password)
  if (bad) return reply(400, { error: bad })
  const { data: prof } = await db.from('profiles').select('id').eq('id', userId).maybeSingle()
  if (!prof) return reply(404, { error: '找不到这个账号' })
  const { error } = await db.auth.admin.updateUserById(userId, { password: body.password as string })
  if (error) return reply(500, { error: error.message })
  return reply(200, { ok: true })
}

async function deleteUser(req: Request, body: Record<string, unknown>) {
  const caller = await requireAdmin(req)
  if (caller instanceof Response) return caller
  const userId = String(body.user_id ?? '')
  if (!UUID_RE.test(userId)) return reply(400, { error: '账号不对' })
  if (userId === caller.id) return reply(400, { error: '不能删除自己的账号' })
  const { data: prof } = await db.from('profiles').select('id').eq('id', userId).maybeSingle()
  if (!prof) return reply(404, { error: '找不到这个账号' })

  // 录过数据的账号只能停用，免得以后查不到是谁录的
  const results = await Promise.all([
    db.from('bank_receipts').select('id', { count: 'exact', head: true }).or(`created_by.eq.${userId},reported_by.eq.${userId}`),
    db.from('receipt_claims').select('id', { count: 'exact', head: true }).eq('created_by', userId),
    db.from('vehicles').select('id', { count: 'exact', head: true }).eq('created_by', userId),
    db.from('import_batches').select('id', { count: 'exact', head: true }).eq('created_by', userId),
    db.from('receipt_submissions').select('id', { count: 'exact', head: true }).or(`submitted_by.eq.${userId},reviewed_by.eq.${userId}`),
  ])
  for (const r of results) {
    if (r.error) return reply(500, { error: r.error.message })
    if ((r.count ?? 0) > 0) return reply(409, { error: '这个账号录过数据，只能停用，不能删除' })
  }
  const { error } = await db.auth.admin.deleteUser(userId)
  if (error) return reply(500, { error: error.message })
  return reply(200, { ok: true })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: '只接受 POST' })
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return reply(400, { error: '请求格式不对' })
  }
  try {
    switch (body.action) {
      case 'register':
        return await register(body)
      case 'set_password':
        return await setPassword(req, body)
      case 'delete_user':
        return await deleteUser(req, body)
      default:
        return reply(400, { error: '未知操作' })
    }
  } catch (e) {
    return reply(500, { error: e instanceof Error ? e.message : String(e) })
  }
})
