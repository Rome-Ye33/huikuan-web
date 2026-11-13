import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons'
import { Button, Result, Space, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import CommissionSheet from '../components/CommissionSheet'
import type { CommissionVoucher } from '../lib/commission'
import { errorText } from '../lib/errors'
import { useT } from '../lib/i18n'
import { useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import { fetchTrail } from '../lib/workbench'
import type { ApprovalLog } from '../lib/workbench'

// 提成单打印页：不带菜单，只有一张单；浏览器“打印”可以直接打或另存为 PDF
// 换一张单（地址里的 id 变了）就整页重来，免得新单还没读完时露出上一张的内容或审批过程
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
  const [err, setErr] = useState<string | null>(null)
  // 签字栏要用审批流里级别的名字，等基础资料读好再出单
  const { loaded } = useRefData()
  const ready = !!v && loaded && trail !== null

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

  // 打印时浏览器用页面标题当文件名
  useEffect(() => {
    if (!v) return
    const old = document.title
    document.title = [v.voucher_no ?? `#${v.id}`, v.customer_name, 'Commission Voucher'].filter(Boolean).join(' ')
    return () => {
      document.title = old
    }
  }, [v])

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <Space wrap>
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
        <CommissionSheet v={v} trail={trail ?? []} />
      ) : (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      )}
    </div>
  )
}
