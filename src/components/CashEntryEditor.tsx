import { DeleteOutlined, SwapRightOutlined } from '@ant-design/icons'
import { Alert, App, AutoComplete, Button, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Segmented, Select, Space, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/errors'
import { money, round2, todayAccra, usd } from '../lib/format'
import { useT } from '../lib/i18n'
import { isCashLike, moduleColor, moduleOptions, notifyJournalChanged, transferModule, transferSummary } from '../lib/journal'
import type { CashEntry, EntryKind } from '../lib/journal'
import { accountOptions, lookupRate, useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import type { Json } from '../lib/database.types'
import Vouchers from './Vouchers'

// 收支录入：支出、其他收入、账户互转。一笔一行，存进 cash_entries（数据库 36 的 save_cash_entry）。
// 两种用法：
// 1. 填银行流水（prefill 带 line_id）：银行账户先导流水再填，日期、账户、金额照银行的，不能改；保存后这条流水就“已填”。
// 2. 记现金（没有 line_id）：只能选现金账户；银行账户的收付都从流水填，不在这里手工记，免得和流水重复。
// 客户的车款不在这里录：走到账录入，审批通过后自动出现在日记账里。
// 账户互转录一次，两个账户各记一笔（转出账户记支出、转入账户记收入），两笔互相指着对方（peer_id）；币种不同就是货币兑换。
// 互转里银行那一边：从流水填的就是那条流水；从现金这边先记的，银行那边“等流水”，流水导进来按同账户、同金额、3 天内自动对上。
// “保存并记下一笔”：日期、账户、业务模块留着，金额、摘要清空，出纳一天记几十笔现金不用每次重选。

/** 从银行流水填的时候带过来的内容 */
export type CashEntryPrefill = {
  kind?: EntryKind
  account_id?: number
  entry_date?: string
  amount?: number
  /** 收进来的流水填成互转：这条流水是转入那一边 */
  to_account_id?: number
  to_amount?: number
  summary?: string | null
  bank_ref?: string | null
  /** 银行摘要，显示在上面让人照着填 */
  bank_summary?: string | null
  /** 填的是哪条银行流水：保存后这条流水就填好了 */
  line_id?: number
}

type FormValues = {
  entry_date: dayjs.Dayjs
  account_id?: number
  amount?: number
  module?: string
  counterparty?: string
  summary?: string
  fx_rate?: number | null
  bank_ref?: string
  cheque_no?: string
  note?: string
  to_account_id?: number
  to_amount?: number
  fee?: number | null
}

const KIND_LABEL: Record<EntryKind, string> = { out: '支出', in: '其他收入', transfer: '账户互转' }

export default function CashEntryEditor({
  open,
  entryId,
  prefill,
  defaultAccountId,
  onClose,
}: {
  open: boolean
  entryId: number | null
  prefill?: CashEntryPrefill | null
  /** 明细页上选着的账户：新记一笔时默认用它 */
  defaultAccountId?: number
  onClose: (changed: boolean) => void
}) {
  const t = useT()
  const { message } = App.useApp()
  const canEdit = useAuth().canEdit('journal')
  const { accounts, accountById, customers } = useRefData()
  const [form] = Form.useForm<FormValues>()
  const [kind, setKind] = useState<EntryKind>('out')
  const [entry, setEntry] = useState<CashEntry | null>(null)
  const [peer, setPeer] = useState<CashEntry | null>(null)
  const [attachments, setAttachments] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [changed, setChanged] = useState(false)
  const [count, setCount] = useState(0)
  const editing = entryId !== null
  const readOnly = !canEdit
  // 从银行流水填：流水那一边的日期、账户、金额照银行的，不能改
  const fromLine = !editing && !!prefill?.line_id
  // 收进来的流水（填成其他收入，或者互转的转入那一边）
  const lineCredit = fromLine && (!!prefill?.to_account_id || prefill?.kind === 'in')
  const lockFrom = fromLine && !lineCredit
  const lockTo = fromLine && lineCredit

  // 打开时：新记一笔按带过来的内容填；改一笔先读回来（互转的把另一边也读回来）
  useEffect(() => {
    if (!open) return
    setChanged(false)
    setCount(0)
    setEntry(null)
    setPeer(null)
    form.resetFields()
    if (entryId === null) {
      const k = prefill?.kind ?? 'out'
      setKind(k)
      setAttachments([])
      // 记现金时，明细页上选着的是银行账户就不带过来（银行账户从流水填）
      const def = defaultAccountId && isCashLike(accountById.get(defaultAccountId)) ? defaultAccountId : undefined
      form.setFieldsValue({
        entry_date: dayjs(prefill?.entry_date ?? todayAccra()),
        account_id: prefill?.line_id ? prefill.account_id : (prefill?.account_id ?? def),
        amount: prefill?.amount,
        to_account_id: prefill?.to_account_id,
        to_amount: prefill?.to_amount,
        summary: prefill?.summary ?? undefined,
        bank_ref: prefill?.bank_ref ?? undefined,
      })
      return
    }
    let alive = true
    void (async () => {
      const { data } = await supabase.from('cash_entries').select('*').eq('id', entryId).maybeSingle()
      if (!alive || !data) return
      let out = data
      let other: CashEntry | null = null
      if (data.peer_id) {
        const { data: p } = await supabase.from('cash_entries').select('*').eq('id', data.peer_id).maybeSingle()
        other = p ?? null
        // 互转统一按“转出 → 转入”显示
        if (other && data.direction === 'in') [out, other] = [other, data]
      }
      if (!alive) return
      setEntry(out)
      setPeer(other)
      setKind(other ? 'transfer' : (out.direction as EntryKind))
      setAttachments(out.attachments ?? [])
      form.setFieldsValue({
        entry_date: dayjs(out.entry_date),
        account_id: out.account_id,
        amount: Number(out.amount),
        module: out.module ?? undefined,
        counterparty: out.counterparty ?? undefined,
        summary: out.summary ?? undefined,
        fx_rate: out.fx_rate == null ? null : Number(out.fx_rate),
        bank_ref: out.bank_ref ?? undefined,
        cheque_no: out.cheque_no ?? undefined,
        note: out.note ?? undefined,
        to_account_id: other?.account_id,
        to_amount: other ? Number(other.amount) : undefined,
      })
    })()
    return () => {
      alive = false
    }
  }, [open, entryId, prefill, defaultAccountId, accountById, form])

  const accountId = Form.useWatch('account_id', form)
  const toAccountId = Form.useWatch('to_account_id', form)
  const amount = Form.useWatch('amount', form)
  const toAmount = Form.useWatch('to_amount', form)
  const fee = Form.useWatch('fee', form)
  const fxRate = Form.useWatch('fx_rate', form)
  const entryDate = Form.useWatch('entry_date', form)
  const module = Form.useWatch('module', form)
  const acct = accountId ? accountById.get(accountId) : undefined
  const toAcct = toAccountId ? accountById.get(toAccountId) : undefined
  const sameCurrency = !acct || !toAcct || acct.currency === toAcct.currency

  // 汇率：按日期带出基础资料里的汇率（美元账户就是 1），可以改
  useEffect(() => {
    if (!open || kind === 'transfer' || !acct || !entryDate || readOnly) return
    if (editing && entry && entry.account_id === acct.id && entry.entry_date === entryDate.format('YYYY-MM-DD')) return
    let alive = true
    void lookupRate(acct.currency, entryDate.format('YYYY-MM-DD')).then((r) => {
      if (alive) form.setFieldValue('fx_rate', r)
    })
    return () => {
      alive = false
    }
  }, [open, kind, acct, entryDate, editing, entry, readOnly, form])

  // 互转：业务模块按两边的账户自动定；币种一样时转入金额跟着转出金额走；摘要照解款表的写法先填好
  const autoModule = transferModule(acct, toAcct)
  useEffect(() => {
    if (kind !== 'transfer' || readOnly) return
    form.setFieldValue('module', autoModule)
  }, [kind, autoModule, readOnly, form])
  useEffect(() => {
    if (kind !== 'transfer' || readOnly || !sameCurrency || lockTo) return
    form.setFieldValue('to_amount', amount)
  }, [kind, amount, sameCurrency, readOnly, lockTo, form])
  useEffect(() => {
    if (kind !== 'transfer' || readOnly || !sameCurrency || !lockTo) return
    form.setFieldValue('amount', toAmount)
  }, [kind, toAmount, sameCurrency, readOnly, lockTo, form])
  const [summaryTouched, setSummaryTouched] = useState(false)
  useEffect(() => {
    if (kind !== 'transfer' || readOnly || summaryTouched || editing) return
    form.setFieldValue('summary', transferSummary(autoModule, acct, toAcct))
  }, [kind, autoModule, acct, toAcct, summaryTouched, editing, readOnly, form])

  const counterpartyOptions = useMemo(() => {
    const q = String(form.getFieldValue('counterparty') ?? '').toLowerCase()
    return customers
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 30)
      .map((c) => ({ value: c.name }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, open, count])

  const save = async (next: boolean) => {
    let v: FormValues
    try {
      v = await form.validateFields()
    } catch {
      return
    }
    const p: Record<string, Json | undefined> = {
      id: entry?.id,
      kind,
      entry_date: v.entry_date.format('YYYY-MM-DD'),
      account_id: v.account_id,
      amount: v.amount,
      module: kind === 'transfer' ? autoModule : v.module,
      counterparty: v.counterparty?.trim() || null,
      summary: v.summary?.trim() || null,
      fx_rate: kind === 'transfer' ? null : (v.fx_rate ?? null),
      bank_ref: v.bank_ref?.trim() || null,
      cheque_no: v.cheque_no?.trim() || null,
      note: v.note?.trim() || null,
      attachments,
      line_id: prefill?.line_id,
    }
    if (kind === 'transfer') {
      p.to_account_id = v.to_account_id
      p.to_amount = v.to_amount
      p.fee = v.fee || null
    }
    setSaving(true)
    const { error } = await supabase.rpc('save_cash_entry', { p })
    setSaving(false)
    if (error) {
      message.error(errorText(error))
      return
    }
    notifyJournalChanged()
    setChanged(true)
    message.success(kind === 'transfer' ? t('已保存，两个账户各记了一笔') : t('已保存'))
    if (!next) {
      onClose(true)
      return
    }
    // 记下一笔：日期、账户、业务模块留着，其余清空
    setCount((n) => n + 1)
    setAttachments([])
    setSummaryTouched(false)
    form.setFieldsValue({ amount: undefined, counterparty: undefined, summary: undefined, bank_ref: undefined, cheque_no: undefined, note: undefined, to_amount: undefined, fee: undefined })
  }

  const remove = async () => {
    if (!entry) return
    setSaving(true)
    const { error } = await supabase.rpc('delete_cash_entry', { p_id: entry.id })
    setSaving(false)
    if (error) {
      message.error(errorText(error))
      return
    }
    notifyJournalChanged()
    message.success(peer ? t('已删除，两个账户的两笔都删了') : t('已删除'))
    onClose(true)
  }

  const allAccounts = accountOptions(accounts, !editing)
  // 记现金（不是从流水填）：支出、其他收入只能选现金账户
  const cashAccounts = accountOptions(
    accounts.filter((a) => isCashLike(a)),
    !editing,
  )
  const bankSide = kind === 'transfer' && !fromLine && ((acct && !isCashLike(acct)) || (toAcct && !isCashLike(toAcct)))
  const cur = acct?.currency ?? ''
  const usdAmount = kind !== 'transfer' && amount && fxRate ? round2(amount / fxRate) : null
  const rateText =
    kind === 'transfer' && !sameCurrency && amount && toAmount
      ? acct?.currency === 'USD'
        ? `1 USD = ${money(toAmount / amount)} ${toAcct?.currency}`
        : toAcct?.currency === 'USD'
          ? `1 USD = ${money(amount / toAmount)} ${acct?.currency}`
          : `1 ${acct?.currency} = ${(toAmount / amount).toFixed(4)} ${toAcct?.currency}`
      : null

  const title = editing
    ? t('{kind} {no}', { kind: t(KIND_LABEL[kind]), no: entry?.entry_no ?? '' })
    : fromLine
      ? t('填银行流水')
      : t('记一笔现金')

  const footer = (
    <div className="entry-footer">
      {editing && canEdit ? (
        <Popconfirm
          title={peer ? t('删除这笔互转？两个账户的两笔一起删') : t('删除这一笔？')}
          okText={t('删除')}
          okButtonProps={{ danger: true }}
          onConfirm={() => void remove()}
        >
          <Button danger icon={<DeleteOutlined />} loading={saving}>
            {t('删除')}
          </Button>
        </Popconfirm>
      ) : (
        <span>{count > 0 && <span className="hint">{t('这次已记 {n} 笔', { n: count })}</span>}</span>
      )}
      <Space wrap>
        <Button onClick={() => onClose(changed)}>{readOnly ? t('关闭') : t('取消')}</Button>
        {!editing && !fromLine && canEdit && (
          <Button onClick={() => void save(true)} loading={saving}>
            {t('保存并记下一笔')}
          </Button>
        )}
        {canEdit && (
          <Button type="primary" onClick={() => void save(false)} loading={saving}>
            {t('保存')}
          </Button>
        )}
      </Space>
    </div>
  )

  return (
    <Modal open={open} title={title} onCancel={() => onClose(changed)} footer={footer} width={760} destroyOnHidden className="cash-entry-editor">
      {!editing && (
        <Segmented<EntryKind>
          block
          className="entry-kind"
          value={kind}
          onChange={(k) => {
            // 从流水填的，换成互转时流水那一边不动：付出去的是转出，收进来的是转入
            if (fromLine && prefill) {
              const acc = prefill.account_id ?? prefill.to_account_id
              const amt = prefill.amount ?? prefill.to_amount
              if (k === 'transfer' && lineCredit) form.setFieldsValue({ account_id: undefined, amount: undefined, to_account_id: acc, to_amount: amt })
              else form.setFieldsValue({ account_id: acc, amount: amt, to_account_id: undefined, to_amount: undefined })
            }
            setKind(k)
            form.setFieldValue('module', undefined)
            setSummaryTouched(false)
          }}
          options={(fromLine ? (lineCredit ? ['in', 'transfer'] : ['out', 'transfer']) : (['out', 'in', 'transfer'] as EntryKind[])).map((k) => ({
            value: k as EntryKind,
            label: t(KIND_LABEL[k as EntryKind]),
          }))}
        />
      )}
      {fromLine && prefill && (
        <Alert
          type="success"
          showIcon
          className="entry-tip"
          title={
            <span>
              {t('银行流水')}：<span className="num">{prefill.entry_date}</span> · {prefill.bank_summary || '—'} ·{' '}
              <b className="num">
                {lineCredit ? '' : '−'}
                {money(prefill.amount ?? prefill.to_amount)}
              </b>
            </span>
          }
          description={t('日期、账户、金额照银行的，不能改；填好业务模块和摘要，保存后这条流水就填好了。')}
        />
      )}
      {!fromLine && !editing && kind !== 'transfer' && (
        <Alert
          type="info"
          showIcon
          className="entry-tip"
          title={
            kind === 'in'
              ? t('这里记现金的其他收入（维修、配件零售等）。客户的车款请在「到账录入」里录；银行账户的收付在「银行对账」里从流水填。')
              : t('这里记现金账户的支出。银行账户的付款在「银行对账」里从流水填，不在这里手工记，免得和流水重复。')
          }
        />
      )}
      {kind === 'in' && fromLine && (
        <Alert type="info" showIcon className="entry-tip" title={t('客户的车款请点「录成到账」，这里记利息、退款、理赔这些其他收入。')} />
      )}
      <Form form={form} layout="vertical" disabled={readOnly} requiredMark={false}>
        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="entry_date" label={t('日期')} rules={[{ required: true, message: t('请选日期') }]}>
              <DatePicker style={{ width: '100%' }} allowClear={false} disabled={readOnly || fromLine} />
            </Form.Item>
          </Col>
          {kind !== 'transfer' && (
            <>
              <Col xs={24} sm={16}>
                <Form.Item
                  name="account_id"
                  label={kind === 'out' ? t('付款账户') : t('收款账户')}
                  rules={[{ required: true, message: t('请选账户') }]}
                >
                  <Select
                    showSearch={{ optionFilterProp: 'label' }}
                    options={fromLine || editing ? allAccounts : cashAccounts}
                    placeholder={t('现金账户')}
                    disabled={readOnly || fromLine}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="amount" label={t('金额')} rules={[{ required: true, message: t('请填金额') }]}>
                  <InputNumber style={{ width: '100%' }} min={0.01} precision={2} suffix={cur} disabled={readOnly || fromLine} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="module" label={t('业务模块')} rules={[{ required: true, message: t('请选业务模块') }]}>
                  <Select
                    showSearch={{ optionFilterProp: 'label' }}
                    virtual={false}
                    options={moduleOptions(kind).map((m) => ({ value: m, label: t(m) }))}
                    labelRender={(o) => <Tag color={moduleColor(String(o.value))}>{o.label}</Tag>}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item
                  name="fx_rate"
                  label={t('汇率')}
                  tooltip={t('按日期自动带基础资料里的汇率，可以改；用来折美元，不填就只记原币')}
                  extra={usdAmount !== null ? <span className="num">≈ {usd(usdAmount)}</span> : null}
                >
                  <InputNumber style={{ width: '100%' }} min={0.0001} precision={4} disabled={readOnly || cur === 'USD'} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="counterparty" label={kind === 'out' ? t('收款方 / 供应商') : t('付款方 / 客户')}>
                  <AutoComplete options={counterpartyOptions} filterOption={(q, o) => String(o?.value ?? '').toLowerCase().includes(q.toLowerCase())} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="bank_ref" label={t('银行参考号 / 支票号')}>
                  <Input maxLength={80} />
                </Form.Item>
              </Col>
            </>
          )}
          {kind === 'transfer' && (
            <>
              <Col xs={24} sm={8}>
                <Form.Item label={t('业务模块')}>
                  <div className="auto-module-box">
                    <Tag color="purple" className="auto-module">
                      {t(module || autoModule)}
                    </Tag>
                    <span className="hint">{t('按两边的账户自动定')}</span>
                  </div>
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item name="bank_ref" label={t('银行参考号')}>
                  <Input maxLength={80} />
                </Form.Item>
              </Col>
            </>
          )}
        </Row>
        {kind === 'transfer' && (
          <div className="transfer-box">
            <Row gutter={12}>
              <Col xs={24} sm={11}>
                <Form.Item name="account_id" label={t('从哪个账户转出')} rules={[{ required: true, message: t('请选转出账户') }]}>
                  <Select showSearch={{ optionFilterProp: 'label' }} options={allAccounts} disabled={readOnly || lockFrom} />
                </Form.Item>
                <Form.Item name="amount" label={t('转出金额')} rules={[{ required: true, message: t('请填金额') }]}>
                  <InputNumber style={{ width: '100%' }} min={0.01} precision={2} suffix={acct?.currency} disabled={readOnly || lockFrom || (lockTo && sameCurrency)} />
                </Form.Item>
                <Form.Item name="fee" label={t('手续费（转出账户付）')} tooltip={t('银行转账另扣的手续费；填了就在转出账户另记一笔“手续费”支出')}>
                  <InputNumber style={{ width: '100%' }} min={0} precision={2} suffix={acct?.currency} />
                </Form.Item>
              </Col>
              <Col xs={0} sm={2} className="transfer-arrow">
                <SwapRightOutlined />
              </Col>
              <Col xs={24} sm={11}>
                <Form.Item
                  name="to_account_id"
                  label={t('转进哪个账户')}
                  dependencies={['account_id']}
                  rules={[
                    { required: true, message: t('请选转入账户') },
                    ({ getFieldValue }) => ({
                      validator: (_, v) => (v && v === getFieldValue('account_id') ? Promise.reject(new Error(t('转出、转入不能是同一个账户'))) : Promise.resolve()),
                    }),
                  ]}
                >
                  <Select showSearch={{ optionFilterProp: 'label' }} options={allAccounts} disabled={readOnly || lockTo} />
                </Form.Item>
                <Form.Item
                  name="to_amount"
                  label={t('转入金额')}
                  rules={[{ required: true, message: t('请填金额') }]}
                  extra={rateText ? <span className="num">{t('兑换汇率 {rate}', { rate: rateText })}</span> : sameCurrency && acct && toAcct ? t('币种一样，跟转出金额一样') : null}
                >
                  <InputNumber style={{ width: '100%' }} min={0.01} precision={2} suffix={toAcct?.currency} disabled={readOnly || lockTo || sameCurrency} />
                </Form.Item>
              </Col>
            </Row>
            {bankSide && <div className="hint transfer-note">{t('银行那一边先记着“等流水”，银行流水导进来按同账户、同金额、3 天内自动对上，对上之前不算进银行余额。')}</div>}
          </div>
        )}
        <Form.Item name="summary" label={t('摘要')} rules={[{ required: true, whitespace: true, message: t('请写摘要') }]}>
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 5 }}
            maxLength={500}
            onChange={() => setSummaryTouched(true)}
            placeholder={
              kind === 'out'
                ? t('例：付2台龙工挖机完税税款 BOE：40326179267')
                : kind === 'in'
                  ? t('例：收 10 月存款利息')
                  : t('例：资金拨付【8651户转4418户】')
            }
          />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item label={t('凭证')}>
              <Vouchers value={attachments} onChange={setAttachments} readOnly={readOnly} paste={open} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="note" label={t('备注')}>
              <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={300} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
      {kind === 'transfer' && acct && toAcct && amount ? (
        <Typography.Paragraph className="transfer-preview">
          {t('保存后记两笔：')}
          <span className="num">
            {acct.short_name} {t('支出')} {acct.currency} {money(amount)}
          </span>
          {' ； '}
          <span className="num">
            {toAcct.short_name} {t('收入')} {toAcct.currency} {money(toAmount ?? amount)}
          </span>
          {fee ? (
            <>
              {' ； '}
              <span className="num">
                {acct.short_name} {t('手续费')} {acct.currency} {money(fee)}
              </span>
            </>
          ) : null}
          {isCashLike(acct) !== isCashLike(toAcct) && (
            <span className="hint">
              {' '}
              （{isCashLike(acct) ? t('现金存进银行') : t('从银行取现金')}）
            </span>
          )}
        </Typography.Paragraph>
      ) : null}
      {editing && entry && <div className="hint entry-meta">{t('录入时间 {at}', { at: dayjs(entry.created_at).format('YYYY-MM-DD HH:mm') })}</div>}
    </Modal>
  )
}
