// 把数据库 / 接口错误翻成看得懂的中文

type ErrLike = { message?: string; code?: string; details?: string | null; hint?: string | null } | null | undefined

export function errorText(e: unknown): string {
  const err = (e ?? {}) as NonNullable<ErrLike>
  const msg = err.message ?? String(e)
  const code = err.code ?? ''
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    if (/不在邀请名单/.test(msg)) return msg
    return '没有权限做这个操作'
  }
  if (code === '23505' || /duplicate key/i.test(msg)) {
    if (/vin/i.test(msg)) return '这个大架号已经存在'
    if (/customers_name/i.test(msg)) return '这个客户名称已经存在'
    if (/salespersons_name/i.test(msg)) return '这个业务员已经存在'
    if (/user_invites_pkey/i.test(msg)) return '这个邮箱已经在邀请名单上'
    if (/bank_ref/i.test(msg)) return '这个银行参考号已经录过了'
    if (/fx_rates_pkey/i.test(msg)) return '这一天的汇率已经录过了'
    return '数据重复，已经存在相同的记录'
  }
  if (code === '23503' || /foreign key/i.test(msg)) return '还有其他记录在用它，不能删除或修改'
  if (code === '23514' || /check constraint/i.test(msg)) {
    if (/down_payment_required/.test(msg)) return '分期付款必须填首付金额'
    if (/down_payment_le_contract/.test(msg)) return '首付不能超过合同价'
    if (/sales_needs_salesperson|invite_sales_needs_salesperson/.test(msg)) return '业务员角色必须选对应的业务员'
    if (/vin/.test(msg)) return '大架号不能有空格'
    return '填写的内容不符合要求：' + msg
  }
  if (/Invalid login credentials/i.test(msg)) return '邮箱或密码不对'
  if (/Email not confirmed/i.test(msg)) return '邮箱还没有确认，请先点确认邮件里的链接，或请管理员处理'
  if (/User already registered/i.test(msg)) return '这个邮箱已经注册过了，请直接登录'
  if (/Password should be at least/i.test(msg)) return '密码至少 6 位'
  if (/Database error saving new user/i.test(msg)) return '这个邮箱不在邀请名单上，请联系管理员'
  if (/Failed to fetch|NetworkError/i.test(msg)) return '网络连接失败，请检查网络后重试'
  return msg
}
