import { DeleteOutlined, PrinterOutlined, SendOutlined } from '@ant-design/icons'
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
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import {
  asPost,
  isEditableStatus,
  notifyVouchersChanged,
  PAY_STATE_ZH,
  POST_LABEL,
  POSTS,
  parsePayments,
  parseVehicles,
  paymentDisplay,
  payStateVars,
  printVoucher,
  qtyModelText,
  savedTotals,
  STAGE_COLOR,
  STAGE_LABEL,
  voucherStage,
  voucherStatus,
  voucherTotals,
} from '../lib/commission'
import type { CommissionVoucher, Post, VoucherPayment, VoucherStage, VoucherStatus, VoucherVehicle } from '../lib/commission'
import type { Json } from '../lib/database.types'
import { errorText } from '../lib/errors'
import { dateTime, money, num, round2, todayAccra } from '../lib/format'
import { useT } from '../lib/i18n'
import { useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import type { Claim, Vehicle } from '../lib/supabase'
import ApprovalTrail from './ApprovalTrail'
import CustomerSelect from './CustomerSelect'
import Vouchers from './Vouchers'

// 提成申请单：按客户开，车从这个客户、这个业务员名下的车里选（大架号必填），
// 付款从这个客户的到账里勾（这几台车的，或者大架号还没锁定的）。提成金额手填。
// 流程都在线上：草稿 → 提交 → 销售部 → 应收财务 → 财务负责人 → 公司负责人 → 财务标记已发放。
// 每一级由谁审看审批岗位（用户与权限里指定）；岗位上没人时管理员代办。可以带附件。

type Props = {
  open: boolean
  /** 有值 = 打开已有的；没值 = 新建 */
  voucherId?: number | null
  onClose: (changed: boolean) => void
}

type Head = {
  voucher_date: dayjs.Dayjs
  dept: string
  salesperson_id: number | null
  customer_id: number | null
  qty_model: string
  other_charges_usd: number | null
  charges_note: string
  discount_usd: number | null
  full_payment: boolean
  down_payment_usd: number | null
  terms_count: number | null
  per_term_usd: number | null
  commission_usd: number | null
  /** 本次发放比例，界面上用百分数 */
  payout_pct: number | null
  remarks: string
}

type VehRow = { vehicle_id: number; note: string }
type PayRow = { claim_id: number; share_usd: number | null; note: string }
type Sel = { veh: VehRow[]; pay: PayRow[] }
/** 同一个客户的其他提成单（提示重复算） */
type Other = { id: number; no: string; stage: VoucherStage; vehicleIds: Set<number>; shares: Map<number, number> }
type Touched = { qty: boolean; discount: boolean; terms: boolean; ratio: boolean }

const EMPTY_SEL: Sel = { veh: [], pay: [] }
const ALL_TOUCHED: Touched = { qty: true, discount: true, terms: true, ratio: true }
const NONE_TOUCHED: Touched = { qty: false, discount: false, terms: false, ratio: false }

const optNum = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : num(v))
const usd2 = (v: unknown): string => (v === null || v === undefined || v === '' ? '' : '$ ' + money(v))
const isPayKind = (c: Claim) => c.nature_kind === 'payment' || c.nature_kind === 'opening'

function newHead(spId: number | null, dept: string): Head {
  return {
    voucher_date: dayjs(todayAccra()),
    dept,
    salesperson_id: spId,
    customer_id: null,
    qty_model: '',
    other_charges_usd: null,
    charges_note: '',
    discount_usd: null,
    full_payment: true,
    down_payment_usd: null,
    terms_count: null,
    per_term_usd: null,
    commission_usd: null,
    payout_pct: 100,
    remarks: '',
  }
}

function headFrom(v: CommissionVoucher): Head {
  return {
    voucher_date: dayjs(v.voucher_date ?? todayAccra()),
    dept: v.dept ?? '销售部',
    salesperson_id: v.salesperson_id,
    customer_id: v.customer_id,
    qty_model: v.qty_model ?? '',
    other_charges_usd: num(v.other_charges_usd) ? num(v.other_charges_usd) : null,
    charges_note: v.charges_note ?? '',
    discount_usd: num(v.discount_usd) ? num(v.discount_usd) : null,
    full_payment: v.full_payment ?? true,
    down_payment_usd: optNum(v.down_payment_usd),
    terms_count: optNum(v.terms_count),
    per_term_usd: optNum(v.per_term_usd),
    commission_usd: optNum(v.commission_usd),
    payout_pct: v.payout_ratio != null ? round2(num(v.payout_ratio) * 100) : null,
    remarks: v.remarks ?? '',
  }
}

/** 这笔到账能不能放进本单：这几台车的；或者大架号未锁定、是这个业务员的（财务开单时，没记业务员的也可以） */
function eligible(c: Claim, vids: Set<number>, spId: number | null, staff: boolean): boolean {
  if (!isPayKind(c) || c.id == null) return false
  if (c.vehicle_id != null) return vids.has(c.vehicle_id)
  return c.salesperson_id === spId || (staff && c.salesperson_id == null)
}

