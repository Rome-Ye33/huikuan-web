import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, App, AutoComplete, Button, Card, Checkbox, Col, DatePicker, Drawer, Form, Input, InputNumber, Row, Select, Space, Spin, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/errors'
import { dateTime, money, num, round2, todayAccra, usd } from '../lib/format'
import { useT } from '../lib/i18n'
import { defaultNature, receiptNatures } from '../lib/natures'
import { accountOptions, lookupRate, useRefData } from '../lib/refdata'
import { notifySubmissionsChanged, parseClaims, STATUS_COLOR, STATUS_LABEL } from '../lib/submissions'
import type { Submission, SubmissionClaim, SubmissionStatus } from '../lib/submissions'
import { supabase } from '../lib/supabase'
import type { Vehicle } from '../lib/supabase'
import type { Json } from '../lib/database.types'
import VehicleSelect from './VehicleSelect'
import Vouchers from './Vouchers'
import ApprovalTrail from './ApprovalTrail'

// 业务员提交到账（手机上也能用）；财务、管理员打开时只读，审核在“到账录入”的待审核里做

type Props = {
  open: boolean
  /** 空 = 新提交 */
  submission: Submission | null
  onClose: (changed: boolean) => void
}

type LineDraft = {
  key: string
  /** 系统里没有这台车，或者还不知道是哪台：手填客户、车型、大架号 */
  manual: boolean
  vehicle_id: number | null
  customer_id: number | null
  customer_name: string
  model: string
  vin: string
  nature?: string
  amount_orig: number | null
}

type FormValues = {
  receipt_date?: dayjs.Dayjs
  account_id?: number
  amount_orig?: number | null
  fx_rate?: number | null
  payer_summary?: string
  cheque_no?: string
  note?: string
}

let keySeq = 0
const newKey = () => `l${++keySeq}`
const emptyLine = (): LineDraft => ({ key: newKey(), manual: false, vehicle_id: null, customer_id: null, customer_name: '', model: '', vin: '', amount_orig: null })

