import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/errors'
import { money, num, round2, todayAccra, usd } from '../lib/format'
import { accountOptions, lookupRate, useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import type { Receipt, Vehicle } from '../lib/supabase'
import type { Json } from '../lib/database.types'
import CustomerSelect from './CustomerSelect'
import ReportBox from './ReportBox'
import VehicleFormModal from './VehicleFormModal'
import VehicleSelect from './VehicleSelect'
import Vouchers from './Vouchers'

export type ReceiptPrefill = {
  account_id?: number
  receipt_date?: string
  amount_orig?: number
  payer_summary?: string | null
  bank_ref?: string | null
  cheque_no?: string | null
  /** 由哪条银行对账单流水生成 */
  line_id?: number
}

type Props = {
  open: boolean
  receiptId?: number | null
  prefill?: ReceiptPrefill | null
  onClose: (changed: boolean) => void
}

type ClaimDraft = {
  key: string
  id?: number
  nature?: string
  vehicle_id?: number | null
  customer_id?: number | null
  amount_orig?: number | null
  report_note?: string
}

type FormValues = {
  account_id?: number
  receipt_date?: dayjs.Dayjs
  amount_orig?: number | null
  fx_rate?: number | null
  payer_summary?: string
  cheque_no?: string
  bank_ref?: string
  note?: string
}

let keySeq = 0
const newKey = () => `k${++keySeq}`

function defaultNature(v: Vehicle): string {
  const received = num(v.received_usd)
  if (v.payment_method === '预付') return '预付款'
  if (v.payment_method === '分期') return received < num(v.down_payment_usd) ? '首付款' : '分期款'
  return received > 0 ? '全款尾款' : '全款'
}

export default function ReceiptEditor({ open, receiptId, prefill, onClose }: Props) {
  const { isStaff, isAdmin } = useAuth()
  const { accounts, accountById, natures, natureByName } = useRefData()
  const { message, modal } = App.useApp()
  const [form] = Form.useForm<FormValues>()

  const [currentId, setCurrentId] = useState<number | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [reportText, setReportText] = useState('')
  const [claims, setClaims] = useState<ClaimDraft[]>([])
  const [vehicles, setVehicles] = useState<Map<number, Vehicle>>(new Map())
  const [attachments, setAttachments] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [changed, setChanged] = useState(false)
  const [newVehicleFor, setNewVehicleFor] = useState<string | null>(null)
  const rateTouched = useRef(false)

  const accountId = Form.useWatch('account_id', form)
  const amount = num(Form.useWatch('amount_orig', form))
  const rate = num(Form.useWatch('fx_rate', form))
  const account = accountId ? accountById.get(accountId) : undefined
  const currency = account?.currency ?? ''
  const isUsd = currency === 'USD'
  const readOnly = !isStaff

  const rememberVehicles = useCallback((list: (Vehicle | null | undefined)[]) => {
    setVehicles((m) => {
      const next = new Map(m)
      for (const v of list) if (v?.id != null) next.set(v.id, v)
      return next
    })
  }, [])

  const load = useCallback(
    async (id: number) => {
      setLoading(true)
      const [r, c, t] = await Promise.all([
        supabase.from('v_bank_receipts').select('*').eq('id', id).single(),
        supabase.from('v_receipt_claims').select('*').eq('receipt_id', id).order('id'),
        supabase.rpc('receipt_report_text', { p_receipt_id: id }),
      ])
      if (r.error) {
        message.error(errorText(r.error))
        setLoading(false)
        return
      }
      const rec = r.data
      setReceipt(rec)
      setCurrentId(id)
      setReportText(t.data ?? '')
      setAttachments(rec.attachments ?? [])
      rateTouched.current = true
      form.setFieldsValue({
        account_id: rec.account_id ?? undefined,
        receipt_date: rec.receipt_date ? dayjs(rec.receipt_date) : undefined,
        amount_orig: num(rec.amount_orig),
        fx_rate: num(rec.fx_rate),
        payer_summary: rec.payer_summary ?? '',
        cheque_no: rec.cheque_no ?? '',
        bank_ref: rec.bank_ref ?? '',
        note: rec.note ?? '',
      })
      const rows = (c.data ?? []).map<ClaimDraft>((x) => ({
        key: newKey(),
        id: x.id ?? undefined,
        nature: x.nature ?? undefined,
        vehicle_id: x.vehicle_id,
        customer_id: x.customer_id,
        amount_orig: x.amount_orig != null ? num(x.amount_orig) : null,
        report_note: x.report_note ?? '',
      }))
      setClaims(rows)
      const vids = rows.map((x) => x.vehicle_id).filter((x): x is number => x != null)
      if (vids.length) {
        const v = await supabase.from('v_vehicle_ledger').select('*').in('id', vids)
        rememberVehicles(v.data ?? [])
      }
      setDirty(false)
      setLoading(false)
    },
    [form, message, rememberVehicles],
  )

  // 打开时：编辑 → 读数据；新建 → 清空并预填
  useEffect(() => {
    if (!open) return
    setChanged(false)
    setDirty(false)
    if (receiptId) {
      void load(receiptId)
    } else {
      setCurrentId(null)
      setReceipt(null)
      setReportText('')
      setAttachments([])
      setVehicles(new Map())
      rateTouched.current = false
      form.resetFields()
      form.setFieldsValue({
        account_id: prefill?.account_id,
        receipt_date: dayjs(prefill?.receipt_date ?? todayAccra()),
        amount_orig: prefill?.amount_orig ?? null,
        payer_summary: prefill?.payer_summary ?? '',
        bank_ref: prefill?.bank_ref ?? '',
        cheque_no: prefill?.cheque_no ?? '',
      })
      setClaims([{ key: newKey() }])
    }
  }, [open, receiptId, prefill, load, form])

  // 换账户或日期：自动带汇率（手工改过就不再覆盖）
  const receiptDate = Form.useWatch('receipt_date', form)
  useEffect(() => {
    if (!open || !currency) return
    if (isUsd) {
      form.setFieldValue('fx_rate', 1)
      return
    }
    if (rateTouched.current) return
    const d = receiptDate ? receiptDate.format('YYYY-MM-DD') : todayAccra()
    void lookupRate(currency, d).then((r) => {
      if (!rateTouched.current) form.setFieldValue('fx_rate', r)
    })
  }, [open, currency, isUsd, receiptDate, form])

  const claimedTotal = useMemo(() => round2(claims.reduce((s, c) => s + num(c.amount_orig), 0)), [claims])
  const remaining = round2(amount - claimedTotal)

  const setRow = (key: string, patch: Partial<ClaimDraft>) => {
    setDirty(true)
    setClaims((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const pickVehicle = (key: string, id: number | null, v: Vehicle | null) => {
    if (v) rememberVehicles([v])
    setDirty(true)
    setClaims((rows) => {
      const others = round2(rows.filter((r) => r.key !== key).reduce((s, r) => s + num(r.amount_orig), 0))
      return rows.map((r) => {
        if (r.key !== key) return r
        const next: ClaimDraft = { ...r, vehicle_id: id, customer_id: v?.customer_id ?? r.customer_id }
        if (v && !r.nature) next.nature = defaultNature(v)
        if (v && !r.amount_orig && amount > others) next.amount_orig = round2(amount - others)
        return next
      })
    })
  }

  const addRow = () => {
    setDirty(true)
    setClaims((rows) => [...rows, { key: newKey(), amount_orig: remaining > 0 ? remaining : null }])
  }

  const refundRemaining = () => {
    const first = claims.find((c) => c.customer_id || c.vehicle_id)
    const customerId = first?.customer_id ?? (first?.vehicle_id ? vehicles.get(first.vehicle_id)?.customer_id : null) ?? null
    setDirty(true)
    setClaims((rows) => [...rows, { key: newKey(), nature: '退款', customer_id: customerId, amount_orig: remaining }])
  }

  const validateClaims = (rows: ClaimDraft[]): string | null => {
    for (const [i, r] of rows.entries()) {
      const n = r.nature ? natureByName.get(r.nature) : undefined
      const label = `第 ${i + 1} 行`
      if (!n) return `${label}：请选款项性质`
      if (!(num(r.amount_orig) > 0)) return `${label}：请填金额`
      if (n.kind === 'payment' && !r.vehicle_id) return `${label}：“${n.name}”必须选车`
      if ((n.kind === 'refund' || n.kind === 'parts') && !r.vehicle_id && !r.customer_id) return `${label}：请选车或客户`
    }
    const total = round2(rows.reduce((s, r) => s + num(r.amount_orig), 0))
    if (total > amount + 0.001) return `拆分合计 ${money(total)} 超过到账金额 ${money(amount)}`
    return null
  }

  const save = async () => {
    let v: FormValues
    try {
      v = await form.validateFields()
    } catch {
      return
    }
    const rows = claims.filter((c) => c.nature || c.vehicle_id || c.customer_id || num(c.amount_orig) > 0)
    const err = validateClaims(rows)
    if (err) {
      message.error(err)
      return
    }
    const p_receipt: { [k: string]: Json | undefined } = {
      receipt_date: v.receipt_date!.format('YYYY-MM-DD'),
      account_id: v.account_id ?? null,
      amount_orig: v.amount_orig ?? null,
      fx_rate: isUsd ? null : (v.fx_rate ?? null),
      payer_summary: v.payer_summary ?? '',
      bank_ref: v.bank_ref ?? '',
      cheque_no: v.cheque_no ?? '',
      note: v.note ?? '',
      attachments,
    }
    if (currentId) p_receipt.id = currentId
    else if (prefill?.line_id) p_receipt.line_id = prefill.line_id
    const p_claims = rows.map((r) => ({
      id: r.id ?? null,
      nature: r.nature ?? null,
      vehicle_id: r.vehicle_id ?? null,
      customer_id: r.vehicle_id ? null : (r.customer_id ?? null),
      amount_orig: round2(num(r.amount_orig)),
      report_note: r.report_note ?? '',
    }))
    setSaving(true)
    const { data, error } = await supabase.rpc('save_receipt', { p_receipt, p_claims: p_claims as Json })
    setSaving(false)
    if (error) {
      message.error('保存失败：' + errorText(error))
      return
    }
    message.success(currentId ? '已保存' : '已保存，报款文字在下面')
    setChanged(true)
    await load(data)
  }

  const remove = () => {
    if (!currentId) return
    modal.confirm({
      title: `删除到账 ${receipt?.receipt_no}？`,
      content: '会连同它的拆分一起删除，不能恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        const a = await supabase.rpc('save_claims', { p_receipt_id: currentId, p_claims: [] })
        if (a.error) {
          message.error(errorText(a.error))
          return
        }
        const b = await supabase.from('bank_receipts').delete().eq('id', currentId)
        if (b.error) {
          message.error(errorText(b.error))
          return
        }
        message.success('已删除')
        onClose(true)
      },
    })
  }

  const close = () => {
    if (dirty && !readOnly) {
      modal.confirm({
        title: '有改动还没保存，确定关闭？',
        okText: '不保存，关闭',
        onOk: () => onClose(changed),
      })
    } else onClose(changed)
  }

  const natureOptions = natures
    .filter((n) => n.active && (n.kind === 'payment' || n.kind === 'parts' || n.kind === 'refund'))
    .map((n) => ({ value: n.name, label: n.name }))

  const columns = [
    {
      title: '款项性质',
      width: 120,
      render: (_: unknown, r: ClaimDraft) => (
        <Select
          value={r.nature}
          options={natureOptions}
          style={{ width: '100%' }}
          placeholder="选择"
          disabled={readOnly}
          onChange={(x: string) => setRow(r.key, { nature: x })}
        />
      ),
    },
    {
      title: '车辆（大架号）',
      render: (_: unknown, r: ClaimDraft) => {
        const v = r.vehicle_id ? vehicles.get(r.vehicle_id) : undefined
        return (
          <div>
            <Space.Compact style={{ width: '100%' }}>
              <VehicleSelect
                value={r.vehicle_id}
                known={[...vehicles.values()]}
                style={{ width: '100%' }}
                disabled={readOnly}
                onChange={(id, veh) => pickVehicle(r.key, id, veh)}
              />
              {!readOnly && (
                <Tooltip title="系统里还没有这台车？新增一台">
                  <Button icon={<PlusOutlined />} onClick={() => setNewVehicleFor(r.key)} />
                </Tooltip>
              )}
            </Space.Compact>
            {v ? (
              <div className="hint">
                {v.customer_name} · {v.salesperson_name ?? '无业务员'} · 合同 {usd(v.contract_usd)} · 已到 {usd(v.received_usd)} · 余额{' '}
                {usd(v.balance_usd)}
              </div>
            ) : (
              r.nature &&
              natureByName.get(r.nature)?.kind !== 'payment' && (
                <CustomerSelect
                  value={r.customer_id}
                  onChange={(id) => setRow(r.key, { customer_id: id })}
                  placeholder="不选车时选客户"
                  style={{ width: '100%', marginTop: 4 }}
                />
              )
            )}
          </div>
        )
      },
    },
    {
      title: `金额 ${currency}`,
      width: 150,
      render: (_: unknown, r: ClaimDraft) => (
        <InputNumber
          value={r.amount_orig ?? undefined}
          min={0}
          precision={2}
          style={{ width: '100%' }}
          disabled={readOnly}
          onChange={(x) => setRow(r.key, { amount_orig: x == null ? null : Number(x) })}
        />
      ),
    },
    {
      title: 'USD',
      width: 90,
      align: 'right' as const,
      render: (_: unknown, r: ClaimDraft) => (rate > 0 && r.amount_orig ? usd(num(r.amount_orig) / rate) : ''),
    },
    {
      title: '报款备注（可空）',
      width: 180,
      render: (_: unknown, r: ClaimDraft) => (
        <Input
          value={r.report_note}
          placeholder="如：老板给予$500折扣"
          disabled={readOnly}
          onChange={(e) => setRow(r.key, { report_note: e.target.value })}
        />
      ),
    },
    ...(readOnly
      ? []
      : [
          {
            title: '',
            width: 44,
            render: (_: unknown, r: ClaimDraft) => (
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => {
                  setDirty(true)
                  setClaims((rows) => rows.filter((x) => x.key !== r.key))
                }}
              />
            ),
          },
        ]),
  ]

  const title = currentId ? `到账 ${receipt?.receipt_no ?? ''}` : '新建到账'

  return (
    <Drawer
      open={open}
      title={title}
      size={1080}
      onClose={close}
      destroyOnHidden
      extra={
        <Space>
          {isAdmin && currentId && (
            <Button danger onClick={remove}>
              删除
            </Button>
          )}
          {!readOnly && (
            <Button type="primary" loading={saving} onClick={save}>
              保存
            </Button>
          )}
        </Space>
      }
    >
      <Spin spinning={loading}>
        {prefill?.line_id && !currentId && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title="这笔是从银行对账单生成的，保存后会自动和那条流水配对。"
          />
        )}
        <Card size="small" title="到账信息" style={{ marginBottom: 12 }}>
          <Form form={form} layout="vertical" disabled={readOnly} onValuesChange={() => setDirty(true)}>
            <Row gutter={12}>
              <Col xs={24} md={10}>
                <Form.Item name="account_id" label="收款账户" rules={[{ required: true, message: '请选收款账户' }]}>
                  <Select
                    showSearch={{ optionFilterProp: 'label' }}
                    options={accountOptions(accounts)}
                    placeholder="搜索账户，如 ECO 8651"
                  />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item name="receipt_date" label="到账日期" rules={[{ required: true, message: '请选日期' }]}>
                  <DatePicker style={{ width: '100%' }} allowClear={false} />
                </Form.Item>
              </Col>
              <Col xs={12} md={8}>
                <Form.Item
                  name="amount_orig"
                  label={`到账金额${currency ? `（${currency}）` : ''}`}
                  rules={[{ required: true, message: '请填金额' }]}
                >
                  <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item
                  name="fx_rate"
                  label="汇率（1 美元 = ? 原币）"
                  rules={[{ required: !isUsd, message: '请填汇率' }]}
                  extra={amount > 0 && rate > 0 ? `折合 ${usd(amount / rate)}` : undefined}
                >
                  <InputNumber
                    min={0.000001}
                    precision={4}
                    style={{ width: '100%' }}
                    disabled={isUsd || readOnly}
                    onChange={() => {
                      rateTouched.current = true
                    }}
                  />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item name="cheque_no" label="支票号">
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="payer_summary" label="付款方 / 银行摘要">
                  <Input placeholder="如 TRF FROM ABC LTD" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="bank_ref" label="银行参考号（有就填）">
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={16}>
                <Form.Item name="note" label="内部备注（不进报款）">
                  <Input />
                </Form.Item>
              </Col>
            </Row>
          </Form>
          <div style={{ marginTop: 4 }}>
            <Typography.Text strong>凭证</Typography.Text>
            <div style={{ marginTop: 6 }}>
              <Vouchers
                value={attachments}
                readOnly={readOnly}
                onChange={(p) => {
                  setAttachments(p)
                  setDirty(true)
                }}
              />
            </div>
          </div>
          {receipt && (
            <div style={{ marginTop: 8 }}>
              <Space wrap>
                <Tag>{receipt.bank_status}</Tag>
                {receipt.import_batch_id && <Tag color="purple">银行导入</Tag>}
              </Space>
            </div>
          )}
        </Card>

        <Card
          size="small"
          title="拆分到车"
          style={{ marginBottom: 12 }}
          extra={
            <span className={remaining < 0 ? 'text-danger' : remaining > 0 ? 'text-warn' : 'text-ok'}>
              已拆 {currency} {money(claimedTotal)} / 到账 {money(amount)}，剩余 {money(remaining)}
            </span>
          }
        >
          <Table
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={claims}
            columns={columns}
            scroll={{ x: 860 }}
            locale={{ emptyText: '还没有拆分。钱还不知道是哪台车的，也可以先只存到账。' }}
          />
          {!readOnly && (
            <Space style={{ marginTop: 8 }} wrap>
              <Button icon={<PlusOutlined />} onClick={addRow}>
                再加一行
              </Button>
              {remaining > 0 && claims.some((c) => c.vehicle_id || c.customer_id) && (
                <Button onClick={refundRemaining}>剩余 {money(remaining)} 退还客户</Button>
              )}
              <span className="hint">一笔钱付多台车时，每台车一行；金额按业务员通知的原币填写。</span>
            </Space>
          )}
        </Card>

        {currentId && receipt && (
          <Card size="small" title="报款文字">
            {dirty && !readOnly ? (
              <Alert type="info" showIcon title="有改动还没保存，保存后这里会更新。" />
            ) : (
              <ReportBox receipt={receipt} text={reportText} readOnly={readOnly} onChanged={() => void load(currentId).then(() => setChanged(true))} />
            )}
          </Card>
        )}
      </Spin>

      <VehicleFormModal
        open={newVehicleFor !== null}
        onClose={async (savedId) => {
          const key = newVehicleFor
          setNewVehicleFor(null)
          if (savedId && key) {
            const { data } = await supabase.from('v_vehicle_ledger').select('*').eq('id', savedId).single()
            if (data) pickVehicle(key, savedId, data)
          }
        }}
      />
    </Drawer>
  )
}