export default function CommissionEditor({ open, voucherId, onClose }: Props) {
  const t = useT()
  const { isStaff, isAdmin, profile, session, posts } = useAuth()
  const { salespersons, customers } = useRefData()
  const { message, modal } = App.useApp()
  const mySp = profile?.salesperson_id ?? null
  const myUid = session?.user.id ?? null

  const [voucher, setVoucher] = useState<CommissionVoucher | null>(null)
  const [head, setHead] = useState<Head>(() => newHead(null, '销售部'))
  const [sel, setSel] = useState<Sel>(EMPTY_SEL)
  const [ledger, setLedger] = useState<Vehicle[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [others, setOthers] = useState<Other[]>([])
  /** 附件（凭证 bucket 里的路径）。草稿里随便加减，保存时一起存；提交后只能再加 */
  const [atts, setAtts] = useState<string[]>([])
  const [spCounts, setSpCounts] = useState<Map<number, number>>(new Map())
  const [candLoading, setCandLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [changed, setChanged] = useState(false)
  const [dropped, setDropped] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [paying, setPaying] = useState(false)
  const [payDate, setPayDate] = useState<dayjs.Dayjs>(() => dayjs(todayAccra()))
  const touched = useRef<Touched>({ ...NONE_TOUCHED })
  const selRef = useRef<Sel>(EMPTY_SEL)
  /** 打开已有的草稿后第一次读到候选数据：有被去掉的车或付款要提示 */
  const noticePrune = useRef(false)

  useEffect(() => {
    selRef.current = sel
  }, [sel])

  const status: VoucherStatus = voucher ? voucherStatus(voucher.status) : 'draft'
  const stage: VoucherStage = voucher ? voucherStage(voucher.status, voucher.step) : 'draft'
  /** 审批中走到哪一级 */
  const step: Post | null = status === 'submitted' ? asPost(voucher?.step) : null
  /** 能改这张单的人：财务、管理员，或这张单的业务员（有审批岗位的人只能看和审别人的单） */
  const mine = !voucher || isStaff || (mySp != null && voucher.salesperson_id === mySp)
  const editable = !voucher || (isEditableStatus(status) && mine)
  const id = voucher?.id ?? null
  const custId = head.customer_id
  const spId = head.salesperson_id

  const loadVoucher = useCallback(
    async (vid: number) => {
      setLoading(true)
      const { data, error } = await supabase.from('v_commission_vouchers').select('*').eq('id', vid).single()
      setLoading(false)
      if (error || !data) {
        message.error(errorText(error))
        return
      }
      setVoucher(data)
      setHead(headFrom(data))
      setSel({
        veh: parseVehicles(data.vehicles).map((v) => ({ vehicle_id: v.vehicle_id, note: v.note ?? '' })),
        pay: parsePayments(data.payments).map((p) => ({ claim_id: p.claim_id, share_usd: p.share_usd, note: p.note ?? '' })),
      })
      setAtts(data.attachments ?? [])
      touched.current = { ...ALL_TOUCHED }
      noticePrune.current = true
      setDropped(null)
      setDirty(false)
    },
    [message],
  )

  // 打开：已有的 → 读出来；新建 → 清空（业务员只能给自己开）
  useEffect(() => {
    if (!open) return
    setChanged(false)
    setDirty(false)
    setDropped(null)
    setRejecting(false)
    setPaying(false)
    setLedger([])
    setClaims([])
    setOthers([])
    setSpCounts(new Map())
    if (voucherId) {
      void loadVoucher(voucherId)
      return
    }
    setVoucher(null)
    setHead(newHead(isStaff ? null : mySp, t('销售部')))
    setSel(EMPTY_SEL)
    setAtts([])
    touched.current = { ...NONE_TOUCHED }
    noticePrune.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在打开时取一次语言
  }, [open, voucherId, loadVoucher, isStaff, mySp])

  // 同一个客户的其他提成单：同一台车、同一笔付款算进了几张单
  useEffect(() => {
    if (!open || !custId) {
      setOthers([])
      return
    }
    let alive = true
    void supabase
      .from('v_commission_vouchers')
      .select('id,voucher_no,status,step,vehicles,payments')
      .eq('customer_id', custId)
      .limit(1000)
      .then(({ data }) => {
        if (!alive) return
        setOthers(
          (data ?? [])
            .filter((o) => o.id != null && o.id !== id)
            .map((o) => {
              const shares = new Map<number, number>()
              for (const p of parsePayments(o.payments)) shares.set(p.claim_id, (shares.get(p.claim_id) ?? 0) + p.share_usd)
              return {
                id: o.id as number,
                no: o.voucher_no ?? `#${o.id}`,
                stage: voucherStage(o.status, o.step),
                vehicleIds: new Set(parseVehicles(o.vehicles).map((v) => v.vehicle_id)),
                shares,
              }
            }),
        )
      })
    return () => {
      alive = false
    }
  }, [open, custId, id])

  // 可以选的车（这个客户、这个业务员名下）和这个客户的到账拆分
  useEffect(() => {
    if (!open || !editable || !custId || !spId) {
      setLedger([])
      setClaims([])
      return
    }
    let alive = true
    setCandLoading(true)
    void (async () => {
      const [lv, lc] = await Promise.all([
        supabase.from('v_vehicle_ledger').select('*').eq('customer_id', custId).eq('salesperson_id', spId).order('vin').limit(2000),
        supabase
          .from('v_receipt_claims')
          .select('*')
          .eq('customer_id', custId)
          .in('nature_kind', ['payment', 'opening', 'discount'])
          .order('claim_date')
          .order('id')
          .limit(5000),
      ])
      if (!alive) return
      const vehicles = lv.data ?? []
      const list = lc.data ?? []
      setLedger(vehicles)
      setClaims(list)
      setCandLoading(false)
      // 系统数据变了（车换了客户/业务员、到账改了）：去掉已经不能放进本单的
      const cur = selRef.current
      const ids = new Set(vehicles.map((v) => v.id))
      const veh = cur.veh.filter((r) => ids.has(r.vehicle_id))
      const vids = new Set(veh.map((r) => r.vehicle_id))
      const byId = new Map(list.map((c) => [c.id, c]))
      const pay = cur.pay.filter((p) => {
        const c = byId.get(p.claim_id)
        return !!c && eligible(c, vids, spId, isStaff)
      })
      if (veh.length !== cur.veh.length || pay.length !== cur.pay.length) {
        setSel({ veh, pay })
        if (noticePrune.current) {
          setDropped(
            t('有 {v} 台车、{p} 笔付款已经不符合条件（车或到账改过），已从本单去掉，请核对后保存。', {
              v: cur.veh.length - veh.length,
              p: cur.pay.length - pay.length,
            }),
          )
          setDirty(true)
        }
      }
      noticePrune.current = false
    })()
    return () => {
      alive = false
    }
  }, [open, editable, custId, spId, isStaff, id, t])

  // 财务开单：这个客户的车在哪些业务员名下（业务员下拉里显示台数）
  useEffect(() => {
    if (!open || !isStaff || !editable || !custId) {
      setSpCounts(new Map())
      return
    }
    let alive = true
    void vehicleCountsBySp(custId).then((m) => {
      if (alive) setSpCounts(m)
    })
    return () => {
      alive = false
    }
  }, [open, isStaff, editable, custId])

  const ledgerById = useMemo(() => new Map(ledger.map((v) => [v.id as number, v])), [ledger])
  const claimById = useMemo(() => new Map(claims.map((c) => [c.id as number, c])), [claims])
  /** 每笔付款在其他提成单上已经算了多少美元 */
  const used = useMemo(() => {
    const m = new Map<number, { usd: number; nos: string[] }>()
    for (const o of others)
      for (const [cid, usd] of o.shares) {
        const x = m.get(cid) ?? { usd: 0, nos: [] }
        x.usd += usd
        x.nos.push(o.no)
        m.set(cid, x)
      }
    return m
  }, [others])
  const vehOthers = (vid: number) => others.filter((o) => o.vehicleIds.has(vid))

  const vehIds = useMemo(() => new Set(sel.veh.map((r) => r.vehicle_id)), [sel.veh])
  const payCandidates = useMemo(() => claims.filter((c) => eligible(c, vehIds, spId, isStaff)), [claims, vehIds, spId, isStaff])
  const savedVehicles = useMemo(() => (voucher ? parseVehicles(voucher.vehicles) : []), [voucher])
  const savedPayments = useMemo(() => (voucher ? parsePayments(voucher.payments) : []), [voucher])

  const totals = useMemo(() => {
    if (!editable && voucher) return savedTotals(voucher)
    return voucherTotals({
      vehiclePrices: sel.veh.map((r) => num(ledgerById.get(r.vehicle_id)?.contract_usd)),
      otherCharges: head.other_charges_usd,
      discount: head.discount_usd,
      fullPayment: head.full_payment,
      downPayment: head.down_payment_usd,
      termsCount: head.terms_count,
      perTerm: head.per_term_usd,
      payments: sel.pay.map((p) => ({ share_usd: num(p.share_usd), nature: claimById.get(p.claim_id)?.nature ?? null })),
      commission: head.commission_usd,
      payoutRatio: head.payout_pct == null ? null : head.payout_pct / 100,
    })
  }, [editable, voucher, sel, ledgerById, claimById, head])

  /** 选车以后自动带出的：数量与设备型号、折扣（系统里的优惠折让）、是否全款和首付、发放比例。手改过的不再覆盖 */
  const withAuto = (h: Head, vs: Vehicle[]): Head => {
    const tc = touched.current
    const next = { ...h }
    if (!tc.qty) next.qty_model = qtyModelText(vs.map((v) => v.model ?? ''), (n, model) => t('{n}台 {model}', { n, model }), t('、'))
    if (!tc.discount) {
      const ids = new Set(vs.map((v) => v.id))
      const d = round2(
        claims.filter((c) => c.nature_kind === 'discount' && c.vehicle_id != null && ids.has(c.vehicle_id)).reduce((s, c) => s + num(c.amount_usd), 0),
      )
      next.discount_usd = d > 0 ? d : null
    }
    if (!tc.terms) {
      const inst = vs.filter((v) => v.payment_method === '分期')
      next.full_payment = inst.length === 0
      next.down_payment_usd = inst.length ? round2(inst.reduce((s, v) => s + num(v.down_payment_usd), 0)) : null
    }
    if (!tc.ratio) next.payout_pct = next.full_payment ? 100 : null
    return next
  }

  const edit = (patch: Partial<Head>, mark?: keyof Touched) => {
    if (mark) touched.current[mark] = true
    setDirty(true)
    setHead((h) => ({ ...h, ...patch }))
  }

  const pickCustomer = async (cid: number | null) => {
    setDirty(true)
    setSel(EMPTY_SEL)
    let sp = head.salesperson_id
    if (isStaff && cid) {
      // 默认业务员：客户资料上的；他名下没有这个客户的车时，用这个客户的车最多的那个业务员
      const counts = await vehicleCountsBySp(cid)
      if (!sp || !counts.has(sp)) {
        const own = customers.find((c) => c.id === cid)?.salesperson_id ?? null
        const most = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
        sp = own && counts.has(own) ? own : (most ?? own ?? sp)
      }
    }
    setHead(withAuto({ ...head, customer_id: cid, salesperson_id: isStaff ? sp : mySp }, []))
  }

  const pickSalesperson = (sp: number | null) => {
    setDirty(true)
    setSel(EMPTY_SEL)
    setHead(withAuto({ ...head, salesperson_id: sp }, []))
  }

  /**
   * 改了车：去掉不在本单的车的付款；新加的车自动勾上它的全部付款。
   * 车上的到账整笔都是这台车的，分期提成分几次发时，后面的单子也照样列全部付款（显示付款进度），所以不扣别的单子。
   */
  const setVehicles = (ids: number[]) => {
    setDirty(true)
    const keep = new Map(sel.veh.map((r) => [r.vehicle_id, r]))
    const veh = ids.map((vid) => keep.get(vid) ?? { vehicle_id: vid, note: '' })
    const vids = new Set(ids)
    const added = new Set(ids.filter((vid) => !keep.has(vid)))
    const pay = sel.pay.filter((p) => {
      const c = claimById.get(p.claim_id)
      return !c || c.vehicle_id == null || vids.has(c.vehicle_id)
    })
    for (const c of claims) {
      if (!isPayKind(c) || c.id == null || c.vehicle_id == null || !added.has(c.vehicle_id)) continue
      if (pay.some((p) => p.claim_id === c.id)) continue
      pay.push({ claim_id: c.id, share_usd: num(c.amount_usd), note: '' })
    }
    setSel({ veh, pay })
    setHead(withAuto(head, veh.map((r) => ledgerById.get(r.vehicle_id)).filter((v): v is Vehicle => !!v)))
  }

  const setVehNote = (vid: number, note: string) => {
    setDirty(true)
    setSel((s) => ({ ...s, veh: s.veh.map((r) => (r.vehicle_id === vid ? { ...r, note } : r)) }))
  }

  /** 勾选付款：车上的默认整笔；大架号未锁定的（可能分给几张单）默认扣掉别的单子已经算的 */
  const setTicked = (keys: React.Key[]) => {
    setDirty(true)
    const keep = new Map(sel.pay.map((p) => [p.claim_id, p]))
    const pay = keys.map((k) => {
      const cid = Number(k)
      const old = keep.get(cid)
      if (old) return old
      const c = claimById.get(cid)
      const whole = c ? num(c.amount_usd) : null
      const left = c && c.vehicle_id == null ? round2(num(c.amount_usd) - (used.get(cid)?.usd ?? 0)) : 0
      return { claim_id: cid, share_usd: left > 0.005 ? left : whole, note: '' }
    })
    setSel((s) => ({ ...s, pay }))
  }

  const setPay = (cid: number, patch: Partial<PayRow>) => {
    setDirty(true)
    setSel((s) => ({ ...s, pay: s.pay.map((p) => (p.claim_id === cid ? { ...p, ...patch } : p)) }))
  }

  const payload = (): Json => ({
    id: id ?? null,
    voucher_date: head.voucher_date.format('YYYY-MM-DD'),
    dept: head.dept,
    customer_id: head.customer_id,
    salesperson_id: head.salesperson_id,
    qty_model: head.qty_model,
    other_charges_usd: head.other_charges_usd ?? 0,
    charges_note: head.charges_note,
    discount_usd: head.discount_usd ?? 0,
    full_payment: head.full_payment,
    down_payment_usd: head.full_payment ? null : head.down_payment_usd,
    terms_count: head.full_payment ? null : head.terms_count,
    per_term_usd: head.full_payment ? null : head.per_term_usd,
    commission_usd: head.commission_usd,
    payout_ratio: head.payout_pct == null ? null : Math.round(head.payout_pct * 100) / 10000,
    remarks: head.remarks,
    vehicles: sel.veh.map((r) => ({ vehicle_id: r.vehicle_id, note: r.note })),
    payments: sel.pay.map((p) => ({ claim_id: p.claim_id, share_usd: p.share_usd, note: p.note })),
  })

  /** 保存（新建或改草稿），成功返回 id */
  const save = async (quiet = false): Promise<number | null> => {
    if (!head.customer_id) {
      message.error(t('请选客户'))
      return null
    }
    if (!head.salesperson_id) {
      message.error(t('请选业务员'))
      return null
    }
    for (const [i, p] of sel.pay.entries()) {
      const c = claimById.get(p.claim_id)
      if (!(num(p.share_usd) > 0) || (c && num(p.share_usd) > num(c.amount_usd) + 0.005)) {
        message.error(t('第 {n} 笔付款：本单金额要大于 0，且不超过这笔付款的金额', { n: i + 1 }))
        return null
      }
    }
    setBusy('save')
    const { data, error } = await supabase.rpc('save_commission_voucher', { p: payload() })
    setBusy(null)
    if (error) {
      message.error(t('保存失败：') + errorText(error))
      return null
    }
    // 附件有变化的另存（整份换）
    const before = voucher?.attachments ?? []
    if (atts.length !== before.length || atts.some((x, i) => x !== before[i])) {
      const res = await supabase.rpc('commission_voucher_attach', { p_id: data, p_paths: atts, p_replace: true })
      if (res.error) {
        message.error(t('附件没存上：') + errorText(res.error))
        setChanged(true)
        await loadVoucher(data)
        return null
      }
    }
    if (!quiet) message.success(t('已保存'))
    setChanged(true)
    notifyVouchersChanged()
    await loadVoucher(data)
    return data
  }

  /** 提交以后补附件：马上存，只能加 */
  const appendAtts = async (paths: string[]) => {
    if (!id) return
    const added = paths.filter((x) => !atts.includes(x))
    if (!added.length) return
    const { data, error } = await supabase.rpc('commission_voucher_attach', { p_id: id, p_paths: added })
    if (error) {
      message.error(t('附件没存上：') + errorText(error))
      return
    }
    setAtts(data ?? [...atts, ...added])
    setChanged(true)
  }

  const DONE: Record<string, string> = {
    submit: '已提交，等销售部审核',
    withdraw: '已撤回，可以修改后再提交',
    approve_sales_dept: '销售部已通过，等应收财务审核',
    approve_ar: '应收财务已通过，等财务负责人审核',
    approve_finance_head: '财务负责人已通过，等公司负责人审批',
    approve_company_head: '已批准，等财务发放',
    reject: '已退回',
    pay: '已标记为已发放',
    unpay: '已取消发放',
  }

  const act = async (vid: number, action: string, note?: string, date?: string): Promise<boolean> => {
    setBusy(action)
    const { error } = await supabase.rpc('commission_voucher_action', { p_id: vid, p_action: action, p_note: note, p_date: date })
    setBusy(null)
    if (error) {
      message.error(errorText(error))
      return false
    }
    message.success(t(DONE[action] ?? '已保存'))
    setChanged(true)
    notifyVouchersChanged()
    await loadVoucher(vid)
    return true
  }

  const submit = async () => {
    const err = !head.customer_id
      ? t('请选客户')
      : !sel.veh.length
        ? t('请至少选一台车（大架号必填）')
        : !sel.pay.length
          ? t('请勾选客户的付款')
          : !(num(head.commission_usd) > 0)
            ? t('请填提成金额')
            : head.payout_pct == null
              ? t('请填本次发放比例')
              : null
    if (err) {
      message.error(err)
      return
    }
    const vid = await save(true)
    if (vid) await act(vid, 'submit')
  }

  const reject = async () => {
    if (!id) return
    if (!rejectReason.trim()) {
      message.error(t('请写退回原因'))
      return
    }
    if (await act(id, 'reject', rejectReason.trim())) setRejecting(false)
  }

  const markPaid = async () => {
    if (!id) return
    if (await act(id, 'pay', undefined, payDate.format('YYYY-MM-DD'))) setPaying(false)
  }

  const unpay = () => {
    if (!id) return
    modal.confirm({
      title: t('取消发放？'),
      content: t('提成单会回到“已批准待发放”。'),
      okText: t('取消发放'),
      cancelText: t('不取消'),
      onOk: () => act(id, 'unpay'),
    })
  }

  const remove = () => {
    if (!id) return
    modal.confirm({
      title: t('删除这张提成单？'),
      content: t('删除后不能恢复。'),
      okText: t('删除'),
      cancelText: t('取消'),
      okButtonProps: { danger: true },
      onOk: async () => {
        const { data, error } = await supabase.from('commission_vouchers').delete().eq('id', id).select('id')
        if (error || !data?.length) {
          message.error(error ? errorText(error) : t('删不了：只有草稿和被退回的提成单可以删'))
          return
        }
        message.success(t('已删除'))
        notifyVouchersChanged()
        onClose(true)
      },
    })
  }

  const close = () => {
    if (dirty && editable) {
      modal.confirm({
        title: t('有改动还没保存，确定关闭？'),
        okText: t('不保存，关闭'),
        cancelText: t('取消'),
        onOk: () => onClose(changed),
      })
    } else onClose(changed)
  }

  // ---------- 显示 ----------
  const spName = salespersons.find((s) => s.id === spId)?.name ?? ''
  // 销售部还没审之前可以撤回：业务员撤自己名下的，财务撤自己开的
  const canWithdraw = !!id && step === 'sales_dept' && (isStaff ? voucher?.prepared_by === myUid : mine)
  // 轮到我这个岗位，或者我是管理员（代办）
  const holdsStep = !!step && posts.includes(step)
  const canApprove = !!id && !!step && (holdsStep || isAdmin)
  const canReject = !!id && (canApprove || (status === 'approved' && (isAdmin || posts.includes('company_head'))))
  const canPay = !!id && status === 'approved' && isStaff
  const canUnpay = !!id && status === 'paid' && isAdmin
  const canDelete = !!id && editable
  const approveText: Record<Post, string> = {
    sales_dept: '销售部审核通过',
    ar: '应收财务审核通过',
    finance_head: '财务负责人审核通过',
    company_head: '公司负责人批准',
  }

  const title = !id
    ? t('新建提成单')
    : voucher?.voucher_no
      ? t('提成单 {no}', { no: voucher.voucher_no })
      : t('提成单草稿 #{id}', { id })

  const othersTags = (list: { no: string; stage?: VoucherStage }[]) =>
    list.map((o) => (
      <Tooltip key={o.no} title={o.stage ? t(STAGE_LABEL[o.stage]) : undefined}>
        <Tag color="orange" style={{ marginInlineEnd: 4 }}>
          {o.no}
        </Tag>
      </Tooltip>
    ))

  const spOptions = salespersons
    .filter((s) => s.active || s.id === spId || spCounts.has(s.id))
    .map((s) => ({
      value: s.id,
      label: spCounts.has(s.id) ? t('{name}（{n} 台）', { name: s.name, n: spCounts.get(s.id) ?? 0 }) : s.name,
      n: spCounts.get(s.id) ?? 0,
    }))
    .sort((a, b) => b.n - a.n)

  const vehColumns: ColumnsType<VehRow> = [
    { title: t('序号'), width: 56, render: (_, __, i) => i + 1 },
    { title: t('大架号'), width: 190, render: (_, r) => <b>{ledgerById.get(r.vehicle_id)?.vin}</b> },
    { title: t('品牌 / 车型'), ellipsis: true, render: (_, r) => ledgerById.get(r.vehicle_id)?.model },
    { title: t('付款方式'), width: 90, render: (_, r) => t(ledgerById.get(r.vehicle_id)?.payment_method ?? '') },
    { title: t('单价（USD）'), width: 120, align: 'right', render: (_, r) => <span className="num">{usd2(ledgerById.get(r.vehicle_id)?.contract_usd)}</span> },
    {
      title: t('已到账 / 余额'),
      width: 150,
      render: (_, r) => {
        const v = ledgerById.get(r.vehicle_id)
        return v ? (
          <span className="hint num">
            {usd2(v.received_usd)} / {usd2(v.balance_usd)}
          </span>
        ) : null
      },
    },
    { title: t('其他提成单'), width: 130, render: (_, r) => othersTags(vehOthers(r.vehicle_id)) },
    {
      title: t('备注'),
      width: 160,
      render: (_, r) => <Input size="small" value={r.note} onChange={(e) => setVehNote(r.vehicle_id, e.target.value)} />,
    },
    {
      title: '',
      width: 44,
      render: (_, r) => (
        <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => setVehicles(sel.veh.filter((x) => x.vehicle_id !== r.vehicle_id).map((x) => x.vehicle_id))} />
      ),
    },
  ]

  const savedVehColumns: ColumnsType<VoucherVehicle> = [
    { title: t('序号'), width: 56, render: (_, __, i) => i + 1 },
    { title: t('大架号'), dataIndex: 'vin', width: 190, render: (x: string) => <b>{x}</b> },
    { title: t('品牌 / 车型'), dataIndex: 'model', ellipsis: true },
    { title: t('付款方式'), dataIndex: 'payment_method', width: 90, render: (x: string | null) => t(x ?? '') },
    { title: t('单价（USD）'), dataIndex: 'unit_price_usd', width: 120, align: 'right', render: (x: number) => <span className="num">{usd2(x)}</span> },
    { title: t('其他提成单'), width: 130, render: (_, r) => othersTags(vehOthers(r.vehicle_id)) },
    { title: t('备注'), dataIndex: 'note', ellipsis: true },
  ]

  const ticked = new Map(sel.pay.map((p) => [p.claim_id, p]))
  const payColumns: ColumnsType<Claim> = [
    { title: t('款项性质'), dataIndex: 'nature', width: 100, render: (x: string) => t(x) },
    { title: t('日期'), dataIndex: 'claim_date', width: 100 },
    {
      title: t('到账编号'),
      width: 150,
      render: (_, c) => (
        <div>
          <div>{c.receipt_no ?? t('期初')}</div>
          <div className="hint">{c.claim_no}</div>
        </div>
      ),
    },
    {
      title: t('金额'),
      width: 150,
      align: 'right',
      render: (_, c) => <span className="num">{c.receipt_id ? `${c.currency} ${money(c.amount_orig)}` : `USD ${money(c.amount_usd)}`}</span>,
    },
    { title: t('汇率'), width: 80, align: 'right', render: (_, c) => (c.currency && c.currency !== 'USD' ? num(c.fx_rate) : '') },
    { title: t('折合美元'), dataIndex: 'amount_usd', width: 110, align: 'right', render: (x) => <span className="num">{usd2(x)}</span> },
    {
      title: t('大架号'),
      width: 180,
      render: (_, c) =>
        c.vehicle_id ? (
          c.vin
        ) : (
          <span>
            <Tag color="orange">{t('未锁定')}</Tag>
            {c.model_desc}
          </span>
        ),
    },
    {
      title: t('本单金额（USD）'),
      width: 140,
      render: (_, c) => {
        const p = ticked.get(c.id as number)
        return (
          <InputNumber
            size="small"
            min={0}
            precision={2}
            prefix="$"
            style={{ width: '100%' }}
            disabled={!p}
            value={p ? (p.share_usd ?? undefined) : undefined}
            onChange={(x) => setPay(c.id as number, { share_usd: x == null ? null : Number(x) })}
          />
        )
      },
    },
    {
      title: t('其他提成单'),
      width: 150,
      render: (_, c) => {
        const u = used.get(c.id as number)
        return u ? (
          <Tooltip title={t('其他提成单已算 {amt}', { amt: usd2(u.usd) })}>
            <span>{othersTags(u.nos.map((no) => ({ no })))}</span>
          </Tooltip>
        ) : null
      },
    },
    {
      title: t('备注'),
      width: 160,
      render: (_, c) => {
        const p = ticked.get(c.id as number)
        return <Input size="small" disabled={!p} value={p?.note ?? ''} onChange={(e) => setPay(c.id as number, { note: e.target.value })} />
      },
    },
  ]

  const savedPayColumns: ColumnsType<VoucherPayment> = [
    { title: t('款项性质'), dataIndex: 'nature', width: 100, render: (x: string | null) => t(x ?? '') },
    { title: t('日期'), dataIndex: 'pay_date', width: 100 },
    {
      title: t('到账编号'),
      width: 150,
      render: (_, p) => (
        <div>
          <div>{p.receipt_no ?? t('期初')}</div>
          <div className="hint">{p.claim_no}</div>
        </div>
      ),
    },
    {
      title: t('本单收款金额'),
      width: 150,
      align: 'right',
      render: (_, p) => {
        const d = paymentDisplay(p)
        return <span className="num">{`${d.currency} ${money(d.amount)}`}</span>
      },
    },
    { title: t('汇率'), width: 80, align: 'right', render: (_, p) => paymentDisplay(p).rate ?? '' },
    { title: t('折合美元'), dataIndex: 'share_usd', width: 110, align: 'right', render: (x) => <span className="num">{usd2(x)}</span> },
    { title: t('大架号'), dataIndex: 'vin', width: 180, render: (x: string | null) => x ?? <Tag color="orange">{t('未锁定')}</Tag> },
    {
      title: t('其他提成单'),
      width: 130,
      render: (_, p) => {
        const u = used.get(p.claim_id)
        return u ? othersTags(u.nos.map((no) => ({ no }))) : null
      },
    },
    {
      title: t('备注'),
      ellipsis: true,
      render: (_, p) => {
        const d = paymentDisplay(p)
        return [p.note, d.sharedFrom ? t('合付 {whole}', { whole: d.sharedFrom }) : ''].filter(Boolean).join('；')
      },
    },
  ]

  const st = totals.state
  const stateTag = (
    <Tag color={st.kind === 'overpaid' ? 'red' : st.kind === 'paid_off' ? 'green' : 'blue'}>{t(PAY_STATE_ZH[st.kind], payStateVars(st))}</Tag>
  )
  const discountInSystem = round2(
    claims.filter((c) => c.nature_kind === 'discount' && c.vehicle_id != null && vehIds.has(c.vehicle_id)).reduce((s, c) => s + num(c.amount_usd), 0),
  )

  const stepCurrent = step ? POSTS.indexOf(step) + 1 : { draft: 0, rejected: 0, submitted: 1, approved: 5, paid: 6 }[status]
  const signed = (name: string | null | undefined, at: string | null | undefined, dateOnly = false) =>
    name ? `${name} · ${dateOnly ? (at ?? '') : dateTime(at)}` : ''
  const signOf: Record<Post, string> = {
    sales_dept: signed(voucher?.dept_name, voucher?.dept_at),
    ar: signed(voucher?.ar_name, voucher?.ar_at),
    finance_head: signed(voucher?.finance_name, voucher?.finance_at),
    company_head: signed(voucher?.gm_name, voucher?.gm_at),
  }

  return (
    <Drawer
      open={open}
      title={
        <Space wrap>
          <span>{title}</span>
          {id && <Tag color={STAGE_COLOR[stage]}>{t(STAGE_LABEL[stage])}</Tag>}
        </Space>
      }
      size={Math.min(1180, typeof window !== 'undefined' ? window.innerWidth : 1180)}
      onClose={close}
      destroyOnHidden
      extra={
        <Space wrap>
          {id && (
            <Button icon={<PrinterOutlined />} onClick={() => printVoucher(id)}>
              {t('打印')}
            </Button>
          )}
          {canDelete && (
            <Button danger onClick={remove}>
              {t('删除')}
            </Button>
          )}
          {canWithdraw && (
            <Button loading={busy === 'withdraw'} onClick={() => void act(id as number, 'withdraw')}>
              {t('撤回')}
            </Button>
          )}
          {canReject && (
            <Button
              danger
              onClick={() => {
                setRejectReason('')
                setRejecting(true)
              }}
            >
              {t('退回')}
            </Button>
          )}
          {canUnpay && <Button onClick={unpay}>{t('取消发放')}</Button>}
          {editable && (
            <Button loading={busy === 'save'} onClick={() => void save()}>
              {t('保存草稿')}
            </Button>
          )}
          {editable && (
            <Button type="primary" icon={<SendOutlined />} loading={busy === 'submit'} onClick={() => void submit()}>
              {t('提交')}
            </Button>
          )}
          {canApprove && step && (
            <Button type="primary" loading={busy === `approve_${step}`} onClick={() => void act(id as number, `approve_${step}`)}>
              {holdsStep ? t(approveText[step]) : t('代{post}通过', { post: t(POST_LABEL[step]) })}
            </Button>
          )}
          {canPay && (
            <Button
              type="primary"
              onClick={() => {
                setPayDate(dayjs(todayAccra()))
                setPaying(true)
              }}
            >
              {t('标记已发放')}
            </Button>
          )}
        </Space>
      }
    >
      <Spin spinning={loading}>
        {!id && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title={t('按客户开单：选好客户和业务员，再选这单的车（大架号必填）。系统会带出这几台车的到账；大架号还没锁定的到账也可以勾上。提成金额手填。')}
          />
        )}
        {status === 'rejected' && voucher?.reject_note && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            title={t('被退回：{reason}', { reason: voucher.reject_note })}
            description={t('{name} 于 {when} 退回。改好后重新提交。', { name: voucher.rejected_name ?? '', when: dateTime(voucher.rejected_at) })}
          />
        )}
        {dropped && <Alert type="warning" showIcon closable style={{ marginBottom: 12 }} title={dropped} onClose={() => setDropped(null)} />}
        {id && (
          <Card size="small" style={{ marginBottom: 12 }}>
            <Steps
              size="small"
              current={stepCurrent}
              status={status === 'rejected' ? 'error' : status === 'paid' ? 'finish' : 'process'}
              items={[
                { title: t('制单'), content: signed(voucher?.prepared_name, voucher?.prepared_at) },
                ...POSTS.map((p) => ({ title: t(POST_LABEL[p]), content: signOf[p] })),
                { title: t('发放'), content: signed(voucher?.paid_name, voucher?.paid_on, true) },
              ]}
            />
          </Card>
        )}

        <Card size="small" title={t('一、客户及车辆')} style={{ marginBottom: 12 }}>
          <Form layout="vertical" disabled={!editable}>
            <Row gutter={12}>
              <Col xs={12} md={5}>
                <Form.Item label={t('日期')}>
                  <DatePicker
                    value={head.voucher_date}
                    allowClear={false}
                    style={{ width: '100%' }}
                    onChange={(d) => {
                      if (d) edit({ voucher_date: d })
                    }}
                  />
                </Form.Item>
              </Col>
              <Col xs={12} md={5}>
                <Form.Item label={t('申请部门')}>
                  <Input value={head.dept} onChange={(e) => edit({ dept: e.target.value })} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item label={t('业务员')} required>
                  {isStaff ? (
                    <Select
                      showSearch={{ optionFilterProp: 'label' }}
                      value={spId ?? undefined}
                      placeholder={t('选择业务员')}
                      options={spOptions}
                      onChange={(x: number | undefined) => pickSalesperson(x ?? null)}
                    />
                  ) : (
                    <Input value={spName} disabled />
                  )}
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item label={t('客户')} required>
                  <CustomerSelect value={custId} onChange={(c) => void pickCustomer(c)} />
                </Form.Item>
              </Col>
              <Col xs={24}>
                <Form.Item label={t('数量与设备型号')}>
                  <Input
                    value={head.qty_model}
                    placeholder={t('选了车会自动填，如 2台 重汽6X4自卸车')}
                    onChange={(e) => edit({ qty_model: e.target.value }, 'qty')}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form>

          {editable ? (
            <>
              <Select
                mode="multiple"
                style={{ width: '100%', marginBottom: 8 }}
                placeholder={custId && spId ? t('选这单的车（只列这个客户在这个业务员名下的车）') : t('先选客户和业务员')}
                disabled={!custId || !spId}
                loading={candLoading}
                maxTagCount="responsive"
                showSearch={{ optionFilterProp: 'label' }}
                value={sel.veh.map((r) => r.vehicle_id)}
                onChange={(ids: number[]) => setVehicles(ids)}
                notFoundContent={candLoading ? t('读取中…') : t('这个客户在这个业务员名下没有车。车还不在系统里的，请财务先录车。')}
                options={ledger.map((v) => ({ value: v.id as number, label: `${v.vin} · ${v.model}`, v }))}
                optionRender={(o) => {
                  const v = (o.data as { v: Vehicle }).v
                  const on = vehOthers(v.id as number)
                  return (
                    <div>
                      <div>
                        <b>{v.vin}</b> · {v.model}
                      </div>
                      <div className="hint">
                        {t(v.payment_method ?? '')} · {t('合同')} {usd2(v.contract_usd)} · {t('余额')} {usd2(v.balance_usd)}
                        {on.length > 0 && <span className="text-warn"> · {t('已在提成单 {nos}', { nos: on.map((x) => x.no).join(t('、')) })}</span>}
                      </div>
                    </div>
                  )
                }}
              />
              <Table
                rowKey="vehicle_id"
                size="small"
                pagination={false}
                dataSource={sel.veh}
                columns={vehColumns}
                scroll={{ x: 1000 }}
                locale={{ emptyText: t('还没选车') }}
              />
            </>
          ) : (
            <Table rowKey="vehicle_id" size="small" pagination={false} dataSource={savedVehicles} columns={savedVehColumns} scroll={{ x: 860 }} />
          )}
          <div style={{ marginTop: 8 }}>
            {t('台数合计 {n} 台，车辆合计 {amt}', { n: totals.units, amt: usd2(totals.vehiclesUsd) })}
          </div>
        </Card>

        <Card size="small" title={t('二、销售及付款方式')} style={{ marginBottom: 12 }}>
          <Form layout="vertical" disabled={!editable}>
            <Row gutter={12}>
              <Col xs={12} md={6}>
                <Form.Item label={t('其他费用（USD）')}>
                  <InputNumber
                    min={0}
                    precision={2}
                    prefix="$"
                    style={{ width: '100%' }}
                    value={head.other_charges_usd}
                    onChange={(x) => edit({ other_charges_usd: x == null ? null : Number(x) })}
                  />
                </Form.Item>
              </Col>
              <Col xs={12} md={10}>
                <Form.Item label={t('费用说明')}>
                  <Input value={head.charges_note} placeholder={t('如：清关费、地板胶')} onChange={(e) => edit({ charges_note: e.target.value })} />
                </Form.Item>
              </Col>
              <Col xs={12} md={8}>
                <Form.Item
                  label={t('折扣（USD）')}
                  extra={editable && discountInSystem > 0 ? t('系统里这几台车的优惠折让合计 {amt}', { amt: usd2(discountInSystem) }) : undefined}
                >
                  <InputNumber
                    min={0}
                    precision={2}
                    prefix="$"
                    style={{ width: '100%' }}
                    value={head.discount_usd}
                    onChange={(x) => edit({ discount_usd: x == null ? null : Number(x) }, 'discount')}
                  />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item label={t('销售总金额')}>
                  <b className="num">{usd2(totals.totalSales)}</b>
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item label={t('是否全款')}>
                  <Radio.Group
                    optionType="button"
                    value={head.full_payment}
                    options={[
                      { value: true, label: t('是') },
                      { value: false, label: t('否') },
                    ]}
                    onChange={(e) => {
                      const full = Boolean(e.target.value)
                      const patch: Partial<Head> = { full_payment: full }
                      if (!touched.current.ratio) patch.payout_pct = full ? 100 : null
                      edit(patch, 'terms')
                    }}
                  />
                </Form.Item>
              </Col>
              {!head.full_payment && (
                <>
                  <Col xs={12} md={6}>
                    <Form.Item label={t('首付金额（USD）')}>
                      <InputNumber
                        min={0}
                        precision={2}
                        prefix="$"
                        style={{ width: '100%' }}
                        value={head.down_payment_usd}
                        onChange={(x) => edit({ down_payment_usd: x == null ? null : Number(x) }, 'terms')}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={6}>
                    <Form.Item label={t('分期期数')}>
                      <InputNumber
                        min={1}
                        precision={0}
                        style={{ width: '100%' }}
                        value={head.terms_count}
                        onChange={(x) => edit({ terms_count: x == null ? null : Number(x) })}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={6}>
                    <Form.Item label={t('每期金额（USD）')}>
                      <InputNumber
                        min={0.01}
                        precision={2}
                        prefix="$"
                        style={{ width: '100%' }}
                        value={head.per_term_usd}
                        onChange={(x) => edit({ per_term_usd: x == null ? null : Number(x) })}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={6}>
                    <Form.Item label={t('已还 / 剩余期数')}>
                      <span className="num">{totals.termsPaid == null ? '—' : `${totals.termsPaid} / ${totals.termsLeft}`}</span>
                    </Form.Item>
                  </Col>
                </>
              )}
            </Row>
          </Form>
        </Card>

        <Card size="small" title={t('三、客户付款明细')} style={{ marginBottom: 12 }}>
          {editable ? (
            <Table
              rowKey={(c) => c.id as number}
              size="small"
              pagination={false}
              loading={candLoading}
              dataSource={payCandidates}
              columns={payColumns}
              scroll={{ x: 1400 }}
              rowSelection={{ selectedRowKeys: sel.pay.map((p) => p.claim_id), onChange: (keys) => setTicked(keys) }}
              locale={{
                emptyText: sel.veh.length
                  ? t('这几台车还没有到账。大架号还没锁定的钱，要先在到账录入里记到这个客户名下。')
                  : t('先选车，系统会带出这几台车的到账'),
              }}
            />
          ) : (
            <Table rowKey="claim_id" size="small" pagination={false} dataSource={savedPayments} columns={savedPayColumns} scroll={{ x: 1100 }} />
          )}
          <Space wrap size={[24, 8]} style={{ marginTop: 10 }}>
            <span>
              {t('客户已支付金额合计')}：<b className="num">{usd2(totals.paid)}</b>
            </span>
            <span>
              {t('未付余额')}：<b className={`num ${totals.balance > 1 ? 'text-danger' : ''}`}>{usd2(totals.balance)}</b>
            </span>
            <span>
              {t('付款进度')}：<b className="num">{totals.progress == null ? '—' : `${(totals.progress * 100).toFixed(1)}%`}</b>
            </span>
            <span>
              {t('分期情况')}：{stateTag}
            </span>
          </Space>
          {editable && (
            <div className="hint" style={{ marginTop: 6 }}>
              {t('一笔钱付了几张单时，“本单金额”只填算进这张单的美元。')}
            </div>
          )}
        </Card>

        <Card size="small" title={t('四、提成')}>
          <Form layout="vertical" disabled={!editable}>
            <Row gutter={12}>
              <Col xs={12} md={6}>
                <Form.Item label={t('提成金额（USD）')} required>
                  <InputNumber
                    min={0}
                    precision={2}
                    prefix="$"
                    style={{ width: '100%' }}
                    value={head.commission_usd}
                    onChange={(x) => edit({ commission_usd: x == null ? null : Number(x) })}
                  />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item label={t('本次发放比例')} required>
                  <InputNumber
                    min={0.01}
                    max={100}
                    precision={2}
                    suffix="%"
                    style={{ width: '100%' }}
                    placeholder={t('按公司规定')}
                    value={head.payout_pct}
                    onChange={(x) => edit({ payout_pct: x == null ? null : Number(x) }, 'ratio')}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item label={t('备注')}>
                  <Input value={head.remarks} onChange={(e) => edit({ remarks: e.target.value })} />
                </Form.Item>
              </Col>
            </Row>
          </Form>
          <Typography.Text strong>
            {t('本次发放提成合计')}：<span className="num">{totals.payout == null ? '—' : usd2(totals.payout)}</span>
          </Typography.Text>
        </Card>
        <Card size="small" title={t('附件')} className="cv-attachments" style={{ marginTop: 12 }}>
          <Vouchers
            kind="attachment"
            value={atts}
            prefix={isStaff ? 'cv' : `sub/${myUid ?? ''}`}
            readOnly={!editable && !id}
            canRemove={editable}
            paste={editable}
            onChange={
              editable
                ? (paths) => {
                    setAtts(paths)
                    setDirty(true)
                  }
                : (paths) => void appendAtts(paths)
            }
          />
          <div className="hint" style={{ marginTop: 4 }}>
            {editable
              ? t('合同、付款凭证、聊天截图等，图片、PDF、Excel、Word 都可以。保存或提交时一起存。')
              : t('审批的人也可以补附件。提交以后附件只能加，不能去掉。')}
          </div>
        </Card>
        {id && <ApprovalTrail docType="voucher" docId={id} version={voucher?.updated_at} />}
      </Spin>

      <Drawer
        open={rejecting}
        title={t('退回提成单')}
        size={Math.min(480, typeof window !== 'undefined' ? window.innerWidth : 480)}
        onClose={() => setRejecting(false)}
        extra={
          <Button danger type="primary" loading={busy === 'reject'} onClick={() => void reject()}>
            {t('退回')}
          </Button>
        }
      >
        <Typography.Paragraph>{t('写清楚哪里不对、要怎么改，制单人会看到，改好后重新提交。')}</Typography.Paragraph>
        <Input.TextArea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          autoSize={{ minRows: 3, maxRows: 8 }}
          placeholder={t('如：第二台车的首付还没到账；提成金额不对')}
          autoFocus
        />
      </Drawer>

      <Modal
        open={paying}
        title={t('标记已发放')}
        okText={t('确定')}
        cancelText={t('取消')}
        confirmLoading={busy === 'pay'}
        onOk={() => void markPaid()}
        onCancel={() => setPaying(false)}
      >
        <Typography.Paragraph>
          {t('本次发放提成合计')}：<b className="num">{usd2(totals.payout)}</b>
        </Typography.Paragraph>
        <div className="field-label">{t('发放日期')}</div>
        <DatePicker value={payDate} allowClear={false} onChange={(d) => d && setPayDate(d)} style={{ width: '100%' }} />
      </Modal>
    </Drawer>
  )
}

/** 某个客户的车在各个业务员名下各有几台 */
async function vehicleCountsBySp(customerId: number): Promise<Map<number, number>> {
  const { data } = await supabase.from('v_vehicle_ledger').select('salesperson_id').eq('customer_id', customerId).limit(5000)
  const m = new Map<number, number>()
  for (const r of data ?? []) if (r.salesperson_id != null) m.set(r.salesperson_id, (m.get(r.salesperson_id) ?? 0) + 1)
  return m
}
