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

// 提成单打印页：不带菜单，只有一张单；浏览器“打印”可以直接打或另存为 PDF
export default function CommissionPrintPage() {
  const t = useT()
  const navigate = useNavigate()
  const { id } = useParams()
  const [v, setV] = useState<CommissionVoucher | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // 签字栏要用审批流里级别的名字，等基础资料读好再出单
  const { loaded } = useRefData()
  const ready = !!v && loaded

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
        <CommissionSheet v={v} />
      ) : (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      )}
    </div>
  )
}
