// 基础资料（客户、业务员、收款账户、汇率）的 Excel 批量导入：读文件、认表头、对列。写库在各个标签页里。
import * as XLSX from 'xlsx'

/** 一列：key 是字段名，label 是中文表头（同时是翻译的 key），alias 是表头别的写法 */
export type MField = { key: string; label: string; required?: boolean; alias?: RegExp }
export type MRow = Record<string, string>

export const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
/** 比对名字用：去多余空格、不分大小写 */
export const normKey = (v: unknown) => clean(v).toLowerCase()

export async function readBook(file: File): Promise<XLSX.WorkBook> {
  return XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true, cellDates: false })
}
export const sheetRows = (wb: XLSX.WorkBook, name: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: '' })

/**
 * 在前 20 行里找表头：每一格对上一个字段（中文名、英文名或别名，不分大小写），必填的字段都要有。
 * 返回表头在第几行（0 起）和字段 → 列号。
 */
export function findHeader(rows: unknown[][], fields: MField[], en: (label: string) => string): { row: number; map: Record<string, number> } | null {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const cells = (rows[r] ?? []).map((c) => normKey(c))
    const map: Record<string, number> = {}
    for (const f of fields) {
      const names = [normKey(f.label), normKey(en(f.label))]
      let i = cells.findIndex((c, idx) => c && !Object.values(map).includes(idx) && names.includes(c))
      if (i < 0 && f.alias) i = cells.findIndex((c, idx) => c && !Object.values(map).includes(idx) && f.alias!.test(c))
      if (i >= 0) map[f.key] = i
    }
    if (fields.every((f) => !f.required || f.key in map) && Object.keys(map).length >= Math.min(2, fields.length)) return { row: r, map }
  }
  return null
}

/** 表头下面的每一行 → { 字段: 原文 }；整行空白的跳过。row 是 Excel 里的行号（1 起） */
export function mapRows(rows: unknown[][], header: { row: number; map: Record<string, number> }): { row: number; cells: MRow; raw: unknown[] }[] {
  const out: { row: number; cells: MRow; raw: unknown[] }[] = []
  for (let r = header.row + 1; r < rows.length; r++) {
    const raw = rows[r] ?? []
    if (raw.every((c) => clean(c) === '')) continue
    const cells: MRow = {}
    for (const [k, i] of Object.entries(header.map)) cells[k] = clean(raw[i])
    out.push({ row: r + 1, cells, raw })
  }
  return out
}

/** 是 / 否 之类：空着按默认值 */
export function parseBool(v: string, dflt = true): boolean | null {
  const s = normKey(v)
  if (!s) return dflt
  if (['是', 'y', 'yes', 'true', '1', '在职', '在用', '启用', 'active', 'on'].includes(s)) return true
  if (['否', 'n', 'no', 'false', '0', '停用', '离职', 'inactive', 'off'].includes(s)) return false
  return null
}

export function downloadTemplate(fileName: string, sheetName: string, headers: string[], example: string[]) {
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(14, h.length * 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, `${fileName}.xlsx`)
}
