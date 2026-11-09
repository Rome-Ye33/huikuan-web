import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Input, Select, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'
import CommissionEditor from '../components/CommissionEditor'
import { useAuth } from '../lib/auth'
import { asPost, STAGE_COLOR, STAGE_LABEL, useVoucherTodo, VOUCHER_STAGES, voucherStage, voucherTodoIds } from '../lib/commission'
import type { CommissionVoucher } from '../lib/commission'
import { cleanSearch, money } from '../lib/format'
import { useT } from '../lib/i18n'
import { supabase } from '../lib/supabase'

const usd2 = (v: unknown): string => (v === null || v === undefined ? '' : '$ ' + money(v))

export default function CommissionPage() {
  const t = useT()
  const { role, isStaff, posts } = useAuth()
  const todoCount = useVoucherTodo(!!role)
  // 有审批岗位的人会看到别的业务员的提成单
  const showSp = isStaff || posts.length > 0
  const [rows, setRows] = useState<CommissionVoucher[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [q, setQ] = useState('')
  const [editor, setEditor] = useState<{ open: boolean; id: number | null }>({ open: false, id: null })

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('v_commission_vouchers').select('*').order('created_at', { ascending: false }).limit(2000)
    if (filter === 'todo') query = query.in('id', await voucherTodoIds())
    else if (asPost(filter)) query = query.eq('status', 'submitted').eq('step', filter)
    else if (filter !== 'all') query = query.eq('status', filter)
    const s = cleanSearch(q)
    if (s) query = query.or(`voucher_no.ilike.%${s}%,customer_name.ilike.%${s}%,salesperson_name.ilike.%${s}%,vins.ilike.%${s}%`)
    const { data } = await query
    setRows(data ?? [])
    setLoading(false)
  }, [filter, q])

  useEffect(() => {
    void load()
  }, [load])

  const columns: ColumnsType<CommissionVoucher> = [
    {
      title: t('编号'),
      dataIndex: 'voucher_no',
      width: 140,
      fixed: 'left',
      render: (no: string | null, r) => no ?? <span className="hint">{t('草稿 #{id}', { id: r.id ?? '' })}</span>,
    },
    { title: t('日期'), dataIndex: 'voucher_date', width: 100 },
    { title: t('客户'), dataIndex: 'customer_name', width: 180, ellipsis: true },
    ...(showSp ? [{ title: t('业务员'), dataIndex: 'salesperson_name', width: 110, ellipsis: true }] : []),
    {
      title: t('车辆'),
      width: 200,
      render: (_, r) => (
        <div>
          <div>{t('{n} 台', { n: r.vehicle_count ?? 0 })}</div>
          <div className="hint" style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}>
            {r.vins}
          </div>
        </div>
      ),
    },
    { title: t('销售总金额'), dataIndex: 'total_sales_usd', width: 120, align: 'right', render: (x) => <span className="num">{usd2(x)}</span> },
    { title: t('已付'), dataIndex: 'paid_usd', width: 120, align: 'right', render: (x) => <span className="num">{usd2(x)}</span> },
    {
      title: t('余额'),
      dataIndex: 'balance_usd',
      width: 110,
      align: 'right',
      render: (x) => <span className={`num ${Number(x) > 1 ? 'text-danger' : ''}`}>{usd2(x)}</span>,
    },
    { title: t('提成'), dataIndex: 'commission_usd', width: 100, align: 'right', render: (x) => <span className="num">{usd2(x)}</span> },
    { title: t('本次发放'), dataIndex: 'payout_usd', width: 100, align: 'right', render: (x) => <b className="num">{usd2(x)}</b> },
    {
      title: t('状态'),
      dataIndex: 'status',
      width: 150,
      render: (x: string | null, r) => {
        const s = voucherStage(x, r.step)
        return <Tag color={STAGE_COLOR[s]}>{t(STAGE_LABEL[s])}</Tag>
      },
    },
  ]

  const options = [
    { value: 'todo', label: todoCount ? t('待我处理（{n}）', { n: todoCount }) : t('待我处理') },
    { value: 'all', label: t('全部') },
    ...VOUCHER_STAGES.map((s) => ({ value: s, label: t(STAGE_LABEL[s]) })),
  ]

  return (
    <div>
      <div className="page-title">
        <h2>{t('提成申请单')}</h2>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ open: true, id: null })}>
            {t('新建提成单')}
          </Button>
        </Space>
      </div>
      <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
        {t('业务员按客户开单（选车、勾客户的付款、填提成金额，可以加附件），提交后在线上逐级审批：销售部 → 应收财务 → 财务负责人 → 公司负责人，批准后财务发放。')}
      </Typography.Paragraph>
      <Space wrap className="filters">
        <Select style={{ width: 190 }} value={filter} onChange={setFilter} options={options} />
        <Input.Search allowClear placeholder={t('编号、客户、业务员、大架号')} style={{ width: 260 }} onSearch={setQ} />
      </Space>
      <Table
        rowKey={(r) => r.id as number}
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1300 }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: (n) => t('共 {n} 张', { n }) }}
        rowClassName={() => 'clickable-row'}
        onRow={(r) => ({ onClick: () => setEditor({ open: true, id: r.id }) })}
        locale={{ emptyText: filter === 'todo' ? t('没有待处理的提成单') : t('还没有提成单') }}
      />
      <CommissionEditor
        open={editor.open}
        voucherId={editor.id}
        onClose={(changed) => {
          setEditor({ open: false, id: null })
          if (changed) void load()
        }}
      />
    </div>
  )
}
