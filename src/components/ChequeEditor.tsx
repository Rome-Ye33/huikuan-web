import { App, Col, DatePicker, Form, Input, InputNumber, Modal, Radio, Row, Select, Table } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import type { Json } from '../lib/database.types'
import { CHEQUE_PURPOSES, CHEQUE_STATUS_LABEL, chequeStatus, nextChequeNo, notifyChequesChanged } from '../lib/cheques'
import type { Cheque } from '../lib/cheques'
import { errorText } from '../lib/errors'
import { money } from '../lib/format'
import { useT } from '../lib/i18n'
import { useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import type { Vehicle } from '../lib/supabase'
import CustomerSelect from './CustomerSelect'
import { VehicleMultiSelect } from './VehicleSelect'

// 录支票：一张，或客户一次给的一叠分期支票（填第一张的号码、张数、第一个到期日，按月生成，再逐张改）；也用来修改一张支票
//
// 老票转到新单（33）：这个客户同一家银行、同一个号码的票已经录过、而且还没进银行时，
// 保存不会新建，而是把那一张改成这次录的（本来就是同一张纸）。保存前先问一句，列出是哪几张。

/** 支票号比对用：只留字母数字、去掉前面的 0（和数据库 private.cheque_key 一样） */
const chequeKey = (s: string | null) => (s ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().replace(/^0+/, '')
/** 银行比对用：大写、中间空白压成一个（和数据库一样） */
const bankKey = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
/** 还没进银行的，才能转到新单 */
const REUSABLE = ['pending', 'confirming', 'cancelled']

type Props = {
  open: boolean
  /** 有值 = 修改 */
  cheque?: Cheque | null
  onClose: (changed: boolean) => void
}

type FormValues = {
  customer_id?: number | null
  /** 这张支票对应的车：一张销售订单可能几台（按选的顺序，第一台决定客户、业务员） */
  vehicle_ids?: number[]
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
  /** 合同序号：Rome 表里的 序号，一个合同一个，分期支票靠它串起来 */
  contract_no?: string
  /** 第几期：一叠批量录入时按 1、2、3…… 自动排，单张可以自己填 */
  installment_no?: number | null
  installment_count?: number | null
  note?: string
}

type Line = { key: number; cheque_no: string; due_date: dayjs.Dayjs | null; amount: number | null }

export default function ChequeEditor({ open, cheque, onClose }: Props) {
  const t = useT()
  const { message, modal } = App.useApp()
  const { salespersons, customers, chequeBanks } = useRefData()
  const [form] = Form.useForm<FormValues>()
  const [saving, setSaving] = useState(false)
  const [known, setKnown] = useState<Vehicle[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const count = Form.useWatch('count', form) ?? 1
  const chequeNo = Form.useWatch('cheque_no', form) ?? ''
  const dueDate = Form.useWatch('due_date', form)
  const amount = Form.useWatch('amount', form)
  const customerId = Form.useWatch('customer_id', form)
  const vehicleIds = Form.useWatch('vehicle_ids', form)
  const editing = !!cheque
  const locked = cheque?.status === 'cleared'

  // 支票银行从基础资料来（只列启用的）；老支票上的银行哪怕后来停用了也照样显示，不会丢
  const bankOptions = useMemo(() => {
    const names = chequeBanks.filter((b) => b.active).map((b) => b.name)
    const cur = cheque?.drawer_bank?.trim()
    if (cur && !names.includes(cur)) names.unshift(cur)
    return names.map((n) => ({ value: n, label: n }))
  }, [chequeBanks, cheque])

  useEffect(() => {
    if (!open) return
    form.resetFields()
    setLines([])
    if (cheque) {
      form.setFieldsValue({
        customer_id: cheque.customer_id,
        vehicle_ids: cheque.vehicle_ids ?? (cheque.vehicle_id ? [cheque.vehicle_id] : []),
        salesperson_id: cheque.salesperson_id,
        drawer_name: cheque.drawer_name ?? '',
        drawer_bank: cheque.drawer_bank ?? '',
        cheque_no: cheque.cheque_no ?? '',
        currency: (cheque.currency ?? 'GHS') as 'GHS' | 'USD',
        amount: cheque.amount != null ? Number(cheque.amount) : null,
        installment_usd: cheque.installment_usd != null ? Number(cheque.installment_usd) : null,
        contract_no: cheque.contract_no ?? undefined,
        installment_no: cheque.installment_no ?? null,
        installment_count: cheque.installment_count ?? null,
        due_date: cheque.due_date ? dayjs(cheque.due_date) : null,
        purpose: cheque.purpose ?? '分期款',
        count: 1,
        note: cheque.note ?? '',
      })
      const ids = cheque.vehicle_ids ?? (cheque.vehicle_id ? [cheque.vehicle_id] : [])
      if (ids.length) void supabase.from('v_vehicle_ledger').select('*').in('id', ids).then((r) => setKnown(r.data ?? []))
      else setKnown([])
    } else {
      setKnown([])
      form.setFieldsValue({ currency: 'GHS', purpose: '分期款', count: 1, vehicle_ids: [] })
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

  // 选了几台车：客户、业务员、支票名称按第一台带出来；几台车必须是同一个客户的（数据库也会拦）
  const onVehicles = (ids: number[], vs: Vehicle[]) => {
    const list = ids.map((id) => vs.find((x) => x.id === id) ?? known.find((x) => x.id === id)).filter((x): x is Vehicle => !!x)
    const first = list[0]
    let keep = ids
    if (first && list.some((x) => x.customer_id !== first.customer_id)) {
      message.error(t('一张支票上的车要是同一个客户的'))
      keep = list.filter((x) => x.customer_id === first.customer_id).map((x) => x.id as number)
    }
    form.setFieldValue('vehicle_ids', keep)
    setKnown((k) => {
      const m = new Map(k.map((x) => [x.id, x]))
      for (const v of list) if (v.id != null) m.set(v.id, v)
      return [...m.values()]
    })
    if (first) {
      form.setFieldsValue({ customer_id: first.customer_id ?? undefined, salesperson_id: first.salesperson_id ?? form.getFieldValue('salesperson_id') })
      if (!form.getFieldValue('drawer_name')) form.setFieldValue('drawer_name', first.customer_name ?? '')
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
      vehicle_ids: v.vehicle_ids ?? [],
      salesperson_id: v.salesperson_id ?? null,
      drawer_name: v.drawer_name?.trim() || null,
      drawer_bank: v.drawer_bank?.trim() || null,
      currency: v.currency,
      installment_usd: v.installment_usd ?? null,
      purpose: v.purpose,
      contract_no: v.contract_no?.trim() || null,
      note: v.note?.trim() || null,
    }
    const rows: Record<string, Json | undefined>[] =
      !editing && lines.length > 1
        ? lines.map((l, i) => ({
            ...base,
            cheque_no: l.cheque_no.trim(),
            due_date: l.due_date ? l.due_date.format('YYYY-MM-DD') : null,
            amount: l.amount ?? null,
            // 一叠分期支票：第几期按顺序排，共几期就是这一叠的张数
            installment_no: (v.installment_no ?? 1) + i,
            installment_count: v.installment_count ?? (v.installment_no ?? 1) + lines.length - 1,
          }))
        : [
            {
              ...base,
              cheque_no: v.cheque_no?.trim() ?? '',
              due_date: v.due_date ? v.due_date.format('YYYY-MM-DD') : null,
              amount: v.amount ?? null,
              installment_no: v.installment_no ?? null,
              installment_count: v.installment_count ?? null,
              ...(cheque ? { id: cheque.id, updated_at: cheque.updated_at } : {}),
            },
          ]
    const bad = rows.findIndex((r) => !r.cheque_no)
    if (bad >= 0) {
      message.error(t('第 {n} 张没有支票号', { n: bad + 1 }))
      return
    }
    // 录新票时：这个客户有没有同号、还没进银行的老票？有就是「老票转到新单」，先问一句
    if (!editing && !(await confirmReuse(rows))) return
    setSaving(true)
    const { data, error } = await supabase.rpc('save_cheques', { p_rows: rows as Json })
    setSaving(false)
    if (error) {
      message.error(errorText(error))
      return
    }
    const reused = (data as { reused?: string[] } | null)?.reused ?? []
    const fresh = rows.length - reused.length
    message.success(
      editing
        ? t('已保存')
        : reused.length === 0
          ? rows.length > 1
            ? t('已录入 {n} 张支票', { n: rows.length })
            : t('已录入')
          : fresh > 0
            ? t('新录 {n} 张，另外 {m} 张老票改成了这一单的', { n: fresh, m: reused.length })
            : t('{m} 张老票改成了这一单的', { m: reused.length }),
    )
    notifyChequesChanged()
    onClose(true)
  }

  /** 要改的老票：同客户、同银行、同号码，而且还没进银行。有就弹一句问清楚 */
  const confirmReuse = async (rows: Record<string, Json | undefined>[]) => {
    const customerId = rows[0]?.customer_id
    if (!customerId) return true
    const { data } = await supabase.from('v_cheques').select('cheque_no, drawer_bank, status').eq('customer_id', customerId as number)
    const bank = bankKey(rows[0]?.drawer_bank as string | null)
    const keys = new Set(rows.map((r) => chequeKey(String(r.cheque_no ?? ''))))
    const hits = (data ?? []).filter(
      (c) => keys.has(chequeKey(c.cheque_no)) && bankKey(c.drawer_bank) === bank && REUSABLE.includes(c.status ?? ''),
    )
    if (hits.length === 0) return true
    const list = hits.map((c) => `${c.cheque_no}（${t(CHEQUE_STATUS_LABEL[chequeStatus(c.status)])}）`).join('、')
    return await new Promise<boolean>((resolve) => {
      modal.confirm({
        title: t('{list} 这个客户已经录过了', { list }),
        content: t(
          '这几张还没进银行，保存后不会新建，而是把它们改成这次录的：车、金额、到期日、序号、备注都按这次的，状态回到待存，原来的取消原因和计划存票日期清掉。',
        ),
        okText: t('改成这一单的'),
        cancelText: t('返回'),
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      })
    })
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
            <Form.Item name="vehicle_ids" label={t('哪几台车的（可不选）')} tooltip={t('一张销售订单几台车、支票是整张订单的，就把这几台都选上；客户、业务员按第一台')}>
              <VehicleMultiSelect value={vehicleIds ?? []} known={known} onChange={onVehicles} placeholder={t('搜大架号或客户')} style={{ width: '100%' }} />
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
            <Form.Item name="drawer_bank" label={t('支票银行')} tooltip={t('支票上印的开票银行；这个列表在「基础资料 → 支票银行」里维护')}>
              <Select
                showSearch
                allowClear
                options={bankOptions}
                optionFilterProp="value"
                filterOption={(q, o) => (o?.value as string).includes(q.toUpperCase())}
                placeholder={t('选银行')}
              />
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
          <Col xs={12} md={6}>
            <Form.Item name="contract_no" label={t('合同序号')} tooltip={t('一个销售合同一个序号（和表里的 序号 一样），同一个合同的分期支票填一样的，台账上能按它搜')}>
              <Input maxLength={30} allowClear placeholder={t('可不填')} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item
              name="installment_no"
              label={lines.length > 1 ? t('第一张是第几期') : t('第几期')}
              tooltip={lines.length > 1 ? t('这一叠按它往后排：填 1 就是第 1、2、3……期') : undefined}
            >
              <InputNumber min={1} max={120} precision={0} style={{ width: '100%' }} placeholder={t('可不填')} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="installment_count" label={t('共几期')} tooltip={lines.length > 1 ? t('空着就按这一叠的张数算') : undefined}>
              <InputNumber min={1} max={120} precision={0} style={{ width: '100%' }} placeholder={lines.length > 1 ? t('按张数') : t('可不填')} />
            </Form.Item>
          </Col>
          <Col xs={24} md={24}>
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
