import { DownloadOutlined, InboxOutlined } from '@ant-design/icons'
import { Alert, App, AutoComplete, Button, Card, Col, DatePicker, Drawer, InputNumber, Progress, Radio, Row, Segmented, Select, Space, Table, Tag, Typography, Upload } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import type { Json } from '../lib/database.types'
import { errorText } from '../lib/errors'
import { money, todayAccra } from '../lib/format'
import { useT } from '../lib/i18n'
import { useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import { findVehicleHeaderRow, guessVehicleMapping, normName, parseVehicleRows, TEMPLATE_FIELDS, V_FIELDS } from '../lib/vehicleImport'
import type { Issue, VField, VMapping, VRow } from '../lib/vehicleImport'

// 批量导入车辆和期初（只限管理员）：选 Excel → 对列 → 业务员对照 → 预览检查 → 每次 100 行交给 import_vehicles。
// 已在系统里的车默认跳过；选“更新”时用文件里的数据覆盖（空着的项保留原值）。期初已到账、期初优惠各记一笔，不重复。

type Status = 'new' | 'update' | 'skip' | 'error'
type PRow = VRow & { status: Status; extra: Issue[] }
type Result = { inserted: number; updated: number; skipped: number; customers: number; salespersons: number; opening: number; discount: number; warnings: string[] }

const BATCH = 100
const LABEL = new Map(V_FIELDS.map((f) => [f.key, f.label]))
const colName = (i: number) => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

export default function VehicleImport({ open, onClose }: { open: boolean; onClose: (changed: boolean) => void }) {
  const t = useT()
  const { message } = App.useApp()
  const { salespersons, customers, reload } = useRefData()
  const [fileName, setFileName] = useState('')
  const [book, setBook] = useState<XLSX.WorkBook | null>(null)
  const [sheet, setSheet] = useState('')
  const [sheetRows, setSheetRows] = useState<unknown[][]>([])
  const [headerRow, setHeaderRow] = useState(1)
  const [mapping, setMapping] = useState<VMapping>({})
  const [openingDate, setOpeningDate] = useState(() => dayjs(todayAccra()))
  const [update, setUpdate] = useState(false)
  const [spPick, setSpPick] = useState<Record<string, string>>({})
  const [existing, setExisting] = useState<Set<string> | null>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)
  const [filter, setFilter] = useState<'all' | 'error' | 'new' | 'exist'>('all')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const changed = useRef(false)

  const close = () => {
    if (importing) return
    const c = changed.current
    changed.current = false
    setFileName('')
    setBook(null)
    setSheet('')
    setSheetRows([])
    setMapping({})
    setSpPick({})
    setResult(null)
    setFailure(null)
    setProgress(null)
    setFilter('all')
    setUpdate(false)
    onClose(c)
  }

  // ---------- 读文件 ----------
  const sheetToRows = (wb: XLSX.WorkBook, name: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: '' })
  const applyHeaderRow = (rows: unknown[][], hr: number) => {
    setHeaderRow(hr)
    setMapping(guessVehicleMapping((rows[hr - 1] ?? []).map((c) => String(c ?? ''))))
  }
  const loadSheet = (wb: XLSX.WorkBook, name: string) => {
    const rows = sheetToRows(wb, name)
    setSheet(name)
    setSheetRows(rows)
    setSpPick({})
    setResult(null)
    setFailure(null)
    setProgress(null)
    applyHeaderRow(rows, findVehicleHeaderRow(rows) || 1)
  }
  const readFile = async (file: File) => {
    let wb: XLSX.WorkBook
    try {
      wb = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true, cellDates: false })
    } catch {
      message.error(t('读不了这个文件。有密码的 Excel 请先另存一份没有密码的'))
      return
    }
    setBook(wb)
    setFileName(file.name)
    loadSheet(wb, wb.SheetNames.find((n) => findVehicleHeaderRow(sheetToRows(wb, n)) > 0) ?? wb.SheetNames[0])
  }

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_FIELDS.map((k) => t(LABEL.get(k) ?? k))])
    ws['!cols'] = TEMPLATE_FIELDS.map((k) => ({ wch: k === 'vin' || k === 'customer' || k === 'model' || k === 'note' ? 22 : 14 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, t('车辆'))
    XLSX.writeFile(wb, `${t('批量导入车辆模板')}.xlsx`)
  }

  // ---------- 解析、查已有的车 ----------
  const headers = useMemo(() => (sheetRows[headerRow - 1] ?? []).map((c) => String(c ?? '').replace(/\s+/g, ' ').trim()), [sheetRows, headerRow])
  const parsed = useMemo(() => (sheetRows.length ? parseVehicleRows(sheetRows, headerRow, mapping) : []), [sheetRows, headerRow, mapping])
  const vinKey = useMemo(() => [...new Set(parsed.map((r) => r.vin).filter(Boolean))].join(','), [parsed])

  useEffect(() => {
    let stop = false
    const vins = vinKey ? vinKey.split(',') : []
    setExisting(vins.length ? null : new Set())
    if (!vins.length) return
    void (async () => {
      const found = new Set<string>()
      for (let i = 0; i < vins.length; i += 150) {
        const { data, error } = await supabase.from('vehicles').select('vin').in('vin', vins.slice(i, i + 150))
        if (stop) return
        if (error) {
          message.error(errorText(error))
          return
        }
        for (const v of data ?? []) found.add(v.vin)
      }
      setExisting(found)
    })()
    return () => {
      stop = true
    }
  }, [vinKey, refreshKey, message])

  // ---------- 业务员对照：文件里的写法 → 系统里的名字（大小写、空格不同算同一个） ----------
  const spByNorm = useMemo(() => new Map(salespersons.map((s) => [normName(s.name), s.name])), [salespersons])
  const spGroups = useMemo(() => {
    const m = new Map<string, { key: string; names: string[]; count: number }>()
    for (const r of parsed) {
      if (!r.salesperson) continue
      const k = normName(r.salesperson)
      const g = m.get(k) ?? { key: k, names: [], count: 0 }
      if (!g.names.includes(r.salesperson)) g.names.push(r.salesperson)
      g.count++
      m.set(k, g)
    }
    return [...m.values()].sort((a, b) => b.count - a.count)
  }, [parsed])
  const spFirst = useMemo(() => new Map(spGroups.map((g) => [g.key, g.names[0]])), [spGroups])
  const spTarget = (key: string) => (spPick[key] ?? spByNorm.get(key) ?? spFirst.get(key) ?? '').replace(/\s+/g, ' ').trim()

  // ---------- 每行状态 ----------
  const rows: PRow[] = useMemo(
    () =>
      parsed.map((r) => {
        const exists = !!existing?.has(r.vin)
        const extra: Issue[] = []
        if (!exists && r.payment_method === '分期' && r.down_payment_usd === null) extra.push({ key: '分期的车要填首付' })
        const status: Status = r.errors.length || extra.length ? 'error' : exists ? (update ? 'update' : 'skip') : 'new'
        return { ...r, status, extra }
      }),
    [parsed, existing, update],
  )
  const toImport = rows.filter((r) => r.status === 'new' || r.status === 'update')
  const count = (s: Status) => rows.filter((r) => r.status === s).length
  const custNorm = useMemo(() => new Set(customers.map((c) => normName(c.name))), [customers])
  const newCustomers = new Set(toImport.map((r) => normName(r.customer)).filter((k) => !custNorm.has(k))).size
  const newSps = new Set(
    toImport
      .filter((r) => r.salesperson)
      .map((r) => normName(spTarget(normName(r.salesperson))))
      .filter((k) => k && !spByNorm.has(k)),
  ).size
  const total = (k: 'contract_usd' | 'opening_paid_usd' | 'opening_discount_usd') => toImport.reduce((s, r) => s + (r[k] ?? 0), 0)
  const missingRequired = V_FIELDS.filter((f) => f.required && mapping[f.key] === undefined)

  const payload = (r: PRow) => ({
    row: r.row,
    vin: r.vin,
    model: r.model,
    customer: r.customer,
    salesperson: r.salesperson ? spTarget(normName(r.salesperson)) || null : null,
    contract_date: r.contract_date,
    payment_method: r.payment_method,
    contract_usd: r.contract_usd,
    down_payment_usd: r.down_payment_usd,
    shipped_at: r.shipped_at,
    note: r.note || null,
    opening_paid_usd: r.opening_paid_usd,
    opening_discount_usd: r.opening_discount_usd,
  })

  const doImport = async () => {
    if (!toImport.length) return message.warning(t('没有要导入的行'))
    setImporting(true)
    setResult(null)
    setFailure(null)
    const sum: Result = { inserted: 0, updated: 0, skipped: 0, customers: 0, salespersons: 0, opening: 0, discount: 0, warnings: [] }
    setProgress({ done: 0, total: toImport.length })
    for (let i = 0; i < toImport.length; i += BATCH) {
      const batch = toImport.slice(i, i + BATCH)
      const { data, error } = await supabase.rpc('import_vehicles', {
        p_rows: batch.map(payload) as unknown as Json,
        p_opening_date: openingDate.format('YYYY-MM-DD'),
        p_update: update,
      })
      if (error) {
        setFailure(t('第 {from} 到 {to} 行这一批没导进去，前面的已经导好了：{err}', { from: batch[0].row, to: batch[batch.length - 1].row, err: errorText(error) }))
        break
      }
      changed.current = true
      const d = data as unknown as Result
      for (const k of ['inserted', 'updated', 'skipped', 'customers', 'salespersons', 'opening', 'discount'] as const) sum[k] += Number(d[k] ?? 0)
      sum.warnings.push(...(d.warnings ?? []))
      setProgress({ done: Math.min(i + BATCH, toImport.length), total: toImport.length })
    }
    setResult(sum)
    setImporting(false)
    await reload()
    setRefreshKey((k) => k + 1)
  }

  // ---------- 表格 ----------
  const issueText = (i: Issue) => t(i.key, Object.fromEntries(Object.entries(i.vars ?? {}).map(([k, v]) => [k, typeof v === 'string' ? t(v) : v])))
  const STATUS: Record<Status, [string, string]> = {
    new: ['green', t('新增')],
    update: ['blue', t('更新')],
    skip: ['default', t('已在系统里，跳过')],
    error: ['red', t('有问题，不导入')],
  }
  const usd = (v: number | null) => (v === null ? '' : money(v))
  const columns: ColumnsType<PRow> = [
    { title: t('行'), dataIndex: 'row', width: 60, fixed: 'left' },
    {
      title: t('状态'),
      width: 230,
      render: (_, r) => (
        <div>
          <Tag color={STATUS[r.status][0]}>{STATUS[r.status][1]}</Tag>
          {[...r.errors, ...r.extra].map((e, i) => (
            <div key={`e${i}`} className="text-danger">
              {issueText(e)}
            </div>
          ))}
          {r.warnings.map((w, i) => (
            <div key={`w${i}`} className="text-warn">
              {issueText(w)}
            </div>
          ))}
        </div>
      ),
    },
    { title: t('大架号'), dataIndex: 'vin', width: 190, render: (v: string) => <span className="cv-vin">{v}</span> },
    { title: t('客户'), dataIndex: 'customer', width: 180, ellipsis: true },
    { title: t('车型'), dataIndex: 'model', width: 170, ellipsis: true },
    {
      title: t('业务员'),
      width: 130,
      render: (_, r) => {
        if (!r.salesperson) return ''
        const to = spTarget(normName(r.salesperson))
        return to === r.salesperson ? to : (
          <span>
            {to || <span className="hint">{t('不填')}</span>}
            <div className="hint">{r.salesperson}</div>
          </span>
        )
      },
    },
    { title: t('付款方式'), dataIndex: 'payment_method', width: 100, render: (v: string) => t(v) },
    { title: t('合同价USD'), dataIndex: 'contract_usd', width: 110, align: 'right', render: usd },
    { title: t('首付USD'), dataIndex: 'down_payment_usd', width: 100, align: 'right', render: usd },
    { title: t('期初已到账USD'), dataIndex: 'opening_paid_usd', width: 120, align: 'right', render: usd },
    { title: t('期初优惠USD'), dataIndex: 'opening_discount_usd', width: 110, align: 'right', render: usd },
    { title: t('合同日期'), dataIndex: 'contract_date', width: 105 },
    { title: t('发车日期'), dataIndex: 'shipped_at', width: 105 },
    { title: t('备注'), dataIndex: 'note', width: 200, ellipsis: true },
  ]
  const shown = rows.filter((r) =>
    filter === 'all' ? true : filter === 'error' ? r.status === 'error' : filter === 'new' ? r.status === 'new' : r.status === 'update' || r.status === 'skip',
  )

  const colOptions = headers.map((h, i) => ({ value: i, label: `${colName(i)} · ${h || t('（空）')}` }))

  return (
    <Drawer
      open={open}
      title={t('批量导入车辆和期初')}
      size={Math.min(1240, typeof window !== 'undefined' ? window.innerWidth : 1240)}
      onClose={close}
      maskClosable={!importing}
      closable={!importing}
      destroyOnHidden
    >
      <Card size="small" title={t('1. 选文件')} style={{ marginBottom: 12 }} extra={<Button icon={<DownloadOutlined />} onClick={downloadTemplate}>{t('下载模板')}</Button>}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          {t('一行一台车。必填：大架号、车型、客户、合同价USD；分期的车要填首付。期初已到账USD 是系统上线前这台车已经收到的钱，期初优惠USD 是已经给的优惠。客户、业务员系统里没有的会新建；已在系统里的车默认跳过，可以多次导入。')}
        </Typography.Paragraph>
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
          <p className="ant-upload-text">{fileName ? t('已读取：{fileName}（点这里换一个文件）', { fileName }) : t('把车辆 Excel 拖到这里，或点击选择')}</p>
        </Upload.Dragger>
      </Card>

      {sheetRows.length > 0 && (
        <Card size="small" title={t('2. 对应列')} style={{ marginBottom: 12 }}>
          <Row gutter={[12, 12]}>
            {book && book.SheetNames.length > 1 && (
              <Col xs={24} md={8} lg={6}>
                <div className="hint">{t('工作表')}</div>
                <Select style={{ width: '100%' }} value={sheet} onChange={(n: string) => loadSheet(book, n)} options={book.SheetNames.map((n) => ({ value: n, label: n }))} />
              </Col>
            )}
            <Col xs={12} md={8} lg={4}>
              <div className="hint">{t('表头在第几行')}</div>
              <InputNumber min={1} max={50} value={headerRow} onChange={(v) => applyHeaderRow(sheetRows, v ?? 1)} style={{ width: '100%' }} />
            </Col>
            {V_FIELDS.map((f) => (
              <Col key={f.key} xs={12} md={8} lg={4}>
                <div className="hint">
                  {t(f.label)}
                  {f.required && <span className="text-danger"> *</span>}
                </div>
                <Select
                  allowClear
                  style={{ width: '100%' }}
                  value={mapping[f.key]}
                  status={f.required && mapping[f.key] === undefined ? 'error' : undefined}
                  placeholder={t('没有')}
                  showSearch={{ optionFilterProp: 'label' }}
                  options={colOptions}
                  onChange={(v: number | undefined) => setMapping((m) => ({ ...m, [f.key as VField]: v }))}
                />
              </Col>
            ))}
          </Row>
          {missingRequired.length > 0 && (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: 12 }}
              title={t('还没对上的必填列：{list}', { list: missingRequired.map((f) => t(f.label)).join(t('、')) })}
            />
          )}
        </Card>
      )}

      {sheetRows.length > 0 && spGroups.length > 0 && (
        <Card
          size="small"
          title={t('3. 业务员对照')}
          extra={<span className="hint">{t('照报款署名填；系统里没有的会新建，清空就不填业务员')}</span>}
          style={{ marginBottom: 12 }}
        >
          <Table
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={spGroups}
            scroll={{ y: 320 }}
            columns={[
              { title: t('文件里的写法'), render: (_, g) => g.names.join(' / '), ellipsis: true },
              { title: t('台数'), dataIndex: 'count', width: 70, align: 'right' },
              {
                title: t('系统里的业务员'),
                width: 300,
                render: (_, g) => {
                  const to = spTarget(g.key)
                  const tag = !to ? <Tag>{t('不填')}</Tag> : spByNorm.has(normName(to)) ? <Tag color="green">{t('已有')}</Tag> : <Tag color="orange">{t('新建')}</Tag>
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AutoComplete
                        size="small"
                        style={{ flex: 1, minWidth: 0 }}
                        value={spPick[g.key] ?? spByNorm.get(g.key) ?? g.names[0]}
                        options={salespersons.map((s) => ({ value: s.name }))}
                        filterOption={(input, o) => normName(String(o?.value ?? '')).includes(normName(input))}
                        onChange={(v: string) => setSpPick((p) => ({ ...p, [g.key]: v }))}
                      />
                      {tag}
                    </div>
                  )
                },
              },
            ]}
          />
        </Card>
      )}

      {sheetRows.length > 0 && (
        <Card size="small" title={t('4. 预览和导入')}>
          <Space orientation="vertical" style={{ width: '100%' }} size={8}>
            <div>
              {t('共 {n} 行：新增 {a} 台，已在系统里 {b} 台，有问题 {c} 行（不导入）。', {
                n: rows.length,
                a: count('new'),
                b: count('skip') + count('update'),
                c: count('error'),
              })}
              {existing === null && <span className="hint"> {t('正在查系统里已有的车…')}</span>}
            </div>
            <div className="hint">
              {t('这次导入 {n} 台：新客户 {c} 个，新业务员 {s} 个；合同价合计 {contract}，期初已到账合计 {paid}，期初优惠合计 {disc}。', {
                n: toImport.length,
                c: newCustomers,
                s: newSps,
                contract: money(total('contract_usd')),
                paid: money(total('opening_paid_usd')),
                disc: money(total('opening_discount_usd')),
              })}
            </div>
            <Space wrap>
              <span>{t('期初日期')}</span>
              <DatePicker value={openingDate} allowClear={false} onChange={(d) => d && setOpeningDate(d)} />
              <span>{t('已在系统里的车')}</span>
              <Radio.Group
                value={update}
                onChange={(e) => setUpdate(e.target.value)}
                options={[
                  { value: false, label: t('跳过') },
                  { value: true, label: t('用文件里的更新') },
                ]}
              />
              <Button type="primary" loading={importing} disabled={!toImport.length || existing === null || missingRequired.length > 0} onClick={() => void doImport()}>
                {t('导入 {n} 台', { n: toImport.length })}
              </Button>
            </Space>
            {progress && importing && <Progress percent={Math.round((progress.done / progress.total) * 100)} />}
            {failure && <Alert type="error" showIcon title={failure} />}
            {result && (
              <Alert
                type={failure ? 'warning' : 'success'}
                showIcon
                title={t('新建 {inserted} 台、更新 {updated} 台、跳过 {skipped} 台；新建客户 {customers} 个、业务员 {salespersons} 个；记了期初已到账 {opening} 笔、期初优惠 {discount} 笔。', {
                  inserted: result.inserted,
                  updated: result.updated,
                  skipped: result.skipped,
                  customers: result.customers,
                  salespersons: result.salespersons,
                  opening: result.opening,
                  discount: result.discount,
                })}
                description={result.warnings.length ? result.warnings.map((w, i) => <div key={i}>{errorText({ message: w })}</div>) : undefined}
              />
            )}
            <Segmented
              value={filter}
              onChange={(v) => setFilter(v as typeof filter)}
              options={[
                { value: 'all', label: t('全部 {n}', { n: rows.length }) },
                { value: 'error', label: t('有问题 {n}', { n: count('error') }) },
                { value: 'new', label: t('新增 {n}', { n: count('new') }) },
                { value: 'exist', label: t('已在系统里 {n}', { n: count('skip') + count('update') }) },
              ]}
            />
            <Table rowKey="row" size="small" dataSource={shown} columns={columns} scroll={{ x: 1850 }} pagination={{ defaultPageSize: 50, showSizeChanger: true }} />
          </Space>
        </Card>
      )}
    </Drawer>
  )
}
