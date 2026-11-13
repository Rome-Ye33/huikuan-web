import { DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import {
  App,
  Badge,
  Button,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import ReceiptEditor from '../components/ReceiptEditor'
import VehicleFormModal from '../components/VehicleFormModal'
import VehicleImport from '../components/VehicleImport'
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/errors'
import { RECEIPT_STATUS_COLOR, RECEIPT_STATUS_LABEL, receiptStatus } from '../lib/flow'
import { pickCol, textCol } from '../lib/colFilter'
import { cleanSearch, money, num, todayAccra, usd } from '../lib/format'
import { useRefData } from '../lib/refdata'
import { fetchAll, supabase } from '../lib/supabase'
import type { Claim, Vehicle } from '../lib/supabase'
import { useT } from '../lib/i18n'

const PAY_COLOR: Record<string, string> = { 已结清: 'green', 部分到账: 'orange', 未收款: 'red' }

export default function VehiclesPage() {
  const t = useT()
  const { message } = App.useApp()
  const { isStaff } = useAuth()
  const { salespersons } = useRefData()
  const [rows, setRows] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [spId, setSpId] = useState<number | undefined>()
  const [payStatus, setPayStatus] = useState<string | undefined>()
  const [method, setMethod] = useState<string | undefined>()
  const [ship, setShip] = useState<string | undefined>()
  const [form, setForm] = useState<{ open: boolean; vehicle: Vehicle | null }>({ open: false, vehicle: null })
  const [importOpen, setImportOpen] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [deleting, setDeleting] = useState(false)
  const [detail, setDetail] = useState<Vehicle | null>(null)
  const [unlockedOpen, setUnlockedOpen] = useState(false)
  const [unlockedCount, setUnlockedCount] = useState(0)
  // 只在详情还开着、而且还是同一台车时才刷新，免得用户刚关掉抽屉又被弹出来
  const refreshDetail = async (id: number) => {
    const { data } = await supabase.from('v_vehicle_ledger').select('*').eq('id', id).single()
    if (data) setDetail((cur) => (cur?.id === id ? data : cur))
  }

  const load = useCallback(async () => {
    setLoading(true)
    const s = cleanSearch(q)
    const make = () => {
      // 批量导入的车 created_at 一样，按 id 再排一次，翻页才不会重复或漏行
      let query = supabase.from('v_vehicle_ledger').select('*').order('created_at', { ascending: false }).order('id', { ascending: false })
      if (s) query = query.or(`vin.ilike.%${s}%,customer_name.ilike.%${s}%,model.ilike.%${s}%`)
      if (spId) query = query.eq('salesperson_id', spId)
      if (payStatus) query = query.eq('pay_status', payStatus)
      if (method) query = query.eq('payment_method', method)
      if (ship) query = query.eq('ship_status', ship)
      return query
    }
    const { data } = await fetchAll<Vehicle>(make)
    setRows(data)
    setSelected([])
    setLoading(false)
  }, [q, spId, payStatus, method, ship])

  // 批量删除（财务、管理员）：有到账记录、在提成单上、有待审核到账提交的车不删，其余连同导入时记的期初一起删
  const removeSelected = async () => {
    const ids = selected
    if (!ids.length) return
    setDeleting(true)
    try {
      const refused = new Map<number, string>()
      for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await supabase.from('receipt_claims').select('vehicle_id').in('vehicle_id', ids.slice(i, i + 150)).is('import_key', null)
        if (error) throw error
        for (const c of data ?? []) if (c.vehicle_id) refused.set(c.vehicle_id, t('有到账记录'))
      }
      const [{ data: vouchers, error: e1 }, { data: subs, error: e2 }] = await Promise.all([
        supabase.from('commission_vouchers').select('vehicles'),
        supabase.from('receipt_submissions').select('claims').eq('status', 'pending'),
      ])
      if (e1) throw e1
      if (e2) throw e2
      const onVoucher = new Set<number>()
      for (const v of vouchers ?? []) for (const x of (v.vehicles as { vehicle_id?: number }[]) ?? []) if (x.vehicle_id) onVoucher.add(x.vehicle_id)
      const onSub = new Set<number>()
      for (const s of subs ?? []) for (const x of (s.claims as { vehicle_id?: number }[]) ?? []) if (x.vehicle_id) onSub.add(x.vehicle_id)
      for (const id of ids) {
        if (onVoucher.has(id)) refused.set(id, t('在提成单上'))
        else if (onSub.has(id) && !refused.has(id)) refused.set(id, t('有待审核的到账提交'))
      }
      const ok = ids.filter((id) => !refused.has(id))
      let deleted = 0
      for (let i = 0; i < ok.length; i += 150) {
        const chunk = ok.slice(i, i + 150)
        const r1 = await supabase.from('receipt_claims').delete().in('vehicle_id', chunk).not('import_key', 'is', null)
        if (r1.error) throw r1.error
        const r2 = await supabase.from('vehicles').delete().in('id', chunk).select('id')
        if (r2.error) throw r2.error
        deleted += r2.data?.length ?? 0
      }
      if (refused.size) {
        const byId = new Map(rows.map((r) => [r.id as number, r.vin]))
        const list = [...refused.entries()].slice(0, 10).map(([id, why]) => `${byId.get(id) ?? id}（${why}）`).join('、')
        message.warning(t('已删除 {n} 台；{m} 台没删：{list}', { n: deleted, m: refused.size, list: list + (refused.size > 10 ? '…' : '') }), 8)
      } else {
        message.success(t('已删除 {n} 台', { n: deleted }))
      }
    } catch (e) {
      message.error(errorText(e))
    } finally {
      setDeleting(false)
      await load()
      void loadUnlocked()
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  // 大架号未锁定的到账有几笔（钱到了、记在客户名下，还没定是哪台车）
  const loadUnlocked = useCallback(async () => {
    const { count } = await supabase
      .from('v_receipt_claims')
      .select('id', { count: 'exact', head: true })
      .is('vehicle_id', null)
      .in('nature_kind', ['payment', 'opening'])
      .or('receipt_status.is.null,receipt_status.eq.approved') // 审批中、退回的到账还不算
    setUnlockedCount(count ?? 0)
  }, [])

  useEffect(() => {
    void loadUnlocked()
  }, [loadUnlocked])

  /** 列头筛选后表里实际显示的行（合计按它算） */
  const [shown, setShown] = useState<Vehicle[] | null>(null)
  const totals = useMemo(
    () =>
      (shown ?? rows).reduce(
        (acc, r) => ({
          contract: acc.contract + Number(r.contract_usd ?? 0),
          received: acc.received + Number(r.received_usd ?? 0),
          balance: acc.balance + Number(r.balance_usd ?? 0),
        }),
        { contract: 0, received: 0, balance: 0 },
      ),
    [rows, shown],
  )

  const exportExcel = () => {
    // 表头和状态跟着界面语言走：[表头, 列宽, 取值]
    const cols: [string, number, (r: Vehicle) => unknown][] = [
      [t('大架号'), 20, (r) => r.vin],
      [t('车型'), 24, (r) => r.model],
      [t('客户'), 24, (r) => r.customer_name],
      [t('业务员'), 12, (r) => r.salesperson_name],
      [t('合同日期'), 12, (r) => r.contract_date],
      [t('付款方式'), 10, (r) => t(r.payment_method ?? '')],
      [t('合同价USD'), 12, (r) => Number(r.contract_usd)],
      [t('首付USD'), 12, (r) => (r.down_payment_usd != null ? Number(r.down_payment_usd) : null)],
      [t('已到账USD'), 12, (r) => Number(r.received_usd)],
      [t('优惠折让USD'), 12, (r) => Number(r.discount_usd)],
      [t('未收余额USD'), 12, (r) => Number(r.balance_usd)],
      [t('回款状态'), 12, (r) => t(r.pay_status ?? '')],
      [t('可发车'), 8, (r) => (r.can_ship ? t('是') : t('否'))],
      [t('发车状态'), 10, (r) => t(r.ship_status ?? '')],
      [t('发车日期'), 12, (r) => r.shipped_at],
      [t('最后到账日'), 12, (r) => r.last_received_on],
      [t('备注'), 24, (r) => r.note],
    ]
    const ws = XLSX.utils.aoa_to_sheet([cols.map((c) => c[0]), ...rows.map((r) => cols.map((c) => c[2](r)))])
    ws['!cols'] = cols.map((c) => ({ wch: c[1] }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, t('车辆台账'))
    XLSX.writeFile(wb, `${t('车辆台账')}-${todayAccra()}.xlsx`)
  }

  const columns: ColumnsType<Vehicle> = [
    { title: t('大架号'), dataIndex: 'vin', width: 180, fixed: 'left', ...textCol<Vehicle>((r) => r.vin) },
    { title: t('车型'), dataIndex: 'model', width: 150, ellipsis: true, ...textCol<Vehicle>((r) => r.model) },
    { title: t('客户'), dataIndex: 'customer_name', width: 180, ellipsis: true, ...textCol<Vehicle>((r) => r.customer_name) },
    { title: t('业务员'), dataIndex: 'salesperson_name', width: 110, ellipsis: true, ...pickCol(rows, (r) => r.salesperson_name) },
    { title: t('付款方式'), dataIndex: 'payment_method', width: 80, render: (v: string) => t(v), ...pickCol(rows, (r) => r.payment_method, t) },
    { title: t('合同价'), dataIndex: 'contract_usd', width: 100, align: 'right', render: (v) => <span className="num">{usd(v)}</span> },
    { title: t('已到账'), dataIndex: 'received_usd', width: 100, align: 'right', render: (v) => <span className="num">{usd(v)}</span> },
    {
      title: t('余额'),
      dataIndex: 'balance_usd',
      width: 100,
      align: 'right',
      render: (v) => <span className={`num ${Number(v) > 1 ? 'text-danger' : ''}`}>{usd(v)}</span>,
    },
    { title: t('回款状态'), dataIndex: 'pay_status', width: 90, render: (v: string) => <Tag color={PAY_COLOR[v]}>{t(v)}</Tag>, ...pickCol(rows, (r) => r.pay_status, t) },
    {
      title: t('可发车'),
      dataIndex: 'can_ship',
      width: 70,
      render: (v: boolean, r) => (r.ship_status === '已发车' ? <Tag>{t('已发')}</Tag> : v ? <Tag color="green">{t('可发')}</Tag> : <Tag>{t('不可')}</Tag>),
    },
    { title: t('最后到账'), dataIndex: 'last_received_on', width: 100 },
  ]

  return (
    <div>
      <div className="page-title">
        <h2>{isStaff ? t('车辆台账') : t('我的车辆')}</h2>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} />
          <Badge count={unlockedCount} size="small" color="orange">
            <Button onClick={() => setUnlockedOpen(true)}>{t('大架号未锁定的到账')}</Button>
          </Badge>
          <Button icon={<DownloadOutlined />} onClick={exportExcel} disabled={!rows.length}>
            {t('导出 Excel')}
          </Button>
          {isStaff && (
            <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
              {t('批量导入')}
            </Button>
          )}
          {isStaff && selected.length > 0 && (
            <Popconfirm
              title={t('删除选中的 {n} 台车？有到账记录、在提成单上的不会删。', { n: selected.length })}
              okText={t('删除')}
              okButtonProps={{ danger: true }}
              onConfirm={() => void removeSelected()}
            >
              <Button danger icon={<DeleteOutlined />} loading={deleting}>
                {t('删除选中 {n} 台', { n: selected.length })}
              </Button>
            </Popconfirm>
          )}
          {isStaff && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setForm({ open: true, vehicle: null })}>
              {t('新增车辆')}
            </Button>
          )}
        </Space>
      </div>
      <Space wrap className="filters">
        <Input.Search allowClear placeholder={t('大架号、客户、车型')} style={{ width: 240 }} onSearch={setQ} />
        {isStaff && (
          <Select
            allowClear
            placeholder={t('业务员')}
            style={{ width: 140 }}
            showSearch={{ optionFilterProp: 'label' }}
            value={spId}
            onChange={setSpId}
            options={salespersons.map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
        <Select
          allowClear
          placeholder={t('回款状态')}
          style={{ width: 110 }}
          value={payStatus}
          onChange={setPayStatus}
          options={['未收款', '部分到账', '已结清'].map((x) => ({ value: x, label: t(x) }))}
        />
        <Select
          allowClear
          placeholder={t('付款方式')}
          style={{ width: 110 }}
          value={method}
          onChange={setMethod}
          options={['全款', '分期', '预付', '挂账'].map((x) => ({ value: x, label: t(x) }))}
        />
        <Select
          allowClear
          placeholder={t('发车状态')}
          style={{ width: 110 }}
          value={ship}
          onChange={setShip}
          options={['未发车', '已发车'].map((x) => ({ value: x, label: t(x) }))}
        />
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1300 }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: (n) => t('共 {n} 台', { n }) }}
        rowClassName={() => 'clickable-row'}
        onRow={(r) => ({ onClick: (e) => !(e.target as HTMLElement).closest('.ant-table-selection-column') && setDetail(r) })}
        onChange={(_, __, ___, extra) => setShown(extra.currentDataSource)}
        rowSelection={
          isStaff
            ? {
                selectedRowKeys: selected,
                onChange: (keys) => setSelected(keys as number[]),
                selections: [Table.SELECTION_ALL, Table.SELECTION_NONE],
                columnWidth: 40,
                fixed: true,
              }
            : undefined
        }
        summary={() =>
          rows.length ? (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={isStaff ? 6 : 5}>
                  {t('合计')}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">
                  <span className="num">{usd(totals.contract)}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="right">
                  <span className="num">{usd(totals.received)}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={7} align="right">
                  <span className="num">{usd(totals.balance)}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={8} colSpan={3} />
              </Table.Summary.Row>
            </Table.Summary>
          ) : null
        }
      />
      <VehicleImport
        open={importOpen}
        onClose={(changed) => {
          setImportOpen(false)
          if (changed) void load()
        }}
      />
      <VehicleFormModal
        open={form.open}
        vehicle={form.vehicle}
        onClose={async (savedId) => {
          setForm({ open: false, vehicle: null })
          if (savedId) {
            await load()
            await refreshDetail(savedId)
          }
        }}
      />
      <UnlockedDrawer
        open={unlockedOpen}
        onClose={() => setUnlockedOpen(false)}
        onChanged={async () => {
          await load()
          await loadUnlocked()
        }}
      />
      <VehicleDrawer
        vehicle={detail}
        onClose={() => setDetail(null)}
        onEdit={(v) => setForm({ open: true, vehicle: v })}
        onChanged={async () => {
          await load()
          if (detail?.id) await refreshDetail(detail.id)
        }}
      />
    </div>
  )
}

/** 大架号未锁定的到账：钱到了、记在客户名下，还没定是哪台车。财务知道是哪台车后打开到账把车选上 */
function UnlockedDrawer({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const t = useT()
  const { isStaff } = useAuth()
  const [rows, setRows] = useState<Claim[]>([])
  const [loading, setLoading] = useState(false)
  const [receiptId, setReceiptId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('v_receipt_claims')
      .select('*')
      .is('vehicle_id', null)
      .in('nature_kind', ['payment', 'opening'])
      .or('receipt_status.is.null,receipt_status.eq.approved') // 审批中、退回的到账还不算
      .order('claim_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(2000)
    setRows(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const total = rows.reduce((s, r) => s + num(r.amount_usd), 0)

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={Math.min(1000, typeof window !== 'undefined' ? window.innerWidth : 1000)}
      title={t('大架号未锁定的到账')}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        {isStaff
          ? t('这些钱已经到账、记在客户名下，但还没定是哪台车，不算进任何一台车的回款。知道是哪台车后，点到账编号打开，把车选上就锁定了。')
          : t('这些钱已经到账、记在客户名下，但还没定是哪台车，不算进任何一台车的回款。知道是哪台车后请告诉财务。')}
      </Typography.Paragraph>
      <Table
        rowKey={(r) => r.id as number}
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ defaultPageSize: 50, showTotal: (n) => t('共 {n} 笔', { n }) }}
        scroll={{ x: 940 }}
        columns={[
          { title: t('日期'), dataIndex: 'claim_date', width: 100 },
          { title: t('客户'), dataIndex: 'customer_name', width: 180, ellipsis: true },
          { title: t('业务员'), dataIndex: 'salesperson_name', width: 100, ellipsis: true },
          { title: t('数量与设备型号'), dataIndex: 'model_desc', ellipsis: true },
          { title: t('性质'), dataIndex: 'nature', width: 90, render: (x: string) => t(x) },
          {
            title: t('金额'),
            width: 140,
            align: 'right',
            render: (_, c) => (c.receipt_id ? <span className="num">{`${c.currency} ${money(c.amount_orig)}`}</span> : ''),
          },
          { title: 'USD', dataIndex: 'amount_usd', width: 100, align: 'right', render: (x) => <span className="num">{usd(x)}</span> },
          {
            title: t('到账编号'),
            dataIndex: 'receipt_no',
            width: 150,
            render: (no: string | null, c) => (no ? isStaff ? <a onClick={() => setReceiptId(c.receipt_id)}>{no}</a> : no : '—'),
          },
        ]}
        summary={() =>
          rows.length ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={6}>
                {t('合计')}
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right">
                <span className="num">{usd(total)}</span>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={7} />
            </Table.Summary.Row>
          ) : null
        }
      />
      <ReceiptEditor
        open={receiptId !== null}
        receiptId={receiptId}
        onClose={async (changed) => {
          setReceiptId(null)
          if (changed) {
            await load()
            await onChanged()
          }
        }}
      />
    </Drawer>
  )
}

function VehicleDrawer({
  vehicle,
  onClose,
  onEdit,
  onChanged,
}: {
  vehicle: Vehicle | null
  onClose: () => void
  onEdit: (v: Vehicle) => void
  onChanged: () => Promise<void>
}) {
  const t = useT()
  const { isStaff, isAdmin } = useAuth()
  const { message } = App.useApp()
  const [claims, setClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(false)
  const [manual, setManual] = useState<'期初余额' | '优惠折让' | null>(null)
  const [receiptId, setReceiptId] = useState<number | null>(null)
  const [mform] = Form.useForm<{ amount_usd: number; claim_date: dayjs.Dayjs; report_note?: string }>()

  const load = useCallback(async () => {
    if (!vehicle?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('v_receipt_claims')
      .select('*')
      .eq('vehicle_id', vehicle.id)
      .order('claim_date')
      .order('id')
    setClaims(data ?? [])
    setLoading(false)
  }, [vehicle?.id])

  useEffect(() => {
    void load()
  }, [load])

  const addManual = async () => {
    const v = await mform.validateFields()
    const { error } = await supabase.from('receipt_claims').insert({
      vehicle_id: vehicle!.id,
      nature: manual!,
      amount_usd: v.amount_usd,
      claim_date: v.claim_date.format('YYYY-MM-DD'),
      report_note: v.report_note?.trim() || null,
      claim_no: '', // 编号由数据库触发器生成
    })
    if (error) {
      message.error(errorText(error))
      return
    }
    message.success(t('已录入'))
    setManual(null)
    await load()
    await onChanged()
  }

  const removeManual = async (id: number) => {
    const { error } = await supabase.from('receipt_claims').delete().eq('id', id)
    if (error) message.error(errorText(error))
    else {
      message.success(t('已删除'))
      await load()
      await onChanged()
    }
  }

  const v = vehicle
  return (
    <Drawer open={!!v} onClose={onClose} size={860} title={v ? `${v.vin} · ${v.model}` : ''} destroyOnHidden
      extra={isStaff && v ? <Button icon={<EditOutlined />} onClick={() => onEdit(v)}>{t('修改车辆')}</Button> : null}
    >
      {v && (
        <>
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label={t('客户')}>{v.customer_name}</Descriptions.Item>
            <Descriptions.Item label={t('业务员')}>{v.salesperson_name ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={t('付款方式')}>
              {t(v.payment_method ?? '')}
              {v.payment_method === '分期' && t('（首付 {amt}）', { amt: usd(v.down_payment_usd) })}
            </Descriptions.Item>
            <Descriptions.Item label={t('合同日期')}>{v.contract_date ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={t('合同价')}>{usd(v.contract_usd)}</Descriptions.Item>
            <Descriptions.Item label={t('已到账')}>{usd(v.received_usd)}</Descriptions.Item>
            <Descriptions.Item label={t('优惠折让')}>{usd(v.discount_usd)}</Descriptions.Item>
            <Descriptions.Item label={t('未收余额')}>
              <b className={Number(v.balance_usd) > 1 ? 'text-danger' : 'text-ok'}>{usd(v.balance_usd)}</b>
            </Descriptions.Item>
            <Descriptions.Item label={t('回款状态')}>
              <Tag color={PAY_COLOR[v.pay_status ?? '']}>{t(v.pay_status ?? '')}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t('发车')}>
              {t(v.ship_status ?? '')}
              {v.shipped_at ? ` ${v.shipped_at}` : ''}
              {v.ship_status === '未发车' && (v.can_ship ? <Tag color="green" style={{ marginLeft: 6 }}>{t('可发车')}</Tag> : <Tag style={{ marginLeft: 6 }}>{t('未到可发车条件')}</Tag>)}
            </Descriptions.Item>
            {v.note && <Descriptions.Item label={t('备注')} span={2}>{v.note}</Descriptions.Item>}
          </Descriptions>

          <div className="page-title" style={{ marginTop: 16 }}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              {t('到账明细')}
            </Typography.Title>
            {isStaff && (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    mform.resetFields()
                    mform.setFieldsValue({ claim_date: dayjs(todayAccra()) })
                    setManual('期初余额')
                  }}
                >
                  {t('录期初已到账')}
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    mform.resetFields()
                    mform.setFieldsValue({ claim_date: dayjs(todayAccra()) })
                    setManual('优惠折让')
                  }}
                >
                  {t('录优惠折让')}
                </Button>
              </Space>
            )}
          </div>
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={claims}
            pagination={false}
            scroll={{ x: 760 }}
            columns={[
              { title: t('日期'), dataIndex: 'claim_date', width: 100 },
              { title: t('性质'), dataIndex: 'nature', width: 90, render: (x: string) => t(x) },
              {
                title: t('金额'),
                width: 150,
                align: 'right',
                render: (_, c) => (c.receipt_id ? `${c.currency} ${money(c.amount_orig)}` : ''),
              },
              { title: 'USD', dataIndex: 'amount_usd', width: 90, align: 'right', render: (x) => usd(x) },
              { title: t('账户'), dataIndex: 'account_name', ellipsis: true },
              {
                title: t('到账编号'),
                dataIndex: 'receipt_no',
                width: 150,
                render: (no: string | null, c) =>
                  no ? (
                    <Space size={4}>
                      {isStaff ? <a onClick={() => setReceiptId(c.receipt_id)}>{no}</a> : no}
                      {receiptStatus(c.receipt_status) !== 'approved' && (
                        <Tag color={RECEIPT_STATUS_COLOR[receiptStatus(c.receipt_status)]}>{t(RECEIPT_STATUS_LABEL[receiptStatus(c.receipt_status)])}</Tag>
                      )}
                    </Space>
                  ) : isStaff ? (
                    <Popconfirm title={t('删除这条记录？')} onConfirm={() => removeManual(c.id as number)} disabled={!isStaff}>
                      <a className="text-danger">{t('删除')}</a>
                    </Popconfirm>
                  ) : (
                    '—'
                  ),
              },
              { title: t('备注'), dataIndex: 'report_note', ellipsis: true },
            ]}
          />
          {!isAdmin && !isStaff && (
            <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
              {t('只显示你名下的车。数据有误请联系财务。')}
            </Typography.Paragraph>
          )}
        </>
      )}
      <Modal
        open={manual !== null}
        title={manual === '期初余额' ? t('录入期初已到账（系统上线前已收的钱）') : t('录入优惠折让')}
        okText={t('保存')}
        onOk={addManual}
        onCancel={() => setManual(null)}
        forceRender
      >
        <Form form={mform} layout="vertical">
          <Form.Item name="amount_usd" label={t('金额（USD）')} rules={[{ required: true, message: t('请填金额') }]}>
            <InputNumber min={0.01} precision={2} prefix="$" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="claim_date" label={t('日期')} rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="report_note" label={t('备注')}>
            <Input placeholder={manual === '优惠折让' ? t('如：提前结清，老板给予$6,000折扣') : t('如：2026-10-31 前累计已收')} />
          </Form.Item>
        </Form>
      </Modal>
      <ReceiptEditor
        open={receiptId !== null}
        receiptId={receiptId}
        onClose={async (changed) => {
          setReceiptId(null)
          if (changed) {
            await load()
            await onChanged()
          }
        }}
      />
    </Drawer>
  )
}
