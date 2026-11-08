import { PlusOutlined } from '@ant-design/icons'
import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/errors'
import { todayAccra } from '../lib/format'
import { useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import type { Account, Customer, FxRate, Salesperson } from '../lib/supabase'

export default function BaseDataPage() {
  return (
    <div>
      <div className="page-title">
        <h2>基础资料</h2>
      </div>
      <Tabs
        destroyOnHidden
        items={[
          { key: 'fx', label: '汇率', children: <FxRates /> },
          { key: 'customers', label: '客户', children: <Customers /> },
          { key: 'sales', label: '业务员', children: <Salespersons /> },
          { key: 'accounts', label: '收款账户', children: <Accounts /> },
          { key: 'natures', label: '款项性质', children: <Natures /> },
        ]}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
function FxRates() {
  const { isAdmin } = useAuth()
  const { message } = App.useApp()
  const [rows, setRows] = useState<FxRate[]>([])
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm<{ rate_date: dayjs.Dayjs; currency: string; rate: number; source?: string }>()

  const load = useCallback(async () => {
    const { data } = await supabase.from('fx_rates').select('*').order('rate_date', { ascending: false }).limit(300)
    setRows(data ?? [])
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    const v = await form.validateFields()
    const { error } = await supabase
      .from('fx_rates')
      .upsert({ rate_date: v.rate_date.format('YYYY-MM-DD'), currency: v.currency, rate: v.rate, source: v.source?.trim() || null })
    if (error) return message.error(errorText(error))
    message.success('已保存')
    setOpen(false)
    void load()
  }

  const remove = async (r: FxRate) => {
    const { error } = await supabase.from('fx_rates').delete().eq('rate_date', r.rate_date).eq('currency', r.currency)
    if (error) message.error(errorText(error))
    else void load()
  }

  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields()
            form.setFieldsValue({ rate_date: dayjs(todayAccra()), currency: 'GHS' })
            setOpen(true)
          }}
        >
          录汇率
        </Button>
        <span className="hint">录到账时，没有约定汇率就自动取这里当天（或之前最近一天）的汇率。1 美元 = ? 原币。</span>
      </Space>
      <Table
        rowKey={(r) => `${r.rate_date}-${r.currency}`}
        size="small"
        dataSource={rows}
        pagination={{ defaultPageSize: 30 }}
        columns={[
          { title: '日期', dataIndex: 'rate_date', width: 120 },
          { title: '币种', dataIndex: 'currency', width: 80 },
          { title: '汇率', dataIndex: 'rate', width: 120, render: (v) => Number(v) },
          { title: '来源', dataIndex: 'source' },
          {
            title: '',
            width: 120,
            render: (_, r) => (
              <Space>
                <a
                  onClick={() => {
                    form.setFieldsValue({ rate_date: dayjs(r.rate_date), currency: r.currency, rate: Number(r.rate), source: r.source ?? '' })
                    setOpen(true)
                  }}
                >
                  修改
                </a>
                {isAdmin && (
                  <Popconfirm title="删除这条汇率？" onConfirm={() => remove(r)}>
                    <a className="text-danger">删除</a>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal open={open} title="汇率" okText="保存" onOk={save} onCancel={() => setOpen(false)} forceRender>
        <Form form={form} layout="vertical">
          <Form.Item name="rate_date" label="日期" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="currency" label="币种" rules={[{ required: true }]}>
            <Select options={['GHS', 'CNY', 'EUR', 'XOF', 'NGN'].map((c) => ({ value: c, label: c }))} />
          </Form.Item>
          <Form.Item name="rate" label="1 美元 = ? 原币" rules={[{ required: true }]}>
            <InputNumber min={0.000001} precision={4} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="source" label="来源">
            <Input placeholder="如 公司约定汇率、央行牌价" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
function Customers() {
  const { isAdmin } = useAuth()
  const { customers, salespersons, reload } = useRefData()
  const { message } = App.useApp()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<Customer | null | 'new'>(null)
  const [form] = Form.useForm<{ name: string; salesperson_id?: number | null; phone?: string; country?: string; crm_id?: string; note?: string }>()
  const spName = new Map(salespersons.map((s) => [s.id, s.name]))

  const openEdit = (c: Customer | 'new') => {
    form.resetFields()
    if (c !== 'new') form.setFieldsValue({ ...c, phone: c.phone ?? '', country: c.country ?? '', crm_id: c.crm_id ?? '', note: c.note ?? '' })
    else form.setFieldsValue({ country: 'Ghana' })
    setEdit(c)
  }

  const save = async () => {
    const v = await form.validateFields()
    const row = {
      name: v.name.trim(),
      salesperson_id: v.salesperson_id ?? null,
      phone: v.phone?.trim() || null,
      country: v.country?.trim() || null,
      crm_id: v.crm_id?.trim() || null,
      note: v.note?.trim() || null,
    }
    const res = edit === 'new' ? await supabase.from('customers').insert(row) : await supabase.from('customers').update(row).eq('id', (edit as Customer).id)
    if (res.error) return message.error(errorText(res.error))
    message.success('已保存')
    setEdit(null)
    void reload()
  }

  const remove = async (c: Customer) => {
    const { error } = await supabase.from('customers').delete().eq('id', c.id)
    if (error) message.error(errorText(error))
    else void reload()
  }

  const list = customers.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        <Input.Search allowClear placeholder="搜索客户" onSearch={setQ} style={{ width: 240 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit('new')}>
          新增客户
        </Button>
      </Space>
      <Table
        rowKey="id"
        size="small"
        dataSource={list}
        pagination={{ defaultPageSize: 30 }}
        columns={[
          { title: '客户名称', dataIndex: 'name' },
          { title: '业务员', dataIndex: 'salesperson_id', width: 140, render: (v: number | null) => (v ? spName.get(v) : '') },
          { title: '电话', dataIndex: 'phone', width: 140 },
          { title: '国家', dataIndex: 'country', width: 100 },
          {
            title: '',
            width: 120,
            render: (_, c) => (
              <Space>
                <a onClick={() => openEdit(c)}>修改</a>
                {isAdmin && (
                  <Popconfirm title="删除这个客户？有车或到账记录的删不掉" onConfirm={() => remove(c)}>
                    <a className="text-danger">删除</a>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal open={edit !== null} title={edit === 'new' ? '新增客户' : '修改客户'} okText="保存" onOk={save} onCancel={() => setEdit(null)} forceRender>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="客户名称（照报款原样）" rules={[{ required: true, message: '请填名称' }]}>
            <Input placeholder="如 巴嘎（陈强斌担保）" />
          </Form.Item>
          <Form.Item name="salesperson_id" label="业务员">
            <Select allowClear showSearch={{ optionFilterProp: 'label' }} options={salespersons.map((s) => ({ value: s.id, label: s.name }))} />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input />
          </Form.Item>
          <Form.Item name="country" label="国家">
            <Input />
          </Form.Item>
          <Form.Item name="crm_id" label="CRM 编号">
            <Input />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
function Salespersons() {
  const { isAdmin } = useAuth()
  const { salespersons, reload } = useRefData()
  const { message } = App.useApp()
  const [edit, setEdit] = useState<Salesperson | null | 'new'>(null)
  const [form] = Form.useForm<{ name: string; lark_account?: string; wechat?: string; active: boolean }>()

  const save = async () => {
    const v = await form.validateFields()
    const row = { name: v.name.trim(), lark_account: v.lark_account?.trim() || null, wechat: v.wechat?.trim() || null, active: v.active }
    const res = edit === 'new' ? await supabase.from('salespersons').insert(row) : await supabase.from('salespersons').update(row).eq('id', (edit as Salesperson).id)
    if (res.error) return message.error(errorText(res.error))
    message.success('已保存')
    setEdit(null)
    void reload()
  }

  return (
    <div>
      {isAdmin && (
        <Button
          type="primary"
          icon={<PlusOutlined />}
          style={{ marginBottom: 8 }}
          onClick={() => {
            form.resetFields()
            form.setFieldsValue({ active: true })
            setEdit('new')
          }}
        >
          新增业务员
        </Button>
      )}
      <Table
        rowKey="id"
        size="small"
        dataSource={salespersons}
        pagination={false}
        columns={[
          { title: '名字（报款署名）', dataIndex: 'name' },
          { title: '飞书', dataIndex: 'lark_account', width: 160 },
          { title: '微信', dataIndex: 'wechat', width: 160 },
          { title: '状态', dataIndex: 'active', width: 80, render: (v: boolean) => (v ? <Tag color="green">在职</Tag> : <Tag>停用</Tag>) },
          ...(isAdmin
            ? [
                {
                  title: '',
                  width: 80,
                  render: (_: unknown, s: Salesperson) => (
                    <a
                      onClick={() => {
                        form.setFieldsValue({ name: s.name, lark_account: s.lark_account ?? '', wechat: s.wechat ?? '', active: s.active })
                        setEdit(s)
                      }}
                    >
                      修改
                    </a>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Modal open={edit !== null} title="业务员" okText="保存" onOk={save} onCancel={() => setEdit(null)} forceRender>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名字（照报款里的写法，如 boss、Ibrahim kumasi）" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="lark_account" label="飞书账号">
            <Input />
          </Form.Item>
          <Form.Item name="wechat" label="微信">
            <Input />
          </Form.Item>
          <Form.Item name="active" label="在职" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
function Accounts() {
  const { isAdmin } = useAuth()
  const { accounts, reload } = useRefData()
  const { message } = App.useApp()
  const [edit, setEdit] = useState<Account | null | 'new'>(null)
  const [form] = Form.useForm<{
    short_name: string
    list_name?: string
    company?: string
    bank?: string
    currency: string
    last4?: string
    kind: string
    active: boolean
  }>()

  const save = async () => {
    const v = await form.validateFields()
    const row = {
      short_name: v.short_name.trim(),
      list_name: v.list_name?.trim() || null,
      company: v.company?.trim() || null,
      bank: v.bank?.trim() || null,
      currency: v.currency,
      last4: v.last4?.trim() || null,
      kind: v.kind,
      active: v.active,
    }
    const res = edit === 'new' ? await supabase.from('bank_accounts').insert(row) : await supabase.from('bank_accounts').update(row).eq('id', (edit as Account).id)
    if (res.error) return message.error(errorText(res.error))
    message.success('已保存')
    setEdit(null)
    void reload()
  }

  return (
    <div>
      {isAdmin && (
        <Button
          type="primary"
          icon={<PlusOutlined />}
          style={{ marginBottom: 8 }}
          onClick={() => {
            form.resetFields()
            form.setFieldsValue({ currency: 'GHS', kind: 'bank', active: true })
            setEdit('new')
          }}
        >
          新增账户
        </Button>
      )}
      <Table
        rowKey="id"
        size="small"
        dataSource={accounts}
        pagination={false}
        scroll={{ y: 560 }}
        columns={[
          { title: '报款简称', dataIndex: 'short_name' },
          { title: '公司', dataIndex: 'company', width: 120 },
          { title: '银行', dataIndex: 'bank', width: 120 },
          { title: '币种', dataIndex: 'currency', width: 70 },
          { title: '类型', dataIndex: 'kind', width: 70, render: (v: string) => ({ bank: '银行', momo: 'momo', cash: '现金' })[v] ?? v },
          { title: '状态', dataIndex: 'active', width: 70, render: (v: boolean) => (v ? <Tag color="green">在用</Tag> : <Tag>停用</Tag>) },
          ...(isAdmin
            ? [
                {
                  title: '',
                  width: 70,
                  render: (_: unknown, a: Account) => (
                    <a
                      onClick={() => {
                        form.setFieldsValue({
                          short_name: a.short_name,
                          list_name: a.list_name ?? '',
                          company: a.company ?? '',
                          bank: a.bank ?? '',
                          currency: a.currency,
                          last4: a.last4 ?? '',
                          kind: a.kind,
                          active: a.active,
                        })
                        setEdit(a)
                      }}
                    >
                      修改
                    </a>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Modal open={edit !== null} title="收款账户" okText="保存" onOk={save} onCancel={() => setEdit(null)} forceRender>
        <Form form={form} layout="vertical">
          <Form.Item name="short_name" label="报款简称（报款括号里的写法）" rules={[{ required: true }]}>
            <Input placeholder="如 FET AUTO ECO GHS-8651" />
          </Form.Item>
          <Form.Item name="list_name" label="清单写法">
            <Input placeholder="如 ECO-FET AUTO-GHS-8651" />
          </Form.Item>
          <Space>
            <Form.Item name="company" label="公司">
              <Input />
            </Form.Item>
            <Form.Item name="bank" label="银行">
              <Input />
            </Form.Item>
          </Space>
          <Space>
            <Form.Item name="currency" label="币种" rules={[{ required: true }]}>
              <Select style={{ width: 100 }} options={['GHS', 'USD', 'CNY', 'EUR'].map((c) => ({ value: c, label: c }))} />
            </Form.Item>
            <Form.Item name="last4" label="尾号">
              <Input style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="kind" label="类型">
              <Select
                style={{ width: 100 }}
                options={[
                  { value: 'bank', label: '银行' },
                  { value: 'momo', label: 'momo' },
                  { value: 'cash', label: '现金' },
                ]}
              />
            </Form.Item>
            <Form.Item name="active" label="在用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
function Natures() {
  const { natures } = useRefData()
  const KIND: Record<string, string> = {
    payment: '计入车辆已到账',
    opening: '期初余额（不需要流水）',
    discount: '优惠折让（抵减余额，不算到账）',
    refund: '退还客户（不计入车辆）',
    parts: '配件款（不计入车辆台账）',
  }
  return (
    <Table
      rowKey="name"
      size="small"
      dataSource={natures}
      pagination={false}
      columns={[
        { title: '款项性质', dataIndex: 'name', width: 140 },
        { title: '算法', dataIndex: 'kind', render: (v: string) => KIND[v] ?? v },
        { title: '报款加“累计已到账”', dataIndex: 'prepaid_remark', width: 160, render: (v: boolean) => (v ? '是' : '') },
        { title: '结清时加“可过户”', dataIndex: 'settled_remark', width: 150, render: (v: boolean) => (v ? '是' : '') },
      ]}
    />
  )
}
