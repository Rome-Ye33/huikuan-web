import { InboxOutlined } from '@ant-design/icons'
import { Alert, App, Button, Drawer, Progress, Segmented, Space, Table, Tag, Typography, Upload } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import type { Json } from '../lib/database.types'
import { MAIN_SHEET, MEMO_SHEET, OTHER_SHEET, parseMainSheet, parseMemo, parseOtherSheet } from '../lib/chequeImport'
import type { ChequeImportRow } from '../lib/chequeImport'
import { CHEQUE_STATUS_COLOR, CHEQUE_STATUS_LABEL, notifyChequesChanged } from '../lib/cheques'
import { errorText } from '../lib/errors'
import { money } from '../lib/format'
import { useT } from '../lib/i18n'
import { useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'

// 导入 Rome 的《支票表》：自动认出 主表-分期合同支票明细 / 其他支票明细 / 支票表存取备忘录 三张工作表，
// 整理成一行一张支票，备注里的大架号对车，预览 → 每次 300 张交给 import_cheques。已报回款的不导；已录过的跳过。

type Result = { created: number; skipped: { row: number; cheque_no: string }[]; customers: number }
type Filter = 'all' | 'warn' | 'skip'
const BATCH = 300

export default function ChequeImport({ open, onClose }: { open: boolean; onClose: (changed: boolean) => void }) {
  const t = useT()
  const { message } = App.useApp()
  const { accounts, reload } = useRefData()
  const [fileName, setFileName] = useState('')
  const [sheets, setSheets] = useState<string[]>([])
  const [parsed, setParsed] = useState<ChequeImportRow[]>([])
  const [vehicleByVin, setVehicleByVin] = useState<Map<string, number> | null>(new Map())
  const [filter, setFilter] = useState<Filter>('all')
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
    setSheets([])
    setParsed([])
    setResult(null)
    setFailure(null)
    setProgress(null)
    setFilter('all')
    onClose(c)
  }

  // ---------- 读文件：按工作表名认出三张表 ----------
  const readFile = async (file: File) => {
    let wb: XLSX.WorkBook
    try {
      wb = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true, cellDates: false })
    } catch {
      message.error(t('读不了这个文件。有密码的 Excel 请先另存一份没有密码的'))
      return
    }
    const rowsOf = (name: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: '' })
    const main = wb.SheetNames.find((n) => MAIN_SHEET.test(n))
    const other = wb.SheetNames.find((n) => OTHER_SHEET.test(n))
    const memoName = wb.SheetNames.find((n) => MEMO_SHEET.test(n))
    if (!main && !other) {
      message.error(t('这个文件里没有“主表-分期合同支票明细”或“其他支票明细”工作表'))
      return
    }
    const memo = memoName ? parseMemo(rowsOf(memoName)) : new Map()
    const rows = [...(main ? parseMainSheet(rowsOf(main), memo, accounts) : []), ...(other ? parseOtherSheet(rowsOf(other), accounts) : [])]
    setFileName(file.name)
    setSheets([main, other, memoName].filter((x): x is string => !!x))
    setParsed(rows)
    setResult(null)
    setFailure(null)
    setProgress(null)
    setFilter('all')
    if (!rows.length) message.warning(t('表里没认出支票行'))
  }

  // ---------- 备注里的大架号 → 车 ----------
  const vinKey = useMemo(() => [...new Set(parsed.map((r) => r.vin).filter((v): v is string => !!v))].join(','), [parsed])
  useEffect(() => {
    let stop = false
    const vins = vinKey ? vinKey.split(',') : []
    setVehicleByVin(vins.length ? null : new Map())
    if (!vins.length) return
    void (async () => {
      const found = new Map<string, number>()
      for (let i = 0; i < vins.length; i += 150) {
        const { data, error } = await supabase.from('vehicles').select('id, vin').in('vin', vins.slice(i, i + 150))
        if (stop) return
        if (error) {
          message.error(errorText(error))
          return
        }
        for (const v of data ?? []) found.set(v.vin, v.id)
      }
      setVehicleByVin(found)
    })()
    return () => {
      stop = true
    }
  }, [vinKey, message])

  const rows = useMemo(
    () =>
      parsed.map((r) => {
        const vehicle_id = r.vin ? (vehicleByVin?.get(r.vin) ?? null) : null
        const warnings = r.vin && vehicleByVin && !vehicle_id ? [...r.warnings, `大架号 ${r.vin} 系统里没有这台车，只按客户导入`] : r.warnings
        return { ...r, vehicle_id, warnings }
      }),
    [parsed, vehicleByVin],
  )
  const toImport = rows.filter((r) => !r.skip)
  const nWarn = rows.filter((r) => !r.skip && r.warnings.length).length
  const nSkip = rows.length - toImport.length
  const byStatus = (s: string) => toImport.filter((r) => r.status === s).length

  // ---------- 导入 ----------
  const payload = (r: (typeof rows)[number]) => ({
    cheque_no: r.cheque_no,
    drawer_bank: r.drawer_bank,
    drawer_name: r.drawer_name,
    customer_name: r.customer_name,
    vehicle_id: r.vehicle_id,
    salesperson_name: r.salesperson_name,
    purpose: r.purpose,
    currency: r.currency,
    amount: r.amount,
    installment_usd: r.installment_usd,
    due_date: r.due_date,
    status: r.status,
    plan_date: r.plan_date,
    deposit_date: r.deposit_date,
    deposit_account_id: r.deposit_account_id,
    reason: r.reason,
    note: r.note,
    import_note: [`${r.src} 第 ${r.row} 行`, r.import_note].filter(Boolean).join('；'),
    notes: r.notes,
  })
  const doImport = async () => {
    if (!toImport.length) return message.warning(t('没有要导入的行'))
    setImporting(true)
    setResult(null)
    setFailure(null)
    const sum: Result = { created: 0, skipped: [], customers: 0 }
    setProgress({ done: 0, total: toImport.length })
    for (let i = 0; i < toImport.length; i += BATCH) {
      const batch = toImport.slice(i, i + BATCH)
      const { data, error } = await supabase.rpc('import_cheques', { p_rows: batch.map(payload) as unknown as Json })
      if (error) {
        setFailure(t('第 {from} 到 {to} 张这一批没导进去，前面的已经导好了：{err}', { from: i + 1, to: i + batch.length, err: errorText(error) }))
        break
      }
      changed.current = true
      const d = data as unknown as Result
      sum.created += Number(d.created ?? 0)
      sum.customers += Number(d.customers ?? 0)
      sum.skipped.push(...(d.skipped ?? []).map((s) => ({ row: i + Number(s.row), cheque_no: s.cheque_no })))
      setProgress({ done: Math.min(i + BATCH, toImport.length), total: toImport.length })
    }
    setResult(sum)
    setImporting(false)
    notifyChequesChanged()
    if (sum.customers > 0) await reload()
  }

  // ---------- 表格 ----------
  const columns: ColumnsType<(typeof rows)[number]> = [
    { title: t('来源'), width: 120, render: (_, r) => `${t(r.src)} ${r.row}` },
    {
      title: t('导入后状态'),
      width: 240,
      render: (_, r) => (
        <div>
          {r.skip ? <Tag>{t('不导：{why}', { why: t(r.skip) })}</Tag> : <Tag color={CHEQUE_STATUS_COLOR[r.status]}>{t(CHEQUE_STATUS_LABEL[r.status])}</Tag>}
          {!r.skip &&
            r.warnings.map((w, i) => (
              <div key={i} className="text-warn">
                {w}
              </div>
            ))}
        </div>
      ),
    },
    { title: t('支票号'), dataIndex: 'cheque_no', width: 110, render: (v: string, r) => <span className="num">{v}{r.drawer_bank ? <div className="hint">{r.drawer_bank}</div> : null}</span> },
    { title: t('客户'), dataIndex: 'customer_name', width: 180, ellipsis: true, render: (v: string, r) => <span>{v}{r.drawer_name && r.drawer_name !== v ? <div className="hint">{r.drawer_name}</div> : null}</span> },
    { title: t('大架号'), width: 180, render: (_, r) => (r.vin ? <span className={r.vehicle_id ? 'cv-vin' : 'cv-vin text-warn'}>{r.vin}</span> : '') },
    { title: t('业务员'), dataIndex: 'salesperson_name', width: 110, ellipsis: true },
    { title: t('用途'), dataIndex: 'purpose', width: 90, render: (v: string) => t(v) },
    { title: t('金额'), width: 130, align: 'right', render: (_, r) => <span className="num">{r.amount == null ? <span className="hint">{t('空白')}</span> : `${r.currency} ${money(r.amount)}`}</span> },
    { title: t('到期日期'), dataIndex: 'due_date', width: 104 },
    { title: t('存票日期'), dataIndex: 'deposit_date', width: 104 },
    { title: t('存票账户'), width: 180, ellipsis: true, render: (_, r) => (r.deposit_account_id ? accounts.find((a) => a.id === r.deposit_account_id)?.short_name : r.deposit_account_key ? <span className="hint">{r.deposit_account_key}</span> : '') },
    { title: t('沟通记录'), width: 90, align: 'right', render: (_, r) => (r.notes.length ? t('{n} 条', { n: r.notes.length }) : '') },
    { title: t('原因 / 备注'), ellipsis: true, render: (_, r) => r.reason ?? r.note ?? r.import_note ?? '' },
  ]
  const shown = rows.filter((r) => (filter === 'all' ? true : filter === 'warn' ? !r.skip && r.warnings.length > 0 : !!r.skip))

  return (
    <Drawer
      open={open}
      className="cheque-import"
      title={t('导入支票表')}
      size={Math.min(1240, typeof window !== 'undefined' ? window.innerWidth : 1240)}
      onClose={close}
      maskClosable={!importing}
      closable={!importing}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        {t('选《支票表》Excel，系统自动认出“主表-分期合同支票明细”“其他支票明细”和“支票表存取备忘录”三张表。只导还没报回款的支票：待存、等业务确认、已存、退票、取消都会带进来，备忘录里的沟通记录一起导。客户系统里没有的会新建；合同备注里的大架号对到车上；已录过的支票自动跳过，可以多次导入。')}
      </Typography.Paragraph>
      <Upload.Dragger
        accept=".xlsx,.xls"
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
        <p className="ant-upload-text">{fileName ? t('已读取：{fileName}（点这里换一个文件）', { fileName }) : t('把支票表 Excel 拖到这里，或点击选择')}</p>
        {sheets.length > 0 && <p className="ant-upload-hint">{t('认出的工作表：{names}', { names: sheets.join('、') })}</p>}
      </Upload.Dragger>

      {parsed.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Space wrap style={{ marginBottom: 8 }}>
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: t('全部 {n}', { n: rows.length }) },
                { value: 'warn', label: t('要注意 {n}', { n: nWarn }) },
                { value: 'skip', label: t('不导 {n}', { n: nSkip }) },
              ]}
            />
            <span className="hint">
              {t('要导入 {n} 张：待存 {pending}、等业务确认 {confirming}、已存 {deposited}、退票 {bounced}、已取消 {cancelled}', {
                n: toImport.length,
                pending: byStatus('pending'),
                confirming: byStatus('confirming'),
                deposited: byStatus('deposited'),
                bounced: byStatus('bounced'),
                cancelled: byStatus('cancelled'),
              })}
            </span>
            <Button type="primary" loading={importing} disabled={!toImport.length || vehicleByVin === null || !!result} onClick={() => void doImport()}>
              {t('导入 {n} 张', { n: toImport.length })}
            </Button>
          </Space>
          {progress && <Progress percent={Math.round((progress.done / progress.total) * 100)} status={importing ? 'active' : failure ? 'exception' : 'success'} style={{ marginBottom: 8 }} />}
          {failure && <Alert type="error" showIcon message={failure} style={{ marginBottom: 8 }} />}
          {result && (
            <Alert
              type="success"
              showIcon
              className="cheque-import-result"
              style={{ marginBottom: 8 }}
              message={t('导入完成：新增 {created} 张，跳过已录过的 {skipped} 张，新建客户 {customers} 个', { created: result.created, skipped: result.skipped.length, customers: result.customers })}
              description={result.skipped.length ? <div className="hint">{t('跳过的支票号：{list}', { list: result.skipped.map((s) => s.cheque_no).join('、') })}</div> : undefined}
            />
          )}
          <Table rowKey={(r) => `${r.src}-${r.row}`} size="small" columns={columns} dataSource={shown} scroll={{ x: 1700 }} pagination={{ defaultPageSize: 50, showSizeChanger: true }} />
        </div>
      )}
    </Drawer>
  )
}
