// 款项性质的常用判断
import { num } from './format'
import type { Nature, Vehicle } from './supabase'

/** 选了车以后默认的款项性质：按付款方式和已到账情况猜 */
export function defaultNature(v: Pick<Vehicle, 'payment_method' | 'received_usd' | 'down_payment_usd'>): string {
  const received = num(v.received_usd)
  if (v.payment_method === '预付') return '预付款'
  if (v.payment_method === '分期') return received < num(v.down_payment_usd) ? '首付款' : '分期款'
  return received > 0 ? '全款尾款' : '全款'
}

/** 到账能拆的款项性质（期初余额、优惠折让不走到账） */
export function receiptNatures(natures: Nature[]): Nature[] {
  return natures.filter((n) => n.active && (n.kind === 'payment' || n.kind === 'parts' || n.kind === 'refund'))
}
