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
import { useT } from '../lib/i18n'

export default function BaseDataPage() {
  const t = useT()
  return (
    <div>
      <div className="page-title">
        <h2>{t('基础资料')}</h2>
      </div>
      <Tabs
        destroyOnHidden
        items={[
          { key: 'fx', label: t('汇率'), children: <FxRates /> },
          { key: 'customers', label: t('客户'), children: <Customers /> },
          { key: 'sales', label: t('业务员'), children: <Salespersons /> },
          { key: 'accounts', label: t('收款账户'), children: <Accounts /> },
          { key: 'natures', label: t('款项性质'), children: <Natures /> },
        ]}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
function FxRates() {
  const t = useT()
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
    message.success(t('已保存'))
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
          {t('录汇率')}
        </Button>
        <span className="hint">{t('录到账时，没有约定汇率就自动取这里当天（或之前最近一天）的汇率。1 美元 = ? 原币。')}</span>
      </Space>
      <Table
        rowKey={(r) => `${r.rate_date}-${r.currency}`}
        size="small"
        dataSource={rows}
        pagination={{ defaultPageSize: 30 }}
        columns={[
          { title: t('日期'), dataIndex: 'rate_date', width: 120 },
          { title: t('币种'), dataIndex: 'currency', width: 80 },
          { title: t('汇率'), dataIndex: 'rate', width: 120, render: (v) => Number(v) },
          { title: t('来源'), dataIndex: 'source' },
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
                  {t('修改')}
                </a>
                {isAdmin && (
                  <Popconfirm title={t('删除这条汇率？')} onConfirm={() => remove(r)}>
                    <a className="text-danger">{t('删除')}</a>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal open={open} title={t('汇率')} okText={t('保存')} onOk={save} onCancel={() => setOpen(false)} forceRender>
        <Form form={form} layout="vertical">
          <Form.Item name="rate_date" label={t('日期')} rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="currency" label={t('币种')} rules={[{ required: true }]}>
            <Select options={['GHS', 'CNY', 'EUR', 'XOF', 'NGN'].map((c) => ({ value: c, label: c }))} />
          </Form.Item>
          <Form.Item name="rate" label={t('1 美元 = ? 原币')} rules={[{ required: true }]}>
            <InputNumber min={0.000001} precision={4} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="source" label={t('来源')}>
            <Input placeholder={t('如 公司约定汇率、央行牌价')} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
function Customers() {
  const t = useT()
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
    message.success(t('已保存'))
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
        <Input.Search allowClear placeholder={t('搜索客户')} onSearch={setQ} style={{ width: 240 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit('new')}>
          {t('新增客户')}
        </Button>
      </Space>
      <Table
        rowKey="id"
        size="small"
        dataSource={list}
        pagination={{ defaultPageSize: 30 }}
        columns={[
          { title: t('客户名称'), dataIndex: 'name' },
          { title: t('业务员'), dataIndex: 'salesperson_id', width: 140, render: (v: number | null) => (v ? spName.get(v) : '') },
          { title: t('电话'), dataIndex: 'phone', width: 140 },
          { title: t('国家'), dataIndex: 'country', width: 100 },
          {
            title: '',
            width: 120,
            render: (_, c) => (
              <Space>
                <a onClick={() => openEdit(c)}>{t('修改')}</a>
                {isAdmin && (
                  <Popconfirm title={t('删除这个客户？有车或到账记录的删不掉')} onConfirm={() => remove(c)}>
                    <a className="text-danger">{t('删除')}</a>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal open={edit !== null} title={edit === 'new' ? t('新增客户') : t('修改客户')} okText={t('保存')} onOk={save} onCancel={() => setEdit(null)} forceRender>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t('客户名称（照报款原样）')} rules={[{ required: true, message: t('请填名称') }]}>
            <Input placeholder={t('如 巴嘎（陈强斌担保）')} />
          </Form.Item>
          <Form.Item name="salesperson_id" label={t('业务员')}>
            <Select allowClear showSearch={{ optionFilterProp: 'label' }} options={salespersons.map((s) => ({ value: s.id, label: s.name }))} />
          </Form.Item>
          <Form.Item name="phone" label={t('电话')}>
            <Input />
          </Form.Item>
          <Form.Item name="country" label={t('国家')}>
            <Input />
          </Form.Item>
          <Form.Item name="crm_id" label={t('CRM 编号')}>
            <Input />
          </Form.Item>
          <Form.Item name="note" label={t('备注')}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
function Salespersons() {
  const t = useT()
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
    message.success(t('已保存'))
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
          {t('新增业务员')}
        </Button>
      )}
      <Table
        rowKey="id"
        size="small"
        dataSource={salespersons}
        pagination={false}
        columns={[
          { title: t('名字（报款署名）'), dataIndex: 'name' },
          { title: t('飞书'), dataIndex: 'lark_account', width: 160 },
          { title: t('微信'), dataIndex: 'wechat', width: 160 },
          { title: t('状态'), dataIndex: 'active', width: 80, render: (v: boolean) => (v ? <Tag color="green">{t('在职')}</Tag> : <Tag>{t('停用')}</Tag>) },
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
                      {t('修改')}
                    </a>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Modal open={edit !== null} title={t('业务员')} okText={t('保存')} onOk={save} onCancel={() => setEdit(null)} forceRender>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t('名字（照报款里的写法，如 boss、Ibrahim kumasi）')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="lark_account" label={t('飞书账号')}>
            <Input />
          </Form.Item>
          <Form.Item name="wechat" label={t('微信')}>
            <Input />
          </Form.Item>
          <Form.Item name="active" label={t('在职')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
function Accounts() {
  const t = useT()
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
    message.success(t('已保存'))
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
          {t('新增账户')}
        </Button>
      )}
      <Table
        rowKey="id"
        size="small"
        dataSource={accounts}
        pagination={false}
        scroll={{ y: 560 }}
        columns={[
          { title: t('报款简称'), dataIndex: 'short_name' },
          { title: t('公司'), dataIndex: 'company', width: 120 },
          { title: t('银行'), dataIndex: 'bank', width: 120 },
          { title: t('币种'), dataIndex: 'currency', width: 70 },
          { title: t('类型'), dataIndex: 'kind', width: 70, render: (v: string) => ({ bank: t('银行'), momo: 'momo', cash: t('现金') })[v] ?? v },
          { title: t('状态'), dataIndex: 'active', width: 70, render: (v: boolean) => (v ? <Tag color="green">{t('在用')}</Tag> : <Tag>{t('停用')}</Tag>) },
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
                      {t('修改')}
                    </a>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Modal open={edit !== null} title={t('收款账户')} okText={t('保存')} onOk={save} onCancel={() => setEdit(null)} forceRender>
        <Form form={form} layout="vertical">
          <Form.Item name="short_name" label={t('报款简称（报款括号里的写法）')} rules={[{ required: true }]}>
            <Input placeholder={t('如 FET AUTO ECO GHS-8651')} />
          </Form.Item>
          <Form.Item name="list_name" label={t('清单写法')}>
            <Input placeholder={t('如 ECO-FET AUTO-GHS-8651')} />
          </Form.Item>
          <Space>
            <Form.Item name="company" label={t('公司')}>
              <Input />
            </Form.Item>
            <Form.Item name="bank" label={t('银行')}>
              <Input />
            </Form.Item>
          </Space>
          <Space>
            <Form.Item name="currency" label={t('币种')} rules={[{ required: true }]}>
              <Select style={{ width: 100 }} options={['GHS', 'USD', 'CNY', 'EUR'].map((c) => ({ value: c, label: c }))} />
            </Form.Item>
            <Form.Item name="last4" label={t('尾号')}>
              <Input style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="kind" label={t('类型')}>
              <Select
                style={{ width: 100 }}
                options={[
                  { value: 'bank', label: t('银行') },
                  { value: 'momo', label: 'momo' },
                  { value: 'cash', label: t('现金') },
                ]}
              />
            </Form.Item>
            <Form.Item name="active" label={t('在用')} valuePropName="checked">
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
  const t = useT()
  const { natures } = useRefData()
  const KIND: Record<string, string> = {
    payment: t('计入车辆已到账'),
    opening: t('期初余额（不需要流水）'),
    discount: t('优惠折让（抵减余额，不算到账）'),
    refund: t('退还客户（不计入车辆）'),
    parts: t('配件款（不计入车辆台账）'),
  }
  return (
    <Table
      rowKey="name"
      size="small"
      dataSource={natures}
      pagination={false}
      columns={[
        { title: t('款项性质'), dataIndex: 'name', width: 140, render: (v: string) => t(v) },
        { title: t('算法'), dataIndex: 'kind', render: (v: string) => KIND[v] ?? v },
        { title: t('报款加“累计已到账”'), dataIndex: 'prepaid_remark', width: 160, render: (v: boolean) => (v ? t('是') : '') },
        { title: t('结清时加“可过户”'), dataIndex: 'settled_remark', width: 150, render: (v: boolean) => (v ? t('是') : '') },
      ]}
    />
  )
}
