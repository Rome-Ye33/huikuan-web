import type { Json } from './database.types'
import type { AppRole } from './supabase'

// ---------------------------------------------------------------- 财务的模块权限（数据库 31）
// 每个财务账号、每个模块一档：不可见 / 只看 / 可编辑。管理员永远全部可编辑；业务员不用这个（只看自己名下的）。
// 财务的 perms 是空的 = 没设过 = 全部可编辑（和以前一样）；设过以后没写到的模块按“不可见”算。
// 数据库把关“修改”（没有编辑权限的绕过网页也改不了）；“不可见 / 只看”由网页控制菜单、页面和按钮。
export type PermModule = 'receipts' | 'journal' | 'cheques' | 'vehicles' | 'commission' | 'reconcile' | 'base'
export type PermLevel = 'none' | 'view' | 'edit'
export type Perms = Partial<Record<PermModule, PermLevel>>

/** 7 个模块，按菜单的顺序；label 是菜单上的名字（中文，界面上用 t() 翻译）。journal 银行现金日记账是数据库 36 加的 */
export const PERM_MODULES: { key: PermModule; label: string }[] = [
  { key: 'receipts', label: '到账录入' },
  { key: 'journal', label: '银行现金日记账' },
  { key: 'cheques', label: '支票管理' },
  { key: 'vehicles', label: '车辆台账' },
  { key: 'commission', label: '提成申请单' },
  { key: 'reconcile', label: '银行对账' },
  { key: 'base', label: '基础资料' },
]

export const PERM_LEVELS: { key: PermLevel; label: string }[] = [
  { key: 'none', label: '不可见' },
  { key: 'view', label: '只看' },
  { key: 'edit', label: '可编辑' },
]

/** 数据库里存的 perms → 每个模块一档（空 = 没设过 = 全部可编辑；没写到的 = 不可见）。和 private.user_perm 一样算 */
export function permOf(role: AppRole | null, perms: Json | null | undefined, m: PermModule): PermLevel {
  if (role === 'admin') return 'edit'
  if (role !== 'finance') return 'none'
  if (perms === null || perms === undefined) return 'edit'
  const v = typeof perms === 'object' && !Array.isArray(perms) ? perms[m] : undefined
  return v === 'view' || v === 'edit' ? v : 'none'
}

/** 存进数据库的样子：全部可编辑存空（= 不限制，以后加了新模块也能编辑），否则每个模块都写上 */
export function storedPerms(p: Perms): Record<PermModule, PermLevel> | null {
  const full = Object.fromEntries(PERM_MODULES.map((m) => [m.key, p[m.key] ?? 'none'])) as Record<PermModule, PermLevel>
  return PERM_MODULES.every((m) => full[m.key] === 'edit') ? null : full
}
