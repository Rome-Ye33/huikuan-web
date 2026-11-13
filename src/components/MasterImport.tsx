import { DownloadOutlined, InboxOutlined } from '@ant-design/icons'
import { Alert, App, Button, Drawer, Space, Table, Tag, Upload } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useState } from 'react'
import { EN } from '../i18n/en'
import { errorText } from '../lib/errors'
import { useT } from '../lib/i18n'
import { downloadTemplate, findHeader, mapRows, readBook, sheetRows } from '../lib/masterImport'
import type { MField, MRow } from '../lib/masterImport'

/**
 * 基础资料的批量导入抽屉：读 Excel / CSV，认表头（中文或英文），逐行检查，预览后写库。
 * 怎么认一行、怎么写库由各个标签页通过 parse / save 传进来。
 */
export type ParseResult<R> = { data: R; key: string } | { issue: string }

type Props<R> = {
  open: boolean
  onClose: (changed: boolean) => void
  title: string
  /** 列：中文表头（翻译 key）。模板按这个顺序 */
  fields: MField[]
  /** 模板里的示例行，和 fields 同序 */
  example: string[]
  /** 一行原文 → 要写库的数据和比对用的 key；不合格返回 issue（已翻译） */
  parse: (cells: MRow, raw: Record<string, unknown>) => ParseResult<R>
  /** 这个 key 系统里已经有了 */
  exists: (key: string) => boolean
  /** 已有的怎么办：skip 跳过（默认），update 更新 */
  existing?: 'skip' | 'update'
  save: (rows: R[]) => Promise<void>
}

type Line<R> = { row: number; cells: MRow; status: 'new' | 'exists' | 'bad'; issue?: string; data?: R }

export default function MasterImport<R>({ open, onClose, title, fields, example, parse, exists, existing = 'skip', save }: Props<R>) {
  const t = useT()
  const { message } = App.useApp()
  const [fileName, setFileName] = useState('')
  const [lines, setLines] = useState<Line<R>[]>([])
  const [importing, setImporting] = useState(false)

  const reset = () => {
    setFileName('')
    setLines([])
  }

  const readFile = async (file: File) => {
    let found: { name: string; rows: unknown[][]; header: { row: number; map: Record<string, number> } } | null = null
    try {
      const wb = await readBook(file)
      for (const name of wb.SheetNames) {
        const rows = sheetRows(wb, name)
        const header = findHeader(rows, fields, (label) => EN[label] ?? label)
        if (header) {
          found = { name, rows, header }
          break
        }
      }
    } catch {
      message.error(t('读不了这个文件。有密码的 Excel 请先另存一份没有密码的'))
      return
    }
    if (!found) {
      message.error(t('认不出表头：第一行要有 {labels}', { labels: fields.filter((f) => f.required).map((f) => t(f.label)).join('、') }), 6)
      return
    }
    const seen = new Set<string>()
    const out: Line<R>[] = []
    for (const r of mapRows(found.rows, found.header)) {
      const raw: Record<string, unknown> = {}
      for (const [k, i] of Object.entries(found.header.map)) raw[k] = r.raw[i]
      const p = parse(r.cells, raw)
      if ('issue' in p) out.push({ row: r.row, cells: r.cells, status: 'bad', issue: p.issue })
      else if (seen.has(p.key)) out.push({ row: r.row, cells: r.cells, status: 'bad', issue: t('文件里重复') })
      else {
        seen.add(p.key)
        out.push({ row: r.row, cells: r.cells, status: exists(p.key) ? 'exists' : 'new', data: p.data })
      }
    }
    setFileName(file.name)
    setLines(out)
  }

  const counts = {
    new: lines.filter((l) => l.status === 'new').length,
    exists: lines.filter((l) => l.status === 'exists').length,
    bad: lines.filter((l) => l.status === 'bad').length,
  }
  const toSave = lines.filter((l) => l.status === 'new' || (existing === 'update' && l.status === 'exists')).map((l) => l.data as R)

  const doImport = async () => {
    setImporting(true)
    try {
      await save(toSave)
      message.success(existing === 'update' ? t('已导入 {n} 条（新增 {a}，更新 {b}）', { n: toSave.length, a: counts.new, b: counts.exists }) : t('已导入 {n} 条，跳过已有的 {m} 条', { n: toSave.length, m: counts.exists }))
      reset()
      onClose(true)
    } catch (e) {
      message.error(errorText(e), 8)
    } finally {
      setImporting(false)
    }
  }

  const STATUS = { new: <Tag color="green">{t('新增')}</Tag>, exists: <Tag>{existing === 'update' ? t('已有（更新）') : t('已有（跳过）')}</Tag>, bad: <Tag color="red">{t('有问题')}</Tag> }
  const columns: ColumnsType<Line<R>> = [
    { title: t('行'), dataIndex: 'row', width: 56 },
    { title: t('状态'), width: 110, render: (_, l) => STATUS[l.status] },
    ...fields.map((f) => ({ title: t(f.label), render: (_: unknown, l: Line<R>) => l.cells[f.key] })),
    { title: t('问题'), render: (_, l) => (l.issue ? <span className="text-danger">{l.issue}</span> : '') },
  ]

  return (
    <Drawer
      open={open}
      width={960}
      title={title}
      destroyOnHidden
      onClose={() => {
        reset()
        onClose(false)
      }}
      extra={
        <Button type="primary" disabled={!toSave.length} loading={importing} onClick={() => void doImport()}>
          {t('导入 {n} 条', { n: toSave.length })}
        </Button>
      }
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <Button icon={<DownloadOutlined />} onClick={() => downloadTemplate(title, t('数据'), fields.map((f) => t(f.label)), example)}>
          {t('下载模板')}
        </Button>
        <span className="hint">{t('第一行是表头（中文或英文都认），必填：{labels}。名字和系统里一样的算已有。', { labels: fields.filter((f) => f.required).map((f) => t(f.label)).join('、') })}</span>
      </Space>
      <Upload.Dragger
        accept=".xlsx,.xls,.csv"
        showUploadList={false}
        disabled={importing}
        beforeUpload={(f) => {
          void readFile(f as File)
          return false
        }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">{fileName ? t('已读取：{fileName}（点这里换一个文件）', { fileName }) : t('把 Excel 拖到这里，或点击选择')}</p>
      </Upload.Dragger>
      {lines.length > 0 && (
        <>
          <Alert
            style={{ margin: '12px 0' }}
            type={counts.bad ? 'warning' : 'info'}
            showIcon
            title={t('共 {n} 行：新增 {a}，已有 {b}，有问题 {c}（有问题的不导）', { n: lines.length, a: counts.new, b: counts.exists, c: counts.bad })}
          />
          <Table rowKey="row" size="small" dataSource={lines} columns={columns} pagination={{ defaultPageSize: 50 }} scroll={{ x: 'max-content' }} />
        </>
      )}
    </Drawer>
  )
}
