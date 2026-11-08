import { DownloadOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  App,
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
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/errors'
import { cleanSearch, money, todayAccra, usd } from '../lib/format'
import { useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import type { Claim, Vehicle } from '../lib/supabase'

const PAY_COLOR: Record<string, string> = { 已结清: 'green', 部分到账: 'orange', 未收款: 'red' }

export default function VehiclesPage() {
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
  const [detail, setDetail] = useState<Vehicle | null>(null)
  // 只在详情还开着、而且还是同一台车时才刷新，免得用户刚关掉抽屉又被弹出来
  const refreshDetail = async (id: number) => {
    const { data } = await supabase.from('v_vehicle_ledger').select('*').eq('id', id).single()
    if (data) setDetail((cur) => (cur?.id === id ? data : cur))
  }

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('v_vehicle_ledger').select('*').order('created_at', { ascending: false }).limit(5000)
    const s = cleanSearch(q)
    if (s) query = query.or(`vin.ilike.%${s}%,customer_name.ilike.%${s}%,model.ilike.%${s}%`)
    if (spId) query = query.eq('salesperson_id', spId)
    if (payStatus) query = query.eq('pay_status', payStatus)
    if (method) query = query.eq('payment_method', method)
    if (ship) query = query.eq('ship_status', ship)
    const { data } = await query
    setRows(data ?? [])
    setLoading(false)
  }, [q, spId, payStatus, method, ship])

  useEffect(() => {
    void load()
  }, [load])

  const totals = useMemo(
    () =>
      rows.reduce(
        (t, r) => ({
          contract: t.contract + Number(r.contract_usd ?? 0),
          received: t.received + Number(r.received_usd ?? 0),
          balance: t.balance + Number(r.balance_usd ?? 0),
        }),
        { contract: 0, received: 0, balance: 0 },
      ),
    [rows],
  )

  const exportExcel = () => {
    const data = rows.map((r) => ({
      大架号: r.vin,
      车型: r.model,
      客户: r.customer_name,
      业务员: r.salesperson_name,
      合同日期: r.contract_date,
      付款方式: r.payment_method,
      合同价USD: Number(r.contract_usd),
      首付USD: r.down_payment_usd != null ? Number(r.down_payment_usd) : null,
      已到账USD: Number(r.received_usd),
      优惠折让USD: Number(r.discount_usd),
      未收余额USD: Number(r.balance_usd),
      回款状态: r.pay_status,
      可发车: r.can_ship ? '是' : '否',
      发车状态: r.ship_status,
      发车日期: r.shipped_at,
      最后到账日: r.last_received_on,
      备注: r.note,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!cols'] = Object.keys(data[0] ?? { a: 1 }).map((k) => ({ wch: k === '客户' || k === '车型' ? 24 : k === '大架号' ? 20 : 12 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '车辆台账')
    XLSX.writeFile(wb, `车辆台账-${todayAccra()}.xlsx`)
  }

  const columns: ColumnsType<Vehicle> = [
    { title: '大架号', dataIndex: 'vin', width: 180, fixed: 'left' },
    { title: '车型', dataIndex: 'model', width: 150, ellipsis: true },
    { title: '客户', dataIndex: 'customer_name', width: 180, ellipsis: true },
    { title: '业务员', dataIndex: 'salesperson_name', width: 110, ellipsis: true },
    { title: '付款方式', dataIndex: 'payment_method', width: 80 },
    { title: '合同价', dataIndex: 'contract_usd', width: 100, align: 'right', render: (v) => <span className="num">{usd(v)}</span> },
    { title: '已到账', dataIndex: 'received_usd', width: 100, align: 'right', render: (v) => <span className="num">{usd(v)}</span> },
    {
      title: '余额',
      dataIndex: 'balance_usd',
      width: 100,
      align: 'right',
      render: (v) => <span className={`num ${Number(v) > 1 ? 'text-danger' : ''}`}>{usd(v)}</span>,
    },
    { title: '回款状态', dataIndex: 'pay_status', width: 90, render: (v: string) => <Tag color={PAY_COLOR[v]}>{v}</Tag> },
    {
      title: '可发车',
      dataIndex: 'can_ship',
      width: 70,
      render: (v: boolean, r) => (r.ship_status === '已发车' ? <Tag>已发</Tag> : v ? <Tag color="green">可发</Tag> : <Tag>不可</Tag>),
    },
    { title: '最后到账', dataIndex: 'last_received_on', width: 100 },
  ]

  return (
    <div>
      <div className="page-title">
        <h2>{isStaff ? '车辆台账' : '我的车辆'}</h2>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} />
          <Button icon={<DownloadOutlined />} onClick={exportExcel} disabled={!rows.length}>
            导出 Excel
          </Button>
          {isStaff && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setForm({ open: true, vehicle: null })}>
              新增车辆
            </Button>
          )}
        </Space>
      </div>
      <Space wrap className="filters">
        <Input.Search allowClear placeholder="大架号、客户、车型" style={{ width: 240 }} onSearch={setQ} />
        {isStaff && (
          <Select
            allowClear
            placeholder="业务员"
            style={{ width: 140 }}
            showSearch={{ optionFilterProp: 'label' }}
            value={spId}
            onChange={setSpId}
            options={salespersons.map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
        <Select
          allowClear
          placeholder="回款状态"
          style={{ width: 110 }}
          value={payStatus}
          onChange={setPayStatus}
          options={['未收款', '部分到账', '已结清'].map((x) => ({ value: x, label: x }))}
        />
        <Select
          allowClear
          placeholder="付款方式"
          style={{ width: 110 }}
          value={method}
          onChange={setMethod}
          options={['全款', '分期', '预付'].map((x) => ({ value: x, label: x }))}
        />
        <Select
          allowClear
          placeholder="发车状态"
          style={{ width: 110 }}
          value={ship}
          onChange={setShip}
          options={['未发车', '已发车'].map((x) => ({ value: x, label: x }))}
        />
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1300 }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: (n) => `共 ${n} 台` }}
        rowClassName={() => 'clickable-row'}
        onRow={(r) => ({ onClick: () => setDetail(r) })}
        summary={() =>
          rows.length ? (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={5}>
                  合计
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
    message.success('已录入')
    setManual(null)
    await load()
    await onChanged()
  }

  const removeManual = async (id: number) => {
    const { error } = await supabase.from('receipt_claims').delete().eq('id', id)
    if (error) message.error(errorText(error))
    else {
      message.success('已删除')
      await load()
      await onChanged()
    }
  }

  const v = vehicle
  return (
    <Drawer open={!!v} onClose={onClose} size={860} title={v ? `${v.vin} · ${v.model}` : ''} destroyOnHidden
      extra={isStaff && v ? <Button icon={<EditOutlined />} onClick={() => onEdit(v)}>修改车辆</Button> : null}
    >
      {v && (
        <>
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="客户">{v.customer_name}</Descriptions.Item>
            <Descriptions.Item label="业务员">{v.salesperson_name ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="付款方式">
              {v.payment_method}
              {v.payment_method === '分期' && `（首付 ${usd(v.down_payment_usd)}）`}
            </Descriptions.Item>
            <Descriptions.Item label="合同日期">{v.contract_date ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="合同价">{usd(v.contract_usd)}</Descriptions.Item>
            <Descriptions.Item label="已到账">{usd(v.received_usd)}</Descriptions.Item>
            <Descriptions.Item label="优惠折让">{usd(v.discount_usd)}</Descriptions.Item>
            <Descriptions.Item label="未收余额">
              <b className={Number(v.balance_usd) > 1 ? 'text-danger' : 'text-ok'}>{usd(v.balance_usd)}</b>
            </Descriptions.Item>
            <Descriptions.Item label="回款状态">
              <Tag color={PAY_COLOR[v.pay_status ?? '']}>{v.pay_status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="发车">
              {v.ship_status}
              {v.shipped_at ? ` ${v.shipped_at}` : ''}
              {v.ship_status === '未发车' && (v.can_ship ? <Tag color="green" style={{ marginLeft: 6 }}>可发车</Tag> : <Tag style={{ marginLeft: 6 }}>未到可发车条件</Tag>)}
            </Descriptions.Item>
            {v.note && <Descriptions.Item label="备注" span={2}>{v.note}</Descriptions.Item>}
          </Descriptions>

          <div className="page-title" style={{ marginTop: 16 }}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              到账明细
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
                  录期初已到账
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    mform.resetFields()
                    mform.setFieldsValue({ claim_date: dayjs(todayAccra()) })
                    setManual('优惠折让')
                  }}
                >
                  录优惠折让
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
              { title: '日期', dataIndex: 'claim_date', width: 100 },
              { title: '性质', dataIndex: 'nature', width: 90 },
              {
                title: '金额',
                width: 150,
                align: 'right',
                render: (_, c) => (c.receipt_id ? `${c.currency} ${money(c.amount_orig)}` : ''),
              },
              { title: 'USD', dataIndex: 'amount_usd', width: 90, align: 'right', render: (x) => usd(x) },
              { title: '账户', dataIndex: 'account_name', ellipsis: true },
              {
                title: '到账编号',
                dataIndex: 'receipt_no',
                width: 150,
                render: (no: string | null, c) =>
                  no ? (
                    isStaff ? (
                      <a onClick={() => setReceiptId(c.receipt_id)}>{no}</a>
                    ) : (
                      no
                    )
                  ) : isStaff ? (
                    <Popconfirm title="删除这条记录？" onConfirm={() => removeManual(c.id as number)} disabled={!isStaff}>
                      <a className="text-danger">删除</a>
                    </Popconfirm>
                  ) : (
                    '—'
                  ),
              },
              { title: '备注', dataIndex: 'report_note', ellipsis: true },
            ]}
          />
          {!isAdmin && !isStaff && (
            <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
              只显示你名下的车。数据有误请联系财务。
            </Typography.Paragraph>
          )}
        </>
      )}
      <Modal
        open={manual !== null}
        title={manual === '期初余额' ? '录入期初已到账（系统上线前已收的钱）' : '录入优惠折让'}
        okText="保存"
        onOk={addManual}
        onCancel={() => setManual(null)}
        forceRender
      >
        <Form form={mform} layout="vertical">
          <Form.Item name="amount_usd" label="金额（USD）" rules={[{ required: true, message: '请填金额' }]}>
            <InputNumber min={0.01} precision={2} prefix="$" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="claim_date" label="日期" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="report_note" label="备注">
            <Input placeholder={manual === '优惠折让' ? '如：提前结清，老板给予$6,000折扣' : '如：2026-10-31 前累计已收'} />
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