export default function SubmissionForm({ open, submission, onClose }: Props) {
  const t = useT()
  const { profile, session, isStaff } = useAuth()
  const { accounts, accountById, natures, customers, salespersons } = useRefData()
  const { message, modal } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [lines, setLines] = useState<LineDraft[]>([])
  const [attachments, setAttachments] = useState<string[]>([])
  const [vehicles, setVehicles] = useState<Map<number, Vehicle>>(new Map())
  const [receiptNo, setReceiptNo] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dirty, setDirty] = useState(false)
  const rateTouched = useRef(false)

  const status = (submission?.status ?? null) as SubmissionStatus | null
  const editable = !isStaff && (!submission || status === 'pending' || status === 'rejected')
  const uid = session?.user.id

  const accountId = Form.useWatch('account_id', form)
  const receiptDate = Form.useWatch('receipt_date', form)
  const amount = num(Form.useWatch('amount_orig', form))
  const rate = num(Form.useWatch('fx_rate', form))
  const account = accountId ? accountById.get(accountId) : undefined
  const currency = account?.currency ?? ''
  const isUsd = currency === 'USD'

  const remember = useCallback((list: (Vehicle | null | undefined)[]) => {
    setVehicles((m) => {
      const next = new Map(m)
      for (const v of list) if (v?.id != null) next.set(v.id, v)
      return next
    })
  }, [])

  // 打开：填好表单；业务员先把自己还没结清的车拉出来，下拉直接能选
  useEffect(() => {
    if (!open) return
    setDirty(false)
    setReceiptNo(null)
    form.resetFields()
    if (submission) {
      rateTouched.current = submission.fx_rate != null
      form.setFieldsValue({
        receipt_date: dayjs(submission.receipt_date),
        account_id: submission.account_id,
        amount_orig: num(submission.amount_orig),
        fx_rate: submission.fx_rate != null ? num(submission.fx_rate) : null,
        payer_summary: submission.payer_summary ?? '',
        cheque_no: submission.cheque_no ?? '',
        note: submission.note ?? '',
      })
      setAttachments(submission.attachments ?? [])
      const rows = parseClaims(submission.claims).map<LineDraft>((c) => ({
        key: newKey(),
        manual: !c.vehicle_id,
        vehicle_id: c.vehicle_id ?? null,
        customer_id: c.customer_id ?? null,
        customer_name: c.customer_name ?? '',
        model: c.model ?? '',
        vin: c.vin ?? '',
        nature: c.nature ?? undefined,
        amount_orig: c.amount_orig ?? null,
      }))
      setLines(rows.length ? rows : [emptyLine()])
    } else {
      rateTouched.current = false
      form.setFieldsValue({ receipt_date: dayjs(todayAccra()) })
      setAttachments([])
      setLines([emptyLine()])
    }

    let alive = true
    void (async () => {
      setLoading(true)
      const ids = submission ? parseClaims(submission.claims).map((c) => c.vehicle_id).filter((x): x is number => !!x) : []
      const [mine, used, rec] = await Promise.all([
        !isStaff
          ? supabase.from('v_vehicle_ledger').select('*').neq('pay_status', '已结清').order('customer_name').limit(300)
          : Promise.resolve({ data: [] as Vehicle[] }),
        ids.length ? supabase.from('v_vehicle_ledger').select('*').in('id', ids) : Promise.resolve({ data: [] as Vehicle[] }),
        submission?.receipt_id
          ? supabase.from('bank_receipts').select('receipt_no').eq('id', submission.receipt_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (!alive) return
      remember([...(mine.data ?? []), ...(used.data ?? [])])
      setReceiptNo(rec.data?.receipt_no ?? null)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [open, submission, form, isStaff, remember])

  // 换账户或日期：自动带当天汇率（手工改过就不再覆盖）
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

  const allocated = useMemo(() => round2(lines.reduce((s, l) => s + num(l.amount_orig), 0)), [lines])
  const remaining = round2(amount - allocated)

  const setLine = (key: string, patch: Partial<LineDraft>) => {
    setDirty(true)
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const pickVehicle = (key: string, id: number | null, v: Vehicle | null) => {
    if (v) remember([v])
    setDirty(true)
    setLines((rows) => {
      const others = round2(rows.filter((r) => r.key !== key).reduce((s, r) => s + num(r.amount_orig), 0))
      return rows.map((r) => {
        if (r.key !== key) return r
        const next: LineDraft = { ...r, vehicle_id: id, customer_id: v?.customer_id ?? null }
        if (v && !r.nature) next.nature = defaultNature(v)
        if (v && !r.amount_orig && amount > others) next.amount_orig = round2(amount - others)
        return next
      })
    })
  }

  const natureOptions = receiptNatures(natures).map((n) => ({ value: n.name, label: t(n.name) }))
  const customerOptions = useMemo(() => customers.map((c) => ({ value: c.name })), [customers])

  const validate = (v: FormValues): string | null => {
    if (!isUsd && !(num(v.fx_rate) > 0)) return t('请填汇率')
    if (account?.kind !== 'cash' && attachments.length === 0) return t('请上传凭证（转账截图、水单或 Credit Alert）')
    const used = lines.filter((l) => l.vehicle_id || l.customer_name.trim() || l.model.trim() || l.vin.trim() || l.nature || num(l.amount_orig) > 0)
    if (used.length === 0) return t('至少填一笔：这笔钱是哪台车或哪个客户的')
    for (const [i, l] of used.entries()) {
      const n = i + 1
      if (!l.manual && !l.vehicle_id) return t('第 {n} 笔：请选车；系统里没有这台车就勾“系统里没有这台车”，再填客户', { n })
      if (l.manual && !l.customer_name.trim()) return t('第 {n} 笔：请填客户名称', { n })
      if (!l.nature) return t('第 {n} 笔：请选款项类型', { n })
      if (!(num(l.amount_orig) > 0)) return t('第 {n} 笔：请填金额', { n })
    }
    const total = round2(used.reduce((s, l) => s + num(l.amount_orig), 0))
    if (total > num(v.amount_orig) + 0.001) return t('分开的金额合计 {a} 超过到账金额 {b}', { a: money(total), b: money(v.amount_orig) })
    return null
  }

  const buildClaims = (): SubmissionClaim[] =>
    lines
      .filter((l) => l.vehicle_id || l.customer_name.trim() || l.nature || num(l.amount_orig) > 0)
      .map((l) => {
        const v = l.vehicle_id ? vehicles.get(l.vehicle_id) : undefined
        if (!l.manual && v) {
          return {
            vehicle_id: v.id,
            customer_id: v.customer_id,
            customer_name: v.customer_name,
            vin: v.vin,
            model: v.model,
            nature: l.nature ?? null,
            amount_orig: round2(num(l.amount_orig)),
          }
        }
        const name = l.customer_name.trim()
        const known = customers.find((c) => c.name.trim().toLowerCase() === name.toLowerCase())
        return {
          vehicle_id: null,
          customer_id: known?.id ?? null,
          customer_name: known?.name ?? name,
          vin: l.vin.trim().toUpperCase().replace(/\s+/g, '') || null,
          model: l.model.trim() || null,
          nature: l.nature ?? null,
          amount_orig: round2(num(l.amount_orig)),
        }
      })

  const submit = async () => {
    let v: FormValues
    try {
      v = await form.validateFields()
    } catch {
      return
    }
    const err = validate(v)
    if (err) {
      message.error(err)
      return
    }
    const doSave = async () => {
      if (!profile?.salesperson_id || !account) return
      const payload = {
        receipt_date: v.receipt_date!.format('YYYY-MM-DD'),
        account_id: account.id,
        currency: account.currency,
        salesperson_id: profile.salesperson_id,
        amount_orig: round2(num(v.amount_orig)),
        fx_rate: isUsd ? 1 : num(v.fx_rate) || null,
        payer_summary: v.payer_summary?.trim() || null,
        cheque_no: v.cheque_no?.trim() || null,
        note: v.note?.trim() || null,
        attachments,
        claims: buildClaims() as unknown as Json,
      }
      setSaving(true)
      const res = submission
        ? await supabase
            .from('receipt_submissions')
            .update({ ...payload, ...(status === 'rejected' ? { status: 'pending' } : {}) })
            .eq('id', submission.id)
            .select('id')
        : await supabase.from('receipt_submissions').insert(payload).select('id')
      setSaving(false)
      if (res.error) {
        message.error(t('提交失败：') + errorText(res.error))
        return
      }
      if (!res.data?.length) {
        message.error(t('这条已经被财务处理了，不能再改，请刷新'))
        return
      }
      message.success(submission && status === 'pending' ? t('已保存修改') : t('已提交，等财务审核'))
      notifySubmissionsChanged()
      onClose(true)
    }
    if (remaining > 0.001) {
      modal.confirm({
        title: t('还有 {cur} {amt} 没说是哪台车的', { cur: currency, amt: money(remaining) }),
        content: t('财务审核时会问你。确定先这样提交吗？'),
        okText: t('确定提交'),
        cancelText: t('回去补上'),
        onOk: doSave,
      })
    } else await doSave()
  }

  const withdraw = () => {
    if (!submission) return
    modal.confirm({
      title: t('撤回这条提交？'),
      content: t('撤回后财务就看不到了，也不能再改。'),
      okText: t('撤回'),
      okButtonProps: { danger: true },
      cancelText: t('取消'),
      onOk: async () => {
        const { data, error } = await supabase.from('receipt_submissions').update({ status: 'withdrawn' }).eq('id', submission.id).select('id')
        if (error || !data?.length) {
          message.error(error ? errorText(error) : t('这条已经被财务处理了，不能撤回，请刷新'))
          return
        }
        message.success(t('已撤回'))
        notifySubmissionsChanged()
        onClose(true)
      },
    })
  }

  const close = () => {
    if (dirty && editable) {
      modal.confirm({
        title: t('有改动还没提交，确定关闭？'),
        okText: t('不保存，关闭'),
        cancelText: t('取消'),
        onOk: () => onClose(false),
      })
    } else onClose(false)
  }

  const spName = submission ? salespersons.find((s) => s.id === submission.salesperson_id)?.name : undefined
  const title = submission ? t('到账提交 #{id}', { id: submission.id }) : t('提交到账')
  const width = Math.min(760, typeof window !== 'undefined' ? window.innerWidth : 760)

  const banner = (() => {
    if (!submission || !status) return null
    if (status === 'pending')
      return (
        <Alert
          type="info"
          showIcon
          title={t('{when} 已提交，等财务审核。审核前可以修改或撤回。', { when: dateTime(submission.submitted_at) })}
          description={submission.review_note ? t('上次退回原因：{reason}', { reason: submission.review_note }) : undefined}
        />
      )
    if (status === 'rejected')
      return (
        <Alert
          type="error"
          showIcon
          title={t('财务退回：{reason}', { reason: submission.review_note ?? '' })}
          description={editable ? t('按上面说的改好，再点“重新提交”。') : undefined}
        />
      )
    if (status === 'approved')
      return (
        <Alert
          type="success"
          showIcon
          title={receiptNo ? t('财务已审核通过，到账编号 {no}', { no: receiptNo }) : t('财务已审核通过')}
          description={submission.reviewed_at ? dateTime(submission.reviewed_at) : undefined}
        />
      )
    return <Alert type="warning" showIcon title={t('已撤回')} />
  })()

  return (
    <Drawer
      open={open}
      title={
        <Space wrap>
          <span>{title}</span>
          {status && <Tag color={STATUS_COLOR[status]}>{t(STATUS_LABEL[status])}</Tag>}
        </Space>
      }
      size={width}
      onClose={close}
      destroyOnHidden
      extra={
        editable && (
          <Space>
            {submission && (
              <Button danger onClick={withdraw}>
                {t('撤回')}
              </Button>
            )}
            <Button type="primary" loading={saving} onClick={submit}>
              {!submission ? t('提交') : status === 'rejected' ? t('重新提交') : t('保存修改')}
            </Button>
          </Space>
        )
      }
    >
      <Spin spinning={loading}>
        {banner && <div style={{ marginBottom: 12 }}>{banner}</div>}
        {isStaff && submission && (
          <Typography.Paragraph type="secondary">
            {t('业务员：{name}，提交于 {when}', { name: spName ?? '', when: dateTime(submission.submitted_at) })}
          </Typography.Paragraph>
        )}
        <Form form={form} layout="vertical" disabled={!editable} onValuesChange={() => setDirty(true)}>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="account_id" label={t('客户付到哪个账户')} rules={[{ required: true, message: t('请选收款账户') }]}>
                <Select showSearch={{ optionFilterProp: 'label' }} options={accountOptions(accounts)} placeholder={t('搜索账户，如 ECO 8651')} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="receipt_date" label={t('到账日期')} rules={[{ required: true, message: t('请选日期') }]}>
                <DatePicker style={{ width: '100%' }} allowClear={false} inputReadOnly />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item
                name="amount_orig"
                label={currency ? t('金额（{cur}）', { cur: currency }) : t('金额')}
                rules={[{ required: true, message: t('请填金额') }]}
              >
                <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            {!isUsd && (
              <Col xs={12} md={6}>
                <Form.Item
                  name="fx_rate"
                  label={t('汇率（1 美元 = ? {cur}）', { cur: currency || t('原币') })}
                  extra={amount > 0 && rate > 0 ? t('折合 {usd}', { usd: usd(amount / rate) }) : t('默认当天汇率，客户约定了别的就改')}
                >
                  <InputNumber
                    min={0.000001}
                    precision={4}
                    style={{ width: '100%' }}
                    onChange={() => {
                      rateTouched.current = true
                    }}
                  />
                </Form.Item>
              </Col>
            )}
            <Col xs={24} md={isUsd ? 12 : 10}>
              <Form.Item name="payer_summary" label={t('付款人（转账用的名字 / 公司）')}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={12} md={isUsd ? 12 : 8}>
              <Form.Item name="cheque_no" label={t('支票号（支票才填）')}>
                <Input />
              </Form.Item>
            </Col>
          </Row>

        <div style={{ marginBottom: 16 }}>
          <Typography.Text strong>{t('凭证')}</Typography.Text>
          <span className="hint">
            {' '}
            {account?.kind === 'cash' ? t('（现金可以不传）') : t('（转账截图、水单或 Credit Alert，必传）')}
          </span>
          <div style={{ marginTop: 6 }}>
            <Vouchers
              value={attachments}
              readOnly={!editable}
              prefix={uid ? `sub/${uid}` : undefined}
              onChange={(p) => {
                setAttachments(p)
                setDirty(true)
              }}
            />
          </div>
        </div>

        <Typography.Text strong>{t('这笔钱是哪台车的')}</Typography.Text>
        <div className="hint" style={{ marginBottom: 8 }}>
          {t('一笔钱付了几台车就分几笔填。车还没进系统、或者客户还没定是哪台车，勾“系统里没有这台车”再填客户。')}
        </div>
        {lines.map((l, i) => {
          const v = l.vehicle_id ? vehicles.get(l.vehicle_id) : undefined
          return (
            <Card
              key={l.key}
              size="small"
              style={{ marginBottom: 8 }}
              title={t('第 {n} 笔', { n: i + 1 })}
              extra={
                editable &&
                lines.length > 1 && (
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => {
                      setDirty(true)
                      setLines((rows) => rows.filter((x) => x.key !== l.key))
                    }}
                  />
                )
              }
            >
              {!l.manual && (
                <div style={{ marginBottom: 8 }}>
                  <VehicleSelect
                    value={l.vehicle_id}
                    known={[...vehicles.values()]}
                    style={{ width: '100%' }}
                    disabled={!editable}
                    placeholder={t('选车，或输入大架号、客户名搜索')}
                    onChange={(id, veh) => pickVehicle(l.key, id, veh)}
                  />
                  {v && (
                    <div className="hint">
                      {t('{customer} · {method} · 合同 {contract} · 已到 {received} · 余额 {balance}', {
                        customer: v.customer_name,
                        method: t(v.payment_method ?? ''),
                        contract: usd(v.contract_usd),
                        received: usd(v.received_usd),
                        balance: usd(v.balance_usd),
                      })}
                    </div>
                  )}
                </div>
              )}
              <Checkbox
                checked={l.manual}
                disabled={!editable}
                style={{ marginBottom: 8 }}
                onChange={(e) => setLine(l.key, { manual: e.target.checked, vehicle_id: e.target.checked ? null : l.vehicle_id })}
              >
                {t('系统里没有这台车 / 客户还没定是哪台')}
              </Checkbox>
              {l.manual && (
                <Row gutter={8}>
                  <Col xs={24} md={12}>
                    <div className="field-label">{t('客户名称')}</div>
                    <AutoComplete
                      value={l.customer_name}
                      options={customerOptions}
                      disabled={!editable}
                      style={{ width: '100%', marginBottom: 8 }}
                      placeholder={t('客户名称')}
                      showSearch={{
                        filterOption: (input, o) => String(o?.value ?? '').toLowerCase().includes(input.toLowerCase()),
                      }}
                      onChange={(x: string) => setLine(l.key, { customer_name: x })}
                    />
                  </Col>
                  <Col xs={12} md={6}>
                    <div className="field-label">{t('车型 / 设备')}</div>
                    <Input
                      value={l.model}
                      disabled={!editable}
                      style={{ marginBottom: 8 }}
                      placeholder={t('如 6x4 自卸车')}
                      onChange={(e) => setLine(l.key, { model: e.target.value })}
                    />
                  </Col>
                  <Col xs={12} md={6}>
                    <div className="field-label">{t('大架号（知道就填）')}</div>
                    <Input value={l.vin} disabled={!editable} style={{ marginBottom: 8 }} onChange={(e) => setLine(l.key, { vin: e.target.value })} />
                  </Col>
                </Row>
              )}
              <Row gutter={8}>
                <Col xs={12}>
                  <div className="field-label">{t('款项类型')}</div>
                  <Select
                    value={l.nature}
                    options={natureOptions}
                    disabled={!editable}
                    style={{ width: '100%' }}
                    placeholder={t('选择')}
                    onChange={(x: string) => setLine(l.key, { nature: x })}
                  />
                </Col>
                <Col xs={12}>
                  <div className="field-label">{t('金额 {cur}', { cur: currency })}</div>
                  <InputNumber
                    value={l.amount_orig ?? undefined}
                    min={0}
                    precision={2}
                    disabled={!editable}
                    style={{ width: '100%' }}
                    onChange={(x) => setLine(l.key, { amount_orig: x == null ? null : Number(x) })}
                  />
                  {!isUsd && rate > 0 && num(l.amount_orig) > 0 && <div className="hint">{usd(num(l.amount_orig) / rate)}</div>}
                </Col>
              </Row>
            </Card>
          )
        })}
        <Space wrap style={{ marginBottom: 16 }}>
          {editable && (
            <Button
              icon={<PlusOutlined />}
              onClick={() => {
                setDirty(true)
                setLines((rows) => [...rows, { ...emptyLine(), amount_orig: remaining > 0 ? remaining : null }])
              }}
            >
              {t('再加一笔')}
            </Button>
          )}
          {amount > 0 && (
            <span className={remaining < 0 ? 'text-danger' : remaining > 0 ? 'text-warn' : 'text-ok'}>
              {t('已分 {cur} {a} / 到账 {b}，剩 {c}', { cur: currency, a: money(allocated), b: money(amount), c: money(remaining) })}
            </span>
          )}
        </Space>

          <Form.Item name="note" label={t('给财务的说明（可空）')}>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder={t('如：客户说剩下的下周付')} />
          </Form.Item>
        </Form>
        {submission && <ApprovalTrail docType="submission" docId={submission.id} version={submission.updated_at} />}
      </Spin>
    </Drawer>
  )
}
