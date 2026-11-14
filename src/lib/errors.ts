// 把数据库 / 接口错误翻成看得懂的话（跟着界面语言）。数据库触发器和账号服务发回来的中文报错按对照表翻成英文。
import { tr, trServer } from './i18n'

type ErrLike = { message?: string; code?: string; details?: string | null; hint?: string | null } | null | undefined

export function errorText(e: unknown): string {
  const err = (e ?? {}) as NonNullable<ErrLike>
  const msg = err.message ?? String(e)
  const code = err.code ?? ''
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    if (/不在邀请名单/.test(msg)) return trServer(msg)
    // 财务的模块权限（31）：说清楚是哪个模块没有编辑权限；日记账（36）：期初日期两本共用、流水只能在哪里填；
    // 和到账一起填的那一笔（37）：取消配对会一起删掉，要能改银行日记账
    if (/^没有“.+”的(编辑)?权限|^期初日期是|^银行流水只能在|^这条银行流水里还有「/.test(msg)) return trServer(msg)
    return tr('没有权限做这个操作')
  }
  if (code === '23505' || /duplicate key/i.test(msg)) {
    if (/vin/i.test(msg)) return tr('这个大架号已经存在')
    if (/customers_name/i.test(msg)) return tr('这个客户名称已经存在')
    if (/salespersons_name/i.test(msg)) return tr('这个业务员已经存在')
    if (/user_invites_pkey/i.test(msg)) return tr('这个邮箱已经在邀请名单上')
    if (/bank_ref/i.test(msg)) return tr('这个银行参考号已经录过了')
    if (/fx_rates_pkey/i.test(msg)) return tr('这一天的汇率已经录过了')
    return tr('数据重复，已经存在相同的记录')
  }
  if (code === '23503' || /foreign key/i.test(msg)) return tr('还有其他记录在用它，不能删除或修改')
  if (code === '23514' || /check constraint/i.test(msg)) {
    if (/down_payment_required/.test(msg)) return tr('分期付款必须填首付金额')
    if (/down_payment_le_contract/.test(msg)) return tr('首付不能超过合同价')
    if (/sales_needs_salesperson|invite_sales_needs_salesperson/.test(msg)) return tr('业务员角色必须选对应的业务员')
    if (/vin/.test(msg)) return tr('大架号不能有空格')
    return tr('填写的内容不符合要求：') + trServer(msg)
  }
  if (/Invalid login credentials/i.test(msg)) return tr('邮箱或密码不对')
  if (/Email not confirmed/i.test(msg)) return tr('邮箱还没有确认，请先点确认邮件里的链接，或请管理员处理')
  if (/User already registered/i.test(msg)) return tr('这个邮箱已经注册过了，请直接登录')
  if (/Password should be at least/i.test(msg)) return tr('密码至少 6 位')
  if (code === 'same_password' || /^New password should be different/i.test(msg)) return tr('新密码不能和当前密码一样')
  if (code === 'weak_password' || /^Password .*(weak|easy to guess)/i.test(msg)) return tr('这个密码太简单，请换一个')
  if (/Database error saving new user/i.test(msg)) return tr('这个邮箱不在邀请名单上，请联系管理员')
  if (/Failed to fetch|NetworkError/i.test(msg)) return tr('网络连接失败，请检查网络后重试')
  return trServer(msg)
}
