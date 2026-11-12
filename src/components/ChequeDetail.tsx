import { App, Button, Card, DatePicker, Descriptions, Drawer, Form, Input, InputNumber, Select, Space, Spin, Tag, Timeline, Typography } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import type { Json } from '../lib/database.types'
import { useAuth } from '../lib/auth'
import { CHEQUE_ACTION_COLOR, CHEQUE_ACTION_LABEL, CHEQUE_STATUS_COLOR, CHEQUE_STATUS_LABEL, chequeAction, chequeStatus, chequeVins, fetchChequeLogs, notifyChequesChanged } from '../lib/cheques'
import type { Cheque, ChequeAction, ChequeLog } from '../lib/cheques'
import { errorText } from '../lib/errors'
import { useFlow } from '../lib/flow'
import { dateTime, money, todayAccra, usd } from '../lib/format'
import { useT } from '../lib/i18n'
import { accountOptions, useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import type { Receipt } from '../lib/supabase'

// 一张支票：信息、状态操作（沟通、请业务确认、定计划、存票、退票、取消、恢复、生成到账、对上到账、取消关联、删除）、记录

type Props = {
  open: boolean
  cheque: Cheque | null
  onClose: () => void
  /** 改了（状态、内容、删除）以后列表要重新读 */
  onChanged: () => void
  onEdit: (c: Cheque) => void
  /** 生成到账：打开新建到账页，带着账户、日期、金额、支票号、车 */
  onCreateReceipt: (c: Cheque) => void
  /** 点到账编号：打开那笔到账 */
  onOpenReceipt: (id: number) => void
}

type Dialog = 'note' | 'confirm' | 'plan' | 'deposit' | 'bounce' | 'cancel' | 'reopen' | 'link' | 'unlink' | null

type DialogValues = { note?: string; plan_date?: dayjs.Dayjs | null; deposit_date?: dayjs.Dayjs | null; deposit_account_id?: number; amount?: number | null; receipt_id?: number }

export default function ChequeDetail({ open, cheque, onClose, onChanged, onEdit, onCreateReceipt, onOpenReceipt }: Props) {
  const t = useT()
  const { message, modal } = App.useApp()
  const { isStaff } = useAuth()
  const { accounts } = useRefData()
  const rflow = useFlow('receipt')
  const [logs, setLogs] = useState<{ id: number; rows: ChequeLog[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [acting, setActing] = useState(false)
  const [form] = Form.useForm<DialogValues>()
  const [candidates, setCandidates] = useState<Receipt[]>([])

  const id = cheque?.id ?? null
  const status = chequeStatus(cheque?.status)
  const version = cheque?.updated_at
  const vins = cheque ? chequeVins(cheque) : []
  const models = (cheque?.models ?? cheque?.model ?? '').split(' / ')

  const loadLogs = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const rows = await fetchChequeLogs(id)
    setLogs({ id, rows })
    setLoading(false)
  }, [id])

  useEffect(() => {
    if (open && id) void loadLogs()
  }, [open, id, version, loadLogs])

  // 对上到账：列出同币种、没被别的支票对上的到账（同金额的排前面），最近 90 天
  useEffect(() => {
    if (dialog !== 'link' || !cheque) return
    let alive = true
    void (async () => {
      const [r, taken] = await Promise.all([
        supabase
          .from('v_bank_receipts')
          .select('*')
          .eq('currency', cheque.currency ?? 'GHS')
          .gte('receipt_date', dayjs(todayAccra()).subtract(90, 'day').format('YYYY-MM-DD'))
          .order('receipt_date', { ascending: false })
          .order('id', { ascending: false })
          .limit(300),
        supabase.from('cheques').select('receipt_id').not('receipt_id', 'is', null),
      ])
      if (!alive) return
      const used = new Set((taken.data ?? []).map((x) => x.receipt_id))
      const list = (r.data ?? []).filter((x) => !used.has(x.id))
      const amt = cheque.amount != null ? Number(cheque.amount) : null
      list.sort((a, b) => Number(Number(b.amount_orig) === amt) - Number(Number(a.amount_orig) === amt))
      setCandidates(list)
    })()
    return () => {
      alive = false
    }
  }, [dialog, cheque])

  const openDialog = (d: Dialog) => {
    form.resetFields()
    if (d === 'deposit') {
      form.setFieldsValue({
        deposit_date: dayjs(todayAccra()),
        deposit_account_id: cheque?.deposit_account_id ?? undefined,
        amount: cheque?.amount != null ? Number(cheque.amount) : null,
      })
    }
    if (d === 'plan') form.setFieldValue('plan_date', cheque?.plan_date ? dayjs(cheque.plan_date) : null)
    setDialog(d)
  }

  const run = async (action: ChequeAction, p: Record<string, Json | undefined> = {}) => {
    if (!id || !cheque) return false
    setActing(true)
    const { error } = await chequeAction(id, action, { ...p, updated_at: cheque.updated_at })
    setActing(false)
    if (error) {
      message.error(errorText(error))
      return false
    }
    notifyChequesChanged()
    onChanged()
    return true
  }

  const submitDialog = async () => {
    if (!dialog || !cheque) return
    let v: DialogValues
    try {
      v = await form.validateFields()
    } catch {
      return
    }
    const note = v.note?.trim() || undefined
    let ok = false
    if (dialog === 'note') ok = await run('note', { note })
    else if (dialog === 'confirm') ok = await run('confirm', { note })
    else if (dialog === 'plan') ok = await run('plan', { note, plan_date: v.plan_date ? v.plan_date.format('YYYY-MM-DD') : null })
    else if (dialog === 'deposit')
      ok = await run('deposit', {
        note,
        deposit_date: v.deposit_date ? v.deposit_date.format('YYYY-MM-DD') : null,
        deposit_account_id: v.deposit_account_id ?? null,
        amount: v.amount ?? null,
      })
    else if (dialog === 'bounce') ok = await run('bounce', { note })
    else if (dialog === 'cancel') ok = await run('cancel', { note })
    else if (dialog === 'reopen') ok = await run('reopen', { note })
    else if (dialog === 'unlink') ok = await run('unlink', { note })
    else if (dialog === 'link') ok = await run('link', { receipt_id: v.receipt_id ?? null })
    if (ok) {
      setDialog(null)
      message.success(
        dialog === 'note'
          ? t('已记下')
          : dialog === 'deposit'
            ? t('已记为已存。钱到了以后点“生成到账”，或在到账录入里填这个支票号，系统会自动对上')
            : dialog === 'link'
              ? t('已对上到账')
              : t('已更新'),
      )
    }
  }

  const remove = () => {
    if (!id) return
    modal.confirm({
      title: t('删除这张支票？'),
      content: t('录错了才删；客户收回、作废的请用“取消”并写原因，好留下记录。'),
      okText: t('删除'),
      okButtonProps: { danger: true },
      cancelText: t('返回'),
      onOk: async () => {
        const { data, error } = await supabase.from('cheques').delete().eq('id', id).select('id')
        if (error || !data?.length) {
          message.error(error ? errorText(error) : t('这张支票删不了（已经对上到账的先取消关联）'))
          return
        }
        message.success(t('已删除'))
        notifyChequesChanged()
        onChanged()
        onClose()
      },
    })
  }

  const dialogTitle: Record<NonNullable<Dialog>, string> = {
    note: '记一条沟通',
    confirm: '请业务确认',
    plan: '定计划存票日期',
    deposit: '存票',
    bounce: '退票',
    cancel: '取消这张支票',
    reopen: '恢复待存',
    link: '对上已录的到账',
    unlink: '取消和到账的关联',
  }

  const c = cheque
  const canOpen = status === 'pending' || status === 'confirming'
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={Math.min(760, typeof window !== 'undefined' ? window.innerWidth : 760)}
      destroyOnHidden
      className="cheque-detail"
      title={
        c ? (
          <Space wrap>
            <span>
              {t('支票')} {c.cheque_no}
            </span>
            <Tag color={CHEQUE_STATUS_COLOR[status]}>{t(CHEQUE_STATUS_LABEL[status])}</Tag>
            {status === 'cleared' && (c.is_reported ? <Tag color="green">{t('已报回款')}</Tag> : <Tag color="blue">{t('未报回款')}</Tag>)}
          </Space>
        ) : (
          t('支票')
        )
      }
      extra={
        c && isStaff ? (
          <Space wrap>
            <Button size="small" onClick={() => onEdit(c)}>
              {t('修改')}
            </Button>
            {status !== 'cleared' && (
              <Button size="small" danger onClick={remove}>
                {t('删除')}
              </Button>
            )}
          </Space>
        ) : null
      }
    >
      {c && (
        <>
          <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered className="cheque-desc">
            <Descriptions.Item label={t('客户')}>{c.customer_name}</Descriptions.Item>
            <Descriptions.Item label={t('支票名称')}>{c.drawer_name ?? ''}</Descriptions.Item>
            <Descriptions.Item label={t('支票银行')}>{c.drawer_bank ?? ''}</Descriptions.Item>
            <Descriptions.Item label={t('支票金额')}>
              <span className="num">{c.amount != null ? `${c.currency} ${money(c.amount)}` : t('空白支票')}</span>
            </Descriptions.Item>
            <Descriptions.Item label={t('到期日期')}>
              {c.due_date ?? t('没写日期')}
              {c.due_date && canOpen && c.days_to_due != null && c.days_to_due < 0 && <Tag color="red" style={{ marginInlineStart: 8 }}>{t('已过期 {n} 天', { n: -c.days_to_due })}</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label={t('分期款/月')}>{c.installment_usd != null ? usd(c.installment_usd) : ''}</Descriptions.Item>
            <Descriptions.Item label={t('哪几台车的')} span={vins.length > 1 ? 2 : 1}>
              {vins.length ? (
                vins.map((vin, i) => (
                  <div key={vin}>
                    <span className="cv-vin">{vin}</span>
                    {models[i] ? ` · ${models[i]}` : ''}
                  </div>
                ))
              ) : (
                t('没选车')
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t('业务员')}>{c.salesperson_name ?? ''}</Descriptions.Item>
            <Descriptions.Item label={t('用途')}>{t(c.purpose ?? '')}</Descriptions.Item>
            <Descriptions.Item label={t('计划存票日期')}>{c.plan_date ?? ''}</Descriptions.Item>
            {(status === 'deposited' || status === 'cleared') && (
              <>
                <Descriptions.Item label={t('存票日期')}>
                  {c.deposit_date}
                  {status === 'deposited' && c.days_deposited != null && (
                    <Tag color={c.days_deposited >= 3 ? 'red' : 'default'} style={{ marginInlineStart: 8 }}>
                      {t('已存 {n} 天', { n: c.days_deposited })}
                    </Tag>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label={t('存票账户')}>{c.deposit_account_name}</Descriptions.Item>
              </>
            )}
            {status === 'cleared' && c.receipt_id != null && (
              <Descriptions.Item label={t('到账')} span={2}>
                <a onClick={() => onOpenReceipt(c.receipt_id!)}>{c.receipt_no}</a>
                <span className="hint" style={{ marginInlineStart: 8 }}>
                  {c.receipt_date} · {rflow.stageLabel(c.receipt_status, null)} · {c.is_reported ? t('已报回款') : t('还没报回款，到到账录入里报')}
                </span>
              </Descriptions.Item>
            )}
            {c.reason && (
              <Descriptions.Item label={t('原因')} span={2}>
                <span className="text-danger">{c.reason}</span>
              </Descriptions.Item>
            )}
            {c.note && (
              <Descriptions.Item label={t('备注')} span={2}>
                {c.note}
              </Descriptions.Item>
            )}
          </Descriptions>

          {isStaff && (
            <Space wrap style={{ marginTop: 14 }} className="cheque-actions">
              <Button onClick={() => openDialog('note')}>{t('记一条沟通')}</Button>
              {canOpen && (
                <Button type="primary" onClick={() => openDialog('deposit')}>
                  {t('存票')}
                </Button>
              )}
              {status === 'pending' && <Button onClick={() => openDialog('confirm')}>{t('请业务确认')}</Button>}
              {canOpen && <Button onClick={() => openDialog('plan')}>{t('定计划存票日期')}</Button>}
              {status === 'deposited' && (
                <Button type="primary" onClick={() => onCreateReceipt(c)}>
                  {t('生成到账')}
                </Button>
              )}
              {(status === 'deposited' || canOpen) && <Button onClick={() => openDialog('link')}>{t('对上已录的到账')}</Button>}
              {status === 'deposited' && (
                <Button danger onClick={() => openDialog('bounce')}>
                  {t('退票')}
                </Button>
              )}
              {status === 'bounced' && (
                <>
                  <Button type="primary" onClick={() => openDialog('deposit')}>
                    {t('再存')}
                  </Button>
                  <Button onClick={() => openDialog('confirm')}>{t('请业务确认')}</Button>
                </>
              )}
              {status === 'cleared' && <Button onClick={() => openDialog('unlink')}>{t('取消和到账的关联')}</Button>}
              {(canOpen || status === 'deposited' || status === 'bounced') && (
                <Button danger onClick={() => openDialog('cancel')}>
                  {t('取消')}
                </Button>
              )}
              {(status === 'cancelled' || status === 'bounced' || status === 'deposited') && <Button onClick={() => openDialog('reopen')}>{t('恢复待存')}</Button>}
            </Space>
          )}

          <Card size="small" title={t('记录')} style={{ marginTop: 14 }} className="cheque-trail">
            <Spin spinning={loading}>
              {logs?.id === id && logs.rows.length > 0 ? (
                <Timeline
                  items={logs.rows.map((l) => ({
                    key: l.id,
                    color: CHEQUE_ACTION_COLOR[l.action] ?? 'gray',
                    content: (
                      <div>
                        <div>
                          <b>{t(CHEQUE_ACTION_LABEL[l.action] ?? l.action)}</b>
                          <span className="hint" style={{ marginInlineStart: 8 }}>
                            {l.actor_name || t('系统')} · {dateTime(l.at)}
                          </span>
                        </div>
                        {l.note && <div className={l.action === 'bounce' || l.action === 'cancel' ? 'text-danger' : undefined}>{l.note}</div>}
                      </div>
                    ),
                  }))}
                />
              ) : (
                <Typography.Text type="secondary">{t('还没有记录')}</Typography.Text>
              )}
            </Spin>
          </Card>
        </>
      )}

      <Drawer open={!!dialog} onClose={() => setDialog(null)} title={dialog ? t(dialogTitle[dialog]) : ''} width={Math.min(520, typeof window !== 'undefined' ? window.innerWidth : 520)} destroyOnHidden className="cheque-dialog">
        <Form form={form} layout="vertical" onFinish={submitDialog}>
          {dialog === 'deposit' && (
            <>
              <Form.Item name="deposit_account_id" label={t('存进哪个账户')} rules={[{ required: true, message: t('请选存进哪个账户') }]}>
                <Select showSearch={{ optionFilterProp: 'label' }} options={accountOptions(accounts.filter((a) => a.currency === (c?.currency ?? 'GHS') && a.kind === 'bank'))} />
              </Form.Item>
              <Form.Item name="deposit_date" label={t('存票日期')} rules={[{ required: true, message: t('请选存票日期') }]}>
                <DatePicker style={{ width: '100%' }} maxDate={dayjs(todayAccra())} />
              </Form.Item>
              <Form.Item name="amount" label={t('支票金额')} rules={[{ required: true, message: t('空白支票存之前要填金额') }]} extra={c?.amount == null ? t('这是空白支票，写上金额再存') : undefined}>
                <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </>
          )}
          {dialog === 'plan' && (
            <Form.Item name="plan_date" label={t('计划哪天存')} extra={t('空着 = 去掉计划')}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          )}
          {dialog === 'link' && (
            <Form.Item name="receipt_id" label={t('到账')} rules={[{ required: true, message: t('请选要对上的到账') }]} extra={t('只列同币种、最近 90 天、还没对上别的支票的到账；同金额的排前面')}>
              <Select
                showSearch={{ optionFilterProp: 'label' }}
                virtual={false}
                options={candidates.map((r) => ({
                  value: r.id as number,
                  label: `${r.receipt_no} · ${r.receipt_date} · ${r.currency} ${money(r.amount_orig)} · ${r.account_name}${r.cheque_no ? ' · ' + r.cheque_no : ''}`,
                }))}
                notFoundContent={t('没有可以对上的到账，用“生成到账”新录一笔')}
              />
            </Form.Item>
          )}
          {dialog === 'unlink' && <Typography.Paragraph type="secondary">{t('取消关联后支票回到“已存”，到账本身不动')}</Typography.Paragraph>}
          {dialog !== 'link' && (
            <Form.Item
              name="note"
              label={dialog === 'bounce' ? t('退票原因') : dialog === 'cancel' ? t('取消原因') : dialog === 'note' ? t('沟通内容') : t('说明（可不写）')}
              rules={dialog === 'bounce' || dialog === 'cancel' || dialog === 'note' ? [{ required: true, message: t('请写一下') }] : []}
              extra={dialog === 'cancel' ? t('比如：客户转账了、客户付现金拿走支票、已结清、写错换新票') : dialog === 'confirm' ? t('比如：问业务员这张能不能存、客户账上有没有钱') : undefined}
            >
              <Input.TextArea rows={3} maxLength={500} />
            </Form.Item>
          )}
          <Space>
            <Button type="primary" htmlType="submit" loading={acting} danger={dialog === 'bounce' || dialog === 'cancel'}>
              {dialog ? t(dialogTitle[dialog]) : ''}
            </Button>
            <Button onClick={() => setDialog(null)}>{t('返回')}</Button>
          </Space>
        </Form>
      </Drawer>
    </Drawer>
  )
}
