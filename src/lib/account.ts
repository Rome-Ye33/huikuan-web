// 调用服务端的账号服务（Edge Function “account”）：注册、重设密码、删除账号
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

type AccountAction =
  | { action: 'register'; email: string; password: string; full_name?: string }
  | { action: 'set_password'; user_id: string; password: string }
  | { action: 'delete_user'; user_id: string }

export const MIN_PASSWORD = 8

export async function accountCall(body: AccountAction): Promise<void> {
  const { data, error } = await supabase.functions.invoke('account', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const j = (await error.context.json().catch(() => null)) as { error?: string } | null
      throw new Error(j?.error ?? '操作失败，请稍后再试')
    }
    throw new Error('网络连接失败，请检查网络后重试')
  }
  if (!(data as { ok?: boolean } | null)?.ok) throw new Error('操作失败，请稍后再试')
}

// 管理员重设密码时用：10 位，去掉容易看错的 0/O/1/l/I
export function randomPassword(len = 10): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const buf = new Uint32Array(len)
  crypto.getRandomValues(buf)
  return Array.from(buf, (n) => chars[n % chars.length]).join('')
}
