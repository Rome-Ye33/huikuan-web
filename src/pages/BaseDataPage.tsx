import { DeleteOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag } from 'antd'
import type { Key } from 'react'
import dayjs from 'dayjs'
import { useCallback, useEffect, useState } from 'react'
import MasterImport from '../components/MasterImport'
import type { ParseResult } from '../components/MasterImport'
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/errors'
import { todayAccra } from '../lib/format'
import { deleteByIds, findInUse, setActive } from '../lib/masterDelete'
import type { MasterKind } from '../lib/masterDelete'
import { normKey, parseBool } from '../lib/masterImport'
import type { MField, MRow } from '../lib/masterImport'
import { useRefData } from '../lib/refdata'
import { parseAmount, parseDate } from '../lib/statement'
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

const CHUNK = 200
async function insertChunks<T extends object>(table: 'customers' | 'salespersons' | 'bank_accounts', rows: T[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + CHUNK) as never)
    if (error) throw error
  }
}

/** 勾选后的批量操作：先查还被谁用着（删不掉的列出原因），其余删掉；业务员、账户还能批量停用 / 启用（Rome 2026-11-11） */
function useBulk(kind: MasterKind, nameOf: (id: number) => string, after: () => Promise<void>) {
  const t = useT()
  const { message } = App.useApp()
  const [sel, setSel] = useState<number[]>([])
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setBusy(true)
    try {
      const used = await findInUse(kind, sel)
      const ok = sel.filter((id) => !used.has(id))
      const n = ok.length ? await deleteByIds(kind, ok) : 0
      if (used.size) {
        const list = [...used.entries()].slice(0, 10).map(([id, why]) => `${nameOf(id)}（${t(why)}）`).join('、') + (used.size > 10 ? '…' : '')
        message.warning(t('已删除 {n} 条；{m} 条没删：{list}', { n, m: used.size, list }), 8)
      } else {
        message.success(t('已删除 {n} 条', { n }))
      }
    } catch (e) {
      message.error(errorText(e))
    } finally {
      setBusy(false)
      setSel([])
      await after()
    }
  }

  const activate = async (active: boolean) => {
    if (kind === 'customers') return
    setBusy(true)
    try {
      const n = await setActive(kind, sel, active)
      message.success(active ? t('已启用 {n} 条', { n }) : t('已停用 {n} 条', { n }))
    } catch (e) {
      message.error(errorText(e))
    } finally {
      setBusy(false)
      setSel([])
      await after()
    }
  }

  const rowSelection = {
    selectedRowKeys: sel,
    onChange: (keys: Key[]) => setSel(keys as number[]),
    selections: [Table.SELECTION_ALL, Table.SELECTION_NONE],
    columnWidth: 40,
  }
  return { sel, busy, remove, activate, rowSelection }
}

