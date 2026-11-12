import { App, AutoComplete, Col, DatePicker, Form, Input, InputNumber, Modal, Radio, Row, Select, Table } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import type { Json } from '../lib/database.types'
import { CHEQUE_PURPOSES, nextChequeNo, notifyChequesChanged } from '../lib/cheques'
import type { Cheque } from '../lib/cheques'
import { errorText } from '../lib/errors'
import { money } from '../lib/format'
import { useT } from '../lib/i18n'
import { useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import type { Vehicle } from '../lib/supabase'
import CustomerSelect from './CustomerSelect'
import VehicleSelect from './VehicleSelect'

// 录支票：一张，或客户一次给的一叠分期支票（填第一张的号码、张数、第一个到期日，按月生成，再逐张改）；也用来修改一张支票

type Props = {
  open: boolean
  /** 有值 = 修改 */
  cheque?: Cheque | null
  onClose: (changed: boolean) => void
}

type FormValues = {
  customer_id?: number | null
  vehicle_id?: number | null
  salesperson_id?: number | null
  drawer_name?: string
  drawer_bank?: string
  cheque_no?: string
  currency: 'GHS' | 'USD'
  amount?: number | null
  installment_usd?: number | null
  due_date?: dayjs.Dayjs | null
  purpose: string
  count: number
  note?: string
}

type Line = { key: number; cheque_no: string; due_date: dayjs.Dayjs | null; amount: number | null }

/** 加纳常见的开票银行（支票上印的）；也可以自己填 */
const BANKS = ['STANBIC', 'GCB', 'ECO', 'OMNI', 'FIDELITY', 'ARB', 'CBG', 'ZENITH', 'GTB', 'UMB', 'ADB', 'ABSA', 'BOA', 'ACCESS', 'CAL', 'REPUBLIC', 'UBA', 'FBN', 'PBL', 'FIRST ATLANTIC']

export default function ChequeEditor({ open, cheque, onClose }: Props) {
  const t = useT()
  const { message } = App.useApp()
  const { salespersons, customers } = useRefData()
  const [form] = Form.useForm<FormValues>()
  const [saving, setSaving] = useState(false)
  const [known, setKnown] = useState<Vehicle[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const count = Form.useWatch('count', form) ?? 1
  const chequeNo = Form.useWatch('cheque_no', form) ?? ''
  const dueDate = Form.useWatch('due_date', form)
  const amount = Form.useWatch('amount', form)
  const customerId = Form.useWatch('customer_id', form)
  const vehicleId = Form.useWatch('vehicle_id', form)
  const editing = !!cheque
  const locked = cheque?.status === 'cleared'

  useEffect(() => {
    if (!open) return
    form.resetFields()
    setLines([])
    if (cheque) {
      form.setFieldsValue({
        customer_id: cheque.customer_id,
        vehicle_id: cheque.vehicle_id,
        salesperson_id: cheque.salesperson_id,
        drawer_name: cheque.drawer_name ?? '',
        drawer_bank: cheque.drawer_bank ?? '',
        cheque_no: cheque.cheque_no ?? '',
        currency: (cheque.currency ?? 'GHS') as 'GHS' | 'USD',
        amount: cheque.amount != null ? Number(cheque.amount) : null,
        installment_usd: cheque.installment_usd != null ? Number(cheque.installment_usd) : null,
        due_date: cheque.due_date ? dayjs(cheque.due_date) : null,
        purpose: cheque.purpose ?? '分期款',
        count: 1,
        note: cheque.note ?? '',
      })
      if (cheque.vehicle_id) void supabase.from('v_vehicle_ledger').select('*').eq('id', cheque.vehicle_id).then((r) => setKnown(r.data ?? []))
    } else {
      setKnown([])
      form.setFieldsValue({ currency: 'GHS', purpose: '分期款', count: 1 })
    }
  }, [open, cheque, form])

  // 一叠支票：按第一张的号码、到期日、金额生成，改了第一张就重新生成（已经手改过的行保留自己的改动）
  const generated = useMemo<Line[]>(() => {
    const n = Math.min(Math.max(Number(count) || 1, 1), 36)
    if (n <= 1) return []
    const first = dueDate ? dayjs(dueDate) : null
    return Array.from({ length: n }, (_, i) => ({
      key: i,
      cheque_no: chequeNo ? nextChequeNo(chequeNo, i) : '',
      due_date: first ? first.add(i, 'month') : null,
      amount: amount != null && amount !== undefined ? Number(amount) : null,
    }))
  }, [count, chequeNo, dueDate, amount])
  useEffect(() => {
    setLines(generated)
  }, [generated])

  const onVehicle = (id: number | null, v: Vehicle | null) => {
    form.setFieldValue('vehicle_id', id)
    if (v) {
      if (v.id != null) setKnown((k) => (k.some((x) => x.id === v.id) ? k : [...k, v]))
      form.setFieldsValue({ customer_id: v.customer_id ?? undefined, salesperson_id: v.salesperson_id ?? form.getFieldValue('salesperson_id') })
      if (!form.getFieldValue('drawer_name')) form.setFieldValue('drawer_name', v.customer_name ?? '')
    }
  }
  const onCustomer = (id: number | null) => {
    form.setFieldValue('customer_id', id)
    const c = customers.find((x) => x.id === id)
    if (c) {
      if (!form.getFieldValue('salesperson_id') && c.salesperson_id) form.setFieldValue('salesperson_id', c.salesperson_id)
      if (!form.getFieldValue('drawer_name')) form.setFieldValue('drawer_name', c.name)
    }
  }

  const save = async () => {
    let v: FormValues
    try {
      v = await form.validateFields()
    } catch {
      return
    }
    const base = {
      customer_id: v.customer_id ?? null,
      vehicle_id: v.vehicle_id ?? null,
      salesperson_id: v.salesperson_id ?? null,
      drawer_name: v.drawer_name?.trim() || null,
      drawer_bank: v.drawer_bank?.trim() || null,
      currency: v.currency,
      installment_usd: v.installment_usd ?? null,
      purpose: v.purpose,
      note: v.note?.trim() || null,
    }
    const rows: Record<string, Json | undefined>[] =
      !editing && lines.length > 1
        ? lines.map((l) => ({ ...base, cheque_no: l.cheque_no.trim(), due_date: l.due_date ? l.due_date.format('YYYY-MM-DD') : null, amount: l.amount ?? null }))
        : [
            {
              ...base,
              cheque_no: v.cheque_no?.trim() ?? '',
              due_date: v.due_date ? v.due_date.format('YYYY-MM-DD') : null,
              amount: v.amount ?? null,
              ...(cheque ? { id: cheque.id, updated_at: cheque.updated_at } : {}),
            },
          ]
    const bad = rows.findIndex((r) => !r.cheque_no)
    if (bad >= 0) {
      message.error(t('第 {n} 张没有支票号', { n: bad + 1 }))
      return
    }
    setSaving(true)
    const { error } = await supabase.rpc('save_cheques', { p_rows: rows as Json })
    setSaving(false)
    if (error) {
      message.error(errorText(error))
      return
    }
    message.success(editing ? t('已保存') : rows.length > 1 ? t('已录入 {n} 张支票', { n: rows.length }) : t('已录入'))
    notifyChequesChanged()
    onClose(true)
  }

  const spOptions = salespersons.filter((s) => s.active || s.id === form.getFieldValue('salesperson_id')).map((s) => ({ value: s.id, label: s.name }))

  return (
    <Modal
      open={open}
      title={editing ? t('修改支票 {no}', { no: cheque?.cheque_no ?? '' }) : t('录支票')}
      okText={t('保存')}
      cancelText={t('取消')}
      confirmLoading={saving}
      onOk={save}
      onCancel={() => onClose(false)}
      width={720}
      destroyOnHidden
      className="cheque-editor"
    >
      <Form form={form} layout="vertical" size="middle">
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="vehicle_id" label={t('哪台车的（可不选）')}>
              <VehicleSelect value={vehicleId ?? null} known={known} onChange={onVehicle} placeholder={t('搜大架号或客户')} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="customer_id" label={t('客户')} rules={[{ required: true, message: t('请选客户') }]}>
              <CustomerSelect value={customerId ?? null} onChange={onCustomer} allowCreate salespersonId={form.getFieldValue('salesperson_id')} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="drawer_name" label={t('支票名称（支票上的户名）')}>
              <Input maxLength={120} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="drawer_bank" label={t('支票银行')}>
              <AutoComplete options={BANKS.map((b) => ({ value: b }))} filterOption={(q, o) => (o?.value as string).includes(q.toUpperCase())} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="cheque_no" label={lines.length > 1 ? t('第一张支票号') : t('支票号')} rules={[{ required: true, message: t('请填支票号') }]}>
              <Input maxLength={40} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="currency" label={t('币种')}>
              <Radio.Group disabled={locked} options={[{ value: 'GHS', label: 'GHS' }, { value: 'USD', label: 'USD' }]} optionType="button" />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="amount" label={t('支票金额')} tooltip={t('还没写金额的空白支票就空着，存票时再填')}>
              <InputNumber min={0.01} precision={2} style={{ width: '100%' }} disabled={locked} placeholder={t('空白')} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="installment_usd" label={t('分期款/月 USD')}>
              <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="due_date" label={lines.length > 1 ? t('第一张到期日期') : t('到期日期')}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="purpose" label={t('用途')}>
              <Select options={CHEQUE_PURPOSES.map((p) => ({ value: p, label: t(p) }))} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="salesperson_id" label={t('业务员')}>
              <Select allowClear showSearch={{ optionFilterProp: 'label' }} options={spOptions} placeholder={t('按车或客户')} />
            </Form.Item>
          </Col>
          {!editing && (
            <Col xs={12} md={6}>
              <Form.Item name="count" label={t('张数')} tooltip={t('客户一次给一叠分期支票：号码顺着加、到期日按月加，生成后可以逐张改')}>
                <InputNumber min={1} max={36} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          )}
          <Col xs={24} md={editing ? 24 : 18}>
            <Form.Item name="note" label={t('备注')}>
              <Input maxLength={300} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
      {lines.length > 1 && (
        <Table<Line>
          size="small"
          rowKey="key"
          pagination={false}
          dataSource={lines}
          className="cheque-lines"
          columns={[
            { title: '#', width: 44, render: (_, __, i) => i + 1 },
            {
              title: t('支票号'),
              width: 160,
              render: (_, l) => (
                <Input size="small" value={l.cheque_no} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, cheque_no: e.target.value } : x)))} />
              ),
            },
            {
              title: t('到期日期'),
              width: 150,
              render: (_, l) => (
                <DatePicker size="small" value={l.due_date} onChange={(d) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, due_date: d } : x)))} />
              ),
            },
            {
              title: t('支票金额'),
              width: 150,
              render: (_, l) => (
                <InputNumber
                  size="small"
                  min={0.01}
                  precision={2}
                  placeholder={t('空白')}
                  value={l.amount}
                  onChange={(n) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, amount: n ?? null } : x)))}
                />
              ),
            },
            { title: '', render: (_, l) => <span className="hint">{l.amount != null ? money(l.amount) : t('空白支票')}</span> },
          ]}
        />
      )}
    </Modal>
  )
}
