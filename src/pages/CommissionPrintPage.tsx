import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons'
import { Button, Checkbox, Result, Space, Spin } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import CommissionSheet from '../components/CommissionSheet'
import { parseVehicles } from '../lib/commission'
import type { CommissionVoucher } from '../lib/commission'
import { errorText } from '../lib/errors'
import { num } from '../lib/format'
import { useT } from '../lib/i18n'
import { useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import { fetchTrail } from '../lib/workbench'
import type { ApprovalLog } from '../lib/workbench'

// 提成单打印页：不带菜单，只有一张单；浏览器“打印”可以直接打或另存为 PDF
// 换一张单（地址里的 id 变了）就整页重来，免得新单还没读完时露出上一张的内容或审批过程
//
// 车多、付款多、审批步骤多的单子按原大小一页放不下（Rome 2026-11-13「我希望能打印在一页上」），
// 所以出单以后量一下高度，放不下就整张单子一起缩小（像 Excel 的“调整为一页”），屏幕上看到的就是打出来的样子。
// 量高度时按打印的宽度 190mm 量，窗口宽窄不影响缩放比例。最多缩到 60%，再小看不清，宁可打两页。
// 不想缩的在工具栏把“缩到一页”去掉。

/** A4 竖版 297mm 减掉上下页边距各 10mm（@page 里设的） */
const PAGE_MM = 277
/** 打印时单子的宽度：A4 210mm 减掉左右页边距各 10mm */
const SHEET_MM = 190
/** 最多缩到这么小 */
const MIN_SCALE = 0.6

/** 这张单要缩到几成才放得进一页（scale = 1 表示不用缩），以及缩之前有多高（px）：
 *  print = 按打印的宽度 190mm 排版时的高度（分页看这个），screen = 现在窗口里的高度（窗口窄时会更高） */
function fitScale(sheet: HTMLElement): { scale: number; print: number; screen: number } {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;top:0;left:-9999px;visibility:hidden;width:100mm;height:100mm'
  document.body.appendChild(probe)
  const pxPerMm = probe.getBoundingClientRect().height / 100
  probe.remove()
  if (!pxPerMm) return { scale: 1, print: 0, screen: 0 }
  const onScreen = sheet.scrollHeight
  // 窗口比一页窄时单子会被挤窄、变高，所以量之前先按打印的宽度排一次
  const { width, maxWidth } = sheet.style
  sheet.style.width = `${SHEET_MM}mm`
  sheet.style.maxWidth = 'none'
  const height = sheet.scrollHeight
  sheet.style.width = width
  sheet.style.maxWidth = maxWidth
  const page = PAGE_MM * pxPerMm
  if (!height || height <= page) return { scale: 1, print: height, screen: onScreen }
  return { scale: Math.max(MIN_SCALE, Math.floor((page / height) * 100) / 100), print: height, screen: onScreen }
}

export default function CommissionPrintPage() {
  const { id } = useParams()
  return <PrintOne key={id} id={id} />
}

function PrintOne({ id }: { id: string | undefined }) {
  const t = useT()
  const navigate = useNavigate()
  const [v, setV] = useState<CommissionVoucher | null>(null)
  /** 审批过程（approval_logs）：读完才出单，免得打印时还没出来 */
  const [trail, setTrail] = useState<ApprovalLog[] | null>(null)
  /** 每台车现在的到账情况（车辆台账）：一张单上可以混着结清和没结清的车，印出来要看得出是哪几台 */
  const [ledger, setLedger] = useState<Map<number, { received: number; balance: number }> | null>(null)
  const [err, setErr] = useState<string | null>(null)
  /** 缩到一页（默认缩）；去掉勾就按原大小，放不下就打两页 */
  const [fit, setFit] = useState(true)
  const [scale, setScale] = useState(1)
  /** 没缩之前这张单有多高（px）：打印时和现在窗口里可能不一样（窗口窄时单子会被挤高） */
  const [height, setHeight] = useState({ print: 0, screen: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  // 签字栏要用审批流里级别的名字，等基础资料读好再出单
  const { loaded } = useRefData()
  /** 这张单上的车（台账里的 id）：没有就不用查到账情况 */
  const vids = useMemo(() => (v ? parseVehicles(v.vehicles).map((x) => x.vehicle_id).filter((x) => x > 0) : []), [v])
  const ready = !!v && loaded && trail !== null && (ledger !== null || !vids.length)

  useEffect(() => {
    const vid = Number(id)
    if (!Number.isFinite(vid)) {
      setErr(t('找不到这张提成单'))
      return
    }
    let alive = true
    void supabase
      .from('v_commission_vouchers')
      .select('*')
      .eq('id', vid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return
        if (error) setErr(errorText(error))
        else if (!data) setErr(t('找不到这张提成单，或没有权限'))
        else setV(data)
      })
    void fetchTrail('voucher', vid).then((list) => {
      if (alive) setTrail(list)
    })
    return () => {
      alive = false
    }
  }, [id, t])

  // 每台车现在的到账情况（车辆台账里的数）
  useEffect(() => {
    if (!vids.length) return
    let alive = true
    void supabase
      .from('v_vehicle_ledger')
      .select('id,received_usd,balance_usd')
      .in('id', vids)
      .then(({ data }) => {
        // 读不到就空着这一栏，单子照出
        if (alive) setLedger(new Map((data ?? []).map((r) => [Number(r.id), { received: num(r.received_usd), balance: num(r.balance_usd) }])))
      })
    return () => {
      alive = false
    }
  }, [vids])

  // 打印时浏览器用页面标题当文件名
  useEffect(() => {
    if (!v) return
    const old = document.title
    document.title = [v.voucher_no ?? `#${v.id}`, v.customer_name, 'Commission Voucher'].filter(Boolean).join(' ')
    return () => {
      document.title = old
    }
  }, [v])

  const measure = useCallback(() => {
    const wrap = wrapRef.current
    const inner = innerRef.current
    const sheet = inner?.querySelector<HTMLElement>('.cv-sheet')
    if (!wrap || !inner || !sheet) return
    // 量的是没缩之前的高度
    // 量之前先把缩放和裁切去掉，量完再恢复
    const tf = inner.style.transform
    const on = wrap.classList.contains('cv-fit-on')
    inner.style.transform = 'none'
    wrap.classList.remove('cv-fit-on')
    const fitted = fitScale(sheet)
    inner.style.transform = tf
    wrap.classList.toggle('cv-fit-on', on)
    setScale(fitted.scale)
    setHeight({ print: fitted.print, screen: fitted.screen })
  }, [])

  // 出单后量一次（等排完版）；字体加载完高度会变，再量一次
  useEffect(() => {
    if (!ready || !fit) return
    let alive = true
    const again = () => {
      if (alive) measure()
    }
    const raf = requestAnimationFrame(again)
    void (typeof document !== 'undefined' && document.fonts ? document.fonts.ready : Promise.resolve(null)).then(again)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [ready, fit, v, trail, ledger, measure])

  // 实际用的比例：没勾“缩到一页”就按原大小。缩放用 transform，不用 zoom——量过，Chrome 打印时
  // 按 zoom 之前的高度分页，照样打成两页。transform 不占位置，所以分两层：里面那层缩小（排版高度不变），
  // 外面那层高度 = 缩完的高度、overflow hidden，分页就按缩完的算。
  // 窗口比一页窄时单子会被挤高，所以外面那层的高度给两个：屏幕上按现在的高度，打印时按 190mm 排版的高度（styles.css）。
  const applied = fit ? scale : 1
  const scaled = applied < 1 && height.print > 0
  const outerStyle = scaled
    ? ({
        '--fit-h': `${Math.ceil(Math.max(height.screen, height.print) * applied) + 2}px`,
        '--fit-h-print': `${Math.ceil(height.print * applied) + 2}px`,
      } as CSSProperties)
    : undefined
  const innerStyle = scaled ? { transform: `scale(${applied})`, transformOrigin: 'top center' } : undefined

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <Space wrap>
          <Checkbox checked={fit} onChange={(e) => setFit(e.target.checked)}>
            {t('缩到一页')}
          </Checkbox>
          {applied < 1 && <span className="hint">{t('已缩到 {pct}%', { pct: Math.round(applied * 100) })}</span>}
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/commission')}>
            {t('回到提成申请单')}
          </Button>
          <Button type="primary" icon={<PrinterOutlined />} disabled={!ready} onClick={() => window.print()}>
            {t('打印')}
          </Button>
        </Space>
      </div>
      {err ? (
        <Result status="warning" title={err} />
      ) : v && ready ? (
        <div className={scaled ? 'cv-fit cv-fit-on' : 'cv-fit'} ref={wrapRef} style={outerStyle}>
          <div ref={innerRef} style={innerStyle}>
            <CommissionSheet v={v} trail={trail ?? []} ledger={ledger ?? undefined} />
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      )}
    </div>
  )
}