function BulkBar({ count, busy, onDelete, onActive }: { count: number; busy: boolean; onDelete: () => void; onActive?: (active: boolean) => void }) {
  const t = useT()
  if (!count) return null
  return (
    <>
      <Popconfirm title={t('删除选中的 {n} 条？还被车辆、到账等记录用着的不会删。', { n: count })} okButtonProps={{ danger: true }} onConfirm={onDelete}>
        <Button danger icon={<DeleteOutlined />} loading={busy}>
          {t('删除选中 {n} 条', { n: count })}
        </Button>
      </Popconfirm>
      {onActive && (
        <Button disabled={busy} onClick={() => onActive(false)}>
          {t('停用选中')}
        </Button>
      )}
      {onActive && (
        <Button disabled={busy} onClick={() => onActive(true)}>
          {t('启用选中')}
        </Button>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
type FxIn = { rate_date: string; currency: string; rate: number; source: string | null }
const FX_FIELDS: MField[] = [
  { key: 'rate_date', label: '日期', required: true, alias: /date/ },
  { key: 'currency', label: '币种', alias: /curr/ },
  { key: 'rate', label: '汇率', required: true, alias: /rate/ },
  { key: 'source', label: '来源', alias: /source/ },
]

function FxRates() {
  const t = useT()
  const { isAdmin } = useAuth()
  const { message } = App.useApp()
  const [rows, setRows] = useState<FxRate[]>([])
  const [open, setOpen] = useState(false)
  const [imp, setImp] = useState(false)
  const [sel, setSel] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm<{ rate_date: dayjs.Dayjs; currency: string; rate: number; source?: string }>()

  const load = useCallback(async () => {
    const { data } = await supabase.from('fx_rates').select('*').order('rate_date', { ascending: false }).limit(300)
    setRows(data ?? [])
    setSel([])
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

  // 汇率没有别的记录引用，直接按（日期, 币种）删
  const removeSelected = async () => {
    setBusy(true)
    try {
      let n = 0
      for (let i = 0; i < sel.length; i += 100) {
        const cond = sel
          .slice(i, i + 100)
          .map((k) => {
            const [d, c] = k.split('|')
            return `and(rate_date.eq.${d},currency.eq.${c})`
          })
          .join(',')
        const { data, error } = await supabase.from('fx_rates').delete().or(cond).select('rate_date')
        if (error) throw error
        n += data?.length ?? 0
      }
      message.success(t('已删除 {n} 条', { n }))
    } catch (e) {
      message.error(errorText(e))
    } finally {
      setBusy(false)
      await load()
    }
  }

  const keyOf = (r: { rate_date: string; currency: string }) => `${r.rate_date}|${r.currency}`
  const existing = new Set(rows.map(keyOf))
  const parseFx = (cells: MRow, raw: Record<string, unknown>): ParseResult<FxIn> => {
    const d = parseDate(raw.rate_date, 'YYYY-MM-DD')
    if (!d) return { issue: t('日期认不出') }
    const cur = (cells.currency || 'GHS').toUpperCase()
    if (!/^[A-Z]{3}$/.test(cur) || cur === 'USD') return { issue: t('币种要是 3 个字母，如 GHS（不能是 USD）') }
    const rate = parseAmount(raw.rate)
    if (rate == null || rate <= 0) return { issue: t('汇率要是大于 0 的数字') }
    return { key: `${d}|${cur}`, data: { rate_date: d, currency: cur, rate, source: cells.source || null } }
  }

  return (
    <div>
      <Space wrap style={{ marginBottom: 8 }}>
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
        <Button icon={<UploadOutlined />} onClick={() => setImp(true)}>
          {t('批量导入')}
        </Button>
        {isAdmin && sel.length > 0 && (
          <Popconfirm title={t('删除选中的 {n} 条汇率？', { n: sel.length })} okButtonProps={{ danger: true }} onConfirm={() => void removeSelected()}>
            <Button danger icon={<DeleteOutlined />} loading={busy}>
              {t('删除选中 {n} 条', { n: sel.length })}
            </Button>
          </Popconfirm>
        )}
        <span className="hint">{t('录到账时，没有约定汇率就自动取这里当天（或之前最近一天）的汇率。1 美元 = ? 原币。')}</span>
      </Space>
      <Table
        rowKey={keyOf}
        size="small"
        dataSource={rows}
        pagination={{ defaultPageSize: 30 }}
        rowSelection={isAdmin ? { selectedRowKeys: sel, onChange: (k) => setSel(k as string[]), selections: [Table.SELECTION_ALL, Table.SELECTION_NONE], columnWidth: 40 } : undefined}
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
      <MasterImport<FxIn>
        open={imp}
        title={t('批量导入汇率')}
        fields={FX_FIELDS}
        example={['2026-11-01', 'GHS', '12.5', t('公司约定汇率')]}
        parse={parseFx}
        exists={(k) => existing.has(k)}
        existing="update"
        save={async (list) => {
          for (let i = 0; i < list.length; i += CHUNK) {
            const { error } = await supabase.from('fx_rates').upsert(list.slice(i, i + CHUNK))
            if (error) throw error
          }
        }}
        onClose={(changed) => {
          setImp(false)
          if (changed) void load()
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
type CustomerIn = { name: string; salesperson_id: number | null; phone: string | null; country: string | null; crm_id: string | null; note: string | null }
const CUSTOMER_FIELDS: MField[] = [
  { key: 'name', label: '客户名称', required: true, alias: /^(客户|customer|name)$/ },
  { key: 'salesperson', label: '业务员', alias: /sales/ },
  { key: 'phone', label: '电话', alias: /tel|mobile/ },
  { key: 'country', label: '国家' },
  { key: 'crm_id', label: 'CRM 编号', alias: /crm/ },
  { key: 'note', label: '备注', alias: /remark/ },
]

function Customers() {
  const t = useT()
  const { isAdmin } = useAuth()
  const { customers, salespersons, reload } = useRefData()
  const { message } = App.useApp()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<Customer | null | 'new'>(null)
  const [imp, setImp] = useState(false)
  const [form] = Form.useForm<{ name: string; salesperson_id?: number | null; phone?: string; country?: string; crm_id?: string; note?: string }>()
  const spName = new Map(salespersons.map((s) => [s.id, s.name]))
  const bulk = useBulk('customers', (id) => customers.find((c) => c.id === id)?.name ?? String(id), reload)

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

  const existing = new Set(customers.map((c) => normKey(c.name)))
  const parseCustomer = (c: MRow): ParseResult<CustomerIn> => {
    if (!c.name) return { issue: t('{label}不能为空', { label: t('客户名称') }) }
    let spId: number | null = null
    if (c.salesperson) {
      const sp = salespersons.find((s) => normKey(s.name) === normKey(c.salesperson))
      if (!sp) return { issue: t('业务员系统里没有：{name}', { name: c.salesperson }) }
      spId = sp.id
    }
    return { key: normKey(c.name), data: { name: c.name, salesperson_id: spId, phone: c.phone || null, country: c.country || 'Ghana', crm_id: c.crm_id || null, note: c.note || null } }
  }

  const list = customers.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div>
      <Space wrap style={{ marginBottom: 8 }}>
        <Input.Search allowClear placeholder={t('搜索客户')} onSearch={setQ} style={{ width: 240 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit('new')}>
          {t('新增客户')}
        </Button>
        <Button icon={<UploadOutlined />} onClick={() => setImp(true)}>
          {t('批量导入')}
        </Button>
        {isAdmin && <BulkBar count={bulk.sel.length} busy={bulk.busy} onDelete={() => void bulk.remove()} />}
      </Space>
      <Table
        rowKey="id"
        size="small"
        dataSource={list}
        pagination={{ defaultPageSize: 30 }}
        rowSelection={isAdmin ? bulk.rowSelection : undefined}
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
      <MasterImport<CustomerIn>
        open={imp}
        title={t('批量导入客户')}
        fields={CUSTOMER_FIELDS}
        example={['PEAK STEEL GHANA LTD', 'Ibrahim kumasi', '0244000000', 'Ghana', '', '']}
        parse={parseCustomer}
        exists={(k) => existing.has(k)}
        save={(list) => insertChunks('customers', list)}
        onClose={(changed) => {
          setImp(false)
          if (changed) void reload()
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
type SalespersonIn = { name: string; active: boolean }
const SP_FIELDS: MField[] = [
  { key: 'name', label: '名字', required: true, alias: /^(业务员|salesperson|name)$/ },
  { key: 'active', label: '在职', alias: /active|status|状态/ },
]

function Salespersons() {
  const t = useT()
  const { isAdmin } = useAuth()
  const { salespersons, reload } = useRefData()
  const { message } = App.useApp()
  const [edit, setEdit] = useState<Salesperson | null | 'new'>(null)
  const [imp, setImp] = useState(false)
  const [form] = Form.useForm<{ name: string; active: boolean }>()
  const bulk = useBulk('salespersons', (id) => salespersons.find((s) => s.id === id)?.name ?? String(id), reload)

  const save = async () => {
    const v = await form.validateFields()
    const row = { name: v.name.trim(), active: v.active }
    const res = edit === 'new' ? await supabase.from('salespersons').insert(row) : await supabase.from('salespersons').update(row).eq('id', (edit as Salesperson).id)
    if (res.error) return message.error(errorText(res.error))
    message.success(t('已保存'))
    setEdit(null)
    void reload()
  }

  const existing = new Set(salespersons.map((s) => normKey(s.name)))
  const parseSp = (c: MRow): ParseResult<SalespersonIn> => {
    if (!c.name) return { issue: t('{label}不能为空', { label: t('名字') }) }
    const active = parseBool(c.active ?? '', true)
    if (active == null) return { issue: t('在职只能填 是 或 否') }
    return { key: normKey(c.name), data: { name: c.name, active } }
  }

  return (
    <div>
      {isAdmin && (
        <Space wrap style={{ marginBottom: 8 }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields()
              form.setFieldsValue({ active: true })
              setEdit('new')
            }}
          >
            {t('新增业务员')}
          </Button>
          <Button icon={<UploadOutlined />} onClick={() => setImp(true)}>
            {t('批量导入')}
          </Button>
          <BulkBar count={bulk.sel.length} busy={bulk.busy} onDelete={() => void bulk.remove()} onActive={(a) => void bulk.activate(a)} />
        </Space>
      )}
      <Table
        rowKey="id"
        size="small"
        dataSource={salespersons}
        pagination={false}
        rowSelection={isAdmin ? bulk.rowSelection : undefined}
        columns={[
          { title: t('名字（报款署名）'), dataIndex: 'name' },
          { title: t('状态'), dataIndex: 'active', width: 80, render: (v: boolean) => (v ? <Tag color="green">{t('在职')}</Tag> : <Tag>{t('停用')}</Tag>) },
          ...(isAdmin
            ? [
                {
                  title: '',
                  width: 80,
                  render: (_: unknown, s: Salesperson) => (
                    <a
                      onClick={() => {
                        form.setFieldsValue({ name: s.name, active: s.active })
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
          <Form.Item name="active" label={t('在职')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
      <MasterImport<SalespersonIn>
        open={imp}
        title={t('批量导入业务员')}
        fields={SP_FIELDS}
        example={['Ibrahim kumasi', t('是')]}
        parse={parseSp}
        exists={(k) => existing.has(k)}
        save={(list) => insertChunks('salespersons', list)}
        onClose={(changed) => {
          setImp(false)
          if (changed) void reload()
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
type AccountIn = { short_name: string; list_name: string | null; company: string | null; bank: string | null; currency: string; last4: string | null; kind: string; active: boolean }
const ACCOUNT_FIELDS: MField[] = [
  { key: 'short_name', label: '报款简称', required: true, alias: /^(简称|账户|account|name)$/ },
  { key: 'list_name', label: '清单写法', alias: /list/ },
  { key: 'company', label: '公司' },
  { key: 'bank', label: '银行' },
  { key: 'currency', label: '币种', required: true, alias: /curr/ },
  { key: 'last4', label: '尾号', alias: /last/ },
  { key: 'kind', label: '类型', alias: /kind|type/ },
  { key: 'active', label: '在用', alias: /active|status|状态/ },
]
const KIND_WORDS: Record<string, string> = { bank: 'bank', 银行: 'bank', momo: 'momo', cash: 'cash', 现金: 'cash' }

function Accounts() {
  const t = useT()
  const { isAdmin } = useAuth()
  const { accounts, reload } = useRefData()
  const { message } = App.useApp()
  const [edit, setEdit] = useState<Account | null | 'new'>(null)
  const [imp, setImp] = useState(false)
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
  const bulk = useBulk('bank_accounts', (id) => accounts.find((a) => a.id === id)?.short_name ?? String(id), reload)

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

  const existing = new Set(accounts.map((a) => normKey(a.short_name)))
  const parseAccount = (c: MRow): ParseResult<AccountIn> => {
    if (!c.short_name) return { issue: t('{label}不能为空', { label: t('报款简称') }) }
    const currency = c.currency.toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) return { issue: t('币种要是 3 个字母，如 GHS、USD') }
    const kind = KIND_WORDS[normKey(c.kind || 'bank')]
    if (!kind) return { issue: t('类型只能填 银行、momo、现金') }
    const active = parseBool(c.active ?? '', true)
    if (active == null) return { issue: t('在用只能填 是 或 否') }
    return {
      key: normKey(c.short_name),
      data: { short_name: c.short_name, list_name: c.list_name || null, company: c.company || null, bank: c.bank || null, currency, last4: c.last4 || null, kind, active },
    }
  }

  return (
    <div>
      {isAdmin && (
        <Space wrap style={{ marginBottom: 8 }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields()
              form.setFieldsValue({ currency: 'GHS', kind: 'bank', active: true })
              setEdit('new')
            }}
          >
            {t('新增账户')}
          </Button>
          <Button icon={<UploadOutlined />} onClick={() => setImp(true)}>
            {t('批量导入')}
          </Button>
          <BulkBar count={bulk.sel.length} busy={bulk.busy} onDelete={() => void bulk.remove()} onActive={(a) => void bulk.activate(a)} />
        </Space>
      )}
      <Table
        rowKey="id"
        size="small"
        dataSource={accounts}
        pagination={false}
        scroll={{ y: 560 }}
        rowSelection={isAdmin ? bulk.rowSelection : undefined}
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
      <MasterImport<AccountIn>
        open={imp}
        title={t('批量导入收款账户')}
        fields={ACCOUNT_FIELDS}
        example={['FET AUTO ECO GHS-8651', 'ECO-FET AUTO-GHS-8651', 'FET AUTO', 'ECO', 'GHS', '8651', t('银行'), t('是')]}
        parse={parseAccount}
        exists={(k) => existing.has(k)}
        save={(list) => insertChunks('bank_accounts', list)}
        onClose={(changed) => {
          setImp(false)
          if (changed) void reload()
        }}
      />
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
