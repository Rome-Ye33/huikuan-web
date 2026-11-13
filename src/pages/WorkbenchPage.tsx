import { FileDoneOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons'
import { App, Badge, Button, Card, Empty, Pagination, Segmented, Space, Spin, Tabs, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CommissionEditor from '../components/CommissionEditor'
import ReceiptEditor from '../components/ReceiptEditor'
import SubmissionForm from '../components/SubmissionForm'
import { useAuth } from '../lib/auth'
import { dateTime, money, usd } from '../lib/format'
import { useT } from '../lib/i18n'
import { parseOpen } from '../lib/notify'
import { useRefData } from '../lib/refdata'
import { claimsSummary, isFillRequest } from '../lib/submissions'
import type { Submission } from '../lib/submissions'
import { supabase } from '../lib/supabase'
import { BOX_LABEL, BOX_ORDER, BOXES, boxQuery, DOC_COLOR, DOC_LABEL, docType, useDocLabels } from '../lib/workbench'
import type { Box, DocType, WorkItem } from '../lib/workbench'

// 工作台：到账提交、提成单、到账（录入后的审批）三种审批，按“待办 / 已办 / 已发起 / 已结束”分栏。点开就是原来的审核、修改页面

const PAGE = 20
type TypeFilter = DocType | 'all'
type Counts = Record<Box, number | null>
const NO_COUNTS: Counts = { todo: null, done: null, mine: null, ended: null }

const EMPTY_TEXT: Record<Box, string> = {
  todo: '没有待办，都处理完了',
  done: '没有处理过、还在流程中的单据',
  mine: '还没有发起过',
  ended: '还没有结束的单据',
}

function ItemCard({ it, box, showSp, onOpen }: { it: WorkItem; box: Box; showSp: boolean; onOpen: () => void }) {
  const t = useT()
  const labels = useDocLabels()
  const { accountById } = useRefData()
  const type = docType(it.doc_type)
  const isSub = type === 'submission'
  const isRec = type === 'receipt'
  /** 财务请业务员填写的到账提交（23） */
  const isReq = isSub && !!it.is_request

  const amountText = (
    <span className="num">
      {it.currency} {money(it.amount)}
      {it.currency !== 'USD' && it.amount_usd != null && <span className="hint"> ≈ {usd(it.amount_usd)}</span>}
    </span>
  )
  const title = isSub ? (
    amountText
  ) : isRec ? (
    <span>
      <b>{it.doc_no}</b> · {amountText}
    </span>
  ) : (
    <span>
      <b>{it.doc_no ?? t('草稿 #{id}', { id: it.doc_id ?? '' })}</b>
      {it.customer_name && <span> · {it.customer_name}</span>}
    </span>
  )

  const details: string[] =
    isSub || isRec ? claimsSummary(it, t) : [[t('{n} 台', { n: it.vehicle_count ?? 0 }), it.vins].filter(Boolean).join(' · ')]

  const meta = [
    showSp && !isRec ? it.salesperson_name : null,
    isSub || isRec ? accountById.get(it.account_id ?? 0)?.short_name : null,
    isSub || isRec ? t('到账 {date}', { date: it.doc_date ?? '' }) : it.amount != null ? t('本次发放 {amt}', { amt: '$ ' + money(it.amount) }) : null,
  ].filter(Boolean)

  const action = (a: string | null | undefined, step: string | null | undefined) => labels.action(a, step, type)
  const progress =
    box === 'done' && it.my_action
      ? t('我：{action} · {when}', { action: action(it.my_action, it.my_step), when: dateTime(it.my_at) })
      : it.last_action
        ? `${it.last_actor_name || t('系统')} · ${action(it.last_action, it.last_step)} · ${dateTime(it.last_at)}`
        : t('提交于 {when}', { when: dateTime(it.initiated_at) })

  return (
    <Card size="small" className="sub-card wb-card" hoverable onClick={onOpen}>
      <div className="wb-head">
        <div style={{ minWidth: 0 }}>
          <Tag color={DOC_COLOR[type]}>{t(DOC_LABEL[type])}</Tag>
          {isReq && <Tag color="orange">{t('财务请业务员填的')}</Tag>}
          {title}
        </div>
        <Tag color={labels.color(type, it.status, it.step)} style={{ marginInlineEnd: 0 }}>
          {labels.status(type, it.status, it.step)}
        </Tag>
      </div>
      {details.map((line, i) => (
        <div key={i} className="wb-line">
          {line}
        </div>
      ))}
      {meta.length > 0 && <div className="hint wb-line">{meta.join(' · ')}</div>}
      {it.status === 'rejected' && it.last_action === 'reject' && it.last_note && (
        <div className="text-danger wb-line">{t('退回原因：{reason}', { reason: it.last_note })}</div>
      )}
      {isReq && it.status === 'requested' && it.last_action === 'request' && it.last_note && (
        <div className="text-warn wb-line">{t('财务说：{note}', { note: it.last_note })}</div>
      )}
      {isSub && it.status === 'approved' && it.receipt_no && <div className="text-ok wb-line">{t('到账编号 {no}', { no: it.receipt_no })}</div>}
      <div className="hint wb-line" style={{ marginTop: 4 }}>
        {progress}
      </div>
    </Card>
  )
}

export default function WorkbenchPage() {
  const t = useT()
  const { message } = App.useApp()
  const { isStaff, role, posts } = useAuth()
  // 有审批岗位的人会看到别的业务员的提成单，卡片上要写是谁的
  const showSp = isStaff || posts.length > 0
  const isSales = role === 'sales'
  const [box, setBox] = useState<Box>('todo')
  const [type, setType] = useState<TypeFilter>('all')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<WorkItem[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Counts>(NO_COUNTS)
  const [loading, setLoading] = useState(false)
  const [voucher, setVoucher] = useState<{ open: boolean; id: number | null }>({ open: false, id: null })
  const [subForm, setSubForm] = useState<{ open: boolean; sub: Submission | null }>({ open: false, sub: null })
  const [review, setReview] = useState<Submission | null>(null)
  const [receiptId, setReceiptId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const order = BOX_ORDER[box]
    const from = (page - 1) * PAGE
    const [list, ...heads] = await Promise.all([
      boxQuery(box, type, 'exact')
        .order(order.column, { ascending: order.ascending, nullsFirst: false })
        .order('doc_id', { ascending: order.ascending })
        .range(from, from + PAGE - 1),
      ...BOXES.map((b) => boxQuery(b, type, 'exact', true)),
    ])
    setRows(list.data ?? [])
    setTotal(list.count ?? 0)
    setCounts({ todo: heads[0].count, done: heads[1].count, mine: heads[2].count, ended: heads[3].count })
    setLoading(false)
    if (list.error) message.error(list.error.message)
  }, [box, type, page, message])

  useEffect(() => {
    void load()
  }, [load])

  // 别处提交、审批了，跟着刷新
  useEffect(() => {
    const h = () => void load()
    const events = ['submissions-changed', 'vouchers-changed']
    for (const e of events) window.addEventListener(e, h)
    return () => {
      for (const e of events) window.removeEventListener(e, h)
    }
  }, [load])

  const openDoc = useCallback(
    async (type: DocType, id: number) => {
      if (type === 'voucher') {
        setVoucher({ open: true, id })
        return
      }
      if (type === 'receipt') {
        setReceiptId(id)
        return
      }
      const { data } = await supabase.from('receipt_submissions').select('*').eq('id', id).maybeSingle()
      if (!data) {
        message.warning(t('这张单据已经不在了'))
        void load()
        return
      }
      // 财务请业务员填写的：财务在那笔到账的页面看、审核；业务员打开填写表单
      if (isStaff && isFillRequest(data) && data.receipt_id) setReceiptId(data.receipt_id)
      else if (isStaff && data.status === 'pending') setReview(data)
      else if (isStaff && data.status === 'approved' && data.receipt_id) setReceiptId(data.receipt_id)
      else setSubForm({ open: true, sub: data })
    },
    [isStaff, load, message, t],
  )

  /** 从邮件提醒点进来的：先看看这张单还在不在、我能不能看，再打开 */
  const openFromLink = useCallback(
    async (type: DocType, id: number) => {
      const { data } =
        type === 'voucher'
          ? await supabase.from('v_commission_vouchers').select('id').eq('id', id).maybeSingle()
          : type === 'receipt'
            ? await supabase.from('v_bank_receipts').select('id').eq('id', id).maybeSingle()
            : await supabase.from('receipt_submissions').select('id').eq('id', id).maybeSingle()
      if (!data) {
        message.warning(t('这张单据已经不在了'))
        return
      }
      await openDoc(type, id)
    },
    [openDoc, message, t],
  )

  const open = (it: WorkItem) => {
    if (it.doc_id != null) void openDoc(docType(it.doc_type), it.doc_id)
  }

  // 邮件提醒里的“打开处理”：/workbench?open=v12 打开提成单 12，?open=s34 打开到账提交 34，?open=r56 打开到账 56
  const [params, setParams] = useSearchParams()
  const openParam = params.get('open')
  useEffect(() => {
    if (openParam === null) return
    setParams(
      (p) => {
        p.delete('open')
        return p
      },
      { replace: true },
    )
    const target = parseOpen(openParam)
    if (target) void openFromLink(target.type, target.id)
  }, [openParam, openFromLink, setParams])

  const closed = (changed: boolean) => {
    setVoucher({ open: false, id: null })
    setSubForm({ open: false, sub: null })
    setReview(null)
    setReceiptId(null)
    if (changed) void load()
  }

  const tabLabel = (b: Box) => {
    const n = counts[b]
    if (b === 'todo')
      return (
        <Badge count={n ?? 0} size="small" offset={[8, -2]}>
          {t(BOX_LABEL[b])}
        </Badge>
      )
    return (
      <span>
        {t(BOX_LABEL[b])}
        {n ? <span className="hint"> {n}</span> : null}
      </span>
    )
  }

  return (
    <div>
      <div className="page-title">
        <h2>{t('工作台')}</h2>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} aria-label={t('刷新')} />
          {isSales && (
            <Button type="primary" icon={<SendOutlined />} onClick={() => setSubForm({ open: true, sub: null })}>
              {t('提交到账')}
            </Button>
          )}
          <Button icon={<FileDoneOutlined />} onClick={() => setVoucher({ open: true, id: null })}>
            {t('新建提成单')}
          </Button>
        </Space>
      </div>
      <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
        {t('到账提交、到账和提成单的审批都在这里：待办是等你处理的，已办是你处理过、流程还没走完的，已发起是你提交（录入）的，已结束是流程走完的。点开就能处理。')}
      </Typography.Paragraph>
      <Tabs
        className="wb-tabs"
        activeKey={box}
        onChange={(k) => {
          setBox(k as Box)
          setPage(1)
        }}
        items={BOXES.map((b) => ({ key: b, label: tabLabel(b) }))}
      />
      <Segmented
        className="wb-type"
        value={type}
        onChange={(v) => {
          setType(v as TypeFilter)
          setPage(1)
        }}
        options={[
          { value: 'all', label: t('全部') },
          { value: 'submission', label: t(DOC_LABEL.submission) },
          { value: 'receipt', label: t(DOC_LABEL.receipt) },
          { value: 'voucher', label: t(DOC_LABEL.voucher) },
        ]}
        style={{ marginBottom: 12, maxWidth: '100%', overflowX: 'auto' }}
      />
      <Spin spinning={loading}>
        {rows.length === 0 ? (
          <Empty description={t(EMPTY_TEXT[box])} />
        ) : (
          <Space orientation="vertical" style={{ width: '100%' }} size={8}>
            {rows.map((it) => (
              <ItemCard key={`${it.doc_type}-${it.doc_id}`} it={it} box={box} showSp={showSp} onOpen={() => void open(it)} />
            ))}
          </Space>
        )}
      </Spin>
      {total > PAGE && (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <Pagination simple current={page} pageSize={PAGE} total={total} onChange={setPage} />
        </div>
      )}
      {total > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          {t('共 {n} 条', { n: total })}
        </div>
      )}

      <CommissionEditor open={voucher.open} voucherId={voucher.id} onClose={closed} />
      <SubmissionForm open={subForm.open} submission={subForm.sub} onClose={closed} />
      <ReceiptEditor open={review !== null || receiptId !== null} submission={review} receiptId={receiptId} onClose={closed} />
    </div>
  )
}
