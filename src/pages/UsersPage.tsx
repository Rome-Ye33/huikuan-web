import { PlusOutlined } from '@ant-design/icons'
import { Alert, App, Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { accountCall, MIN_PASSWORD, randomPassword } from '../lib/account'
import { ROLE_LABEL, useAuth } from '../lib/auth'
import { errorText } from '../lib/errors'
import { dateTime } from '../lib/format'
import { useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import type { AppRole, Invite, Profile } from '../lib/supabase'

const ROLE_OPTIONS = (['admin', 'finance', 'sales'] as AppRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))
const ROLE_COLOR: Record<AppRole, string> = { admin: 'red', finance: 'blue', sales: 'green' }

export default function UsersPage() {
  const { session } = useAuth()
  const { salespersons } = useRefData()
  const { message, modal } = App.useApp()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [editUser, setEditUser] = useState<Profile | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [pwUser, setPwUser] = useState<Profile | null>(null)
  const [pwBusy, setPwBusy] = useState(false)
  const [pform] = Form.useForm<{ password: string }>()
  const [uform] = Form.useForm<{ full_name?: string; role: AppRole | null; salesperson_id?: number | null; active: boolean }>()
  const [iform] = Form.useForm<{ email: string; role: AppRole; salesperson_id?: number | null; full_name?: string }>()
  const uRole = Form.useWatch('role', uform)
  const iRole = Form.useWatch('role', iform)
  const spName = new Map(salespersons.map((s) => [s.id, s.name]))
  const spOptions = salespersons.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))

  const load = useCallback(async () => {
    const [p, i] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('user_invites').select('*').order('created_at', { ascending: false }),
    ])
    setProfiles(p.data ?? [])
    setInvites(i.data ?? [])
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const registered = new Set(profiles.map((p) => (p.email ?? '').toLowerCase()))

  const saveUser = async () => {
    const v = await uform.validateFields()
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: v.full_name?.trim() || null,
        role: v.role,
        salesperson_id: v.role === 'sales' ? (v.salesperson_id ?? null) : null,
        active: v.active,
      })
      .eq('id', editUser!.id)
    if (error) return message.error(errorText(error))
    message.success('已保存')
    setEditUser(null)
    void load()
  }

  const saveInvite = async () => {
    const v = await iform.validateFields()
    const { error } = await supabase.from('user_invites').insert({
      email: v.email.trim().toLowerCase(),
      role: v.role,
      salesperson_id: v.role === 'sales' ? (v.salesperson_id ?? null) : null,
      full_name: v.full_name?.trim() || null,
    })
    if (error) return message.error(errorText(error))
    message.success('已加入邀请名单，让对方用这个邮箱在登录页“第一次使用”里设置密码')
    setInviteOpen(false)
    void load()
  }

  const savePassword = async () => {
    const v = await pform.validateFields()
    setPwBusy(true)
    try {
      await accountCall({ action: 'set_password', user_id: pwUser!.id, password: v.password })
    } catch (e) {
      setPwBusy(false)
      return message.error((e as Error).message)
    }
    setPwBusy(false)
    modal.success({
      title: '密码已重设',
      content: (
        <div>
          把新密码告诉 {pwUser!.full_name || pwUser!.email}：
          <Typography.Paragraph copyable strong style={{ fontSize: 16, marginTop: 8 }}>
            {v.password}
          </Typography.Paragraph>
        </div>
      ),
    })
    setPwUser(null)
  }

  const removeUser = async (p: Profile) => {
    try {
      await accountCall({ action: 'delete_user', user_id: p.id })
    } catch (e) {
      return message.error((e as Error).message)
    }
    message.success('已删除账号')
    void load()
  }

  const removeInvite = async (email: string) => {
    const { error } = await supabase.from('user_invites').delete().eq('email', email)
    if (error) message.error(errorText(error))
    else void load()
  }

  return (
    <div>
      <div className="page-title">
        <h2>用户与权限</h2>
      </div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title="新同事：先在下面“邀请名单”加上对方的邮箱和角色，再让对方打开系统，在登录页点“第一次使用”设置密码。不在名单上的邮箱注册不了。忘记密码的用“重设密码”；离职的人把“启用”关掉即可。"
      />
      <Typography.Title level={5}>已注册的用户</Typography.Title>
      <Table
        rowKey="id"
        size="small"
        dataSource={profiles}
        pagination={false}
        style={{ marginBottom: 24 }}
        columns={[
          { title: '邮箱', dataIndex: 'email' },
          { title: '姓名', dataIndex: 'full_name', width: 160 },
          { title: '角色', dataIndex: 'role', width: 90, render: (r: AppRole | null) => (r ? <Tag color={ROLE_COLOR[r]}>{ROLE_LABEL[r]}</Tag> : <Tag>未授权</Tag>) },
          { title: '对应业务员', dataIndex: 'salesperson_id', width: 140, render: (v: number | null) => (v ? spName.get(v) : '') },
          { title: '启用', dataIndex: 'active', width: 70, render: (v: boolean) => (v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
          { title: '注册时间', dataIndex: 'created_at', width: 150, render: (v: string) => dateTime(v) },
          {
            title: '',
            width: 200,
            render: (_, p) =>
              p.id === session?.user.id ? (
                <span className="hint">自己</span>
              ) : (
                <Space size="middle">
                  <a
                    onClick={() => {
                      uform.setFieldsValue({ full_name: p.full_name ?? '', role: p.role, salesperson_id: p.salesperson_id, active: p.active })
                      setEditUser(p)
                    }}
                  >
                    修改
                  </a>
                  <a
                    onClick={() => {
                      pform.setFieldsValue({ password: randomPassword() })
                      setPwUser(p)
                    }}
                  >
                    重设密码
                  </a>
                  <Popconfirm
                    title={`删除账号 ${p.email ?? ''}？`}
                    description="只用于注册错的账号。离职的人请关掉“启用”；录过数据的账号也删不了。"
                    okText="删除"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => removeUser(p)}
                  >
                    <a className="text-danger">删除</a>
                  </Popconfirm>
                </Space>
              ),
          },
        ]}
      />
      <Space style={{ marginBottom: 8 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          邀请名单
        </Typography.Title>
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => {
            iform.resetFields()
            iform.setFieldsValue({ role: 'finance' })
            setInviteOpen(true)
          }}
        >
          邀请
        </Button>
      </Space>
      <Table
        rowKey="email"
        size="small"
        dataSource={invites}
        pagination={false}
        columns={[
          { title: '邮箱', dataIndex: 'email' },
          { title: '姓名', dataIndex: 'full_name', width: 160 },
          { title: '角色', dataIndex: 'role', width: 90, render: (r: AppRole) => <Tag color={ROLE_COLOR[r]}>{ROLE_LABEL[r]}</Tag> },
          { title: '对应业务员', dataIndex: 'salesperson_id', width: 140, render: (v: number | null) => (v ? spName.get(v) : '') },
          {
            title: '状态',
            width: 90,
            render: (_, i) => (registered.has(i.email) ? <Tag color="green">已注册</Tag> : <Tag color="orange">等待注册</Tag>),
          },
          {
            title: '',
            width: 70,
            render: (_, i) => (
              <Popconfirm title="从邀请名单删除？已注册的账号不受影响" onConfirm={() => removeInvite(i.email)}>
                <a className="text-danger">删除</a>
              </Popconfirm>
            ),
          },
        ]}
      />

      <Modal open={!!editUser} title={`修改 ${editUser?.email ?? ''}`} okText="保存" onOk={saveUser} onCancel={() => setEditUser(null)} forceRender>
        <Form form={uform} layout="vertical">
          <Form.Item name="full_name" label="姓名">
            <Input />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          {uRole === 'sales' && (
            <Form.Item name="salesperson_id" label="对应业务员（只看得到这个业务员名下的车）" rules={[{ required: true, message: '业务员角色必须选' }]}>
              <Select showSearch={{ optionFilterProp: 'label' }} options={spOptions} />
            </Form.Item>
          )}
          <Form.Item name="active" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={!!pwUser}
        title={`重设密码：${pwUser?.full_name || pwUser?.email || ''}`}
        okText="重设"
        confirmLoading={pwBusy}
        onOk={savePassword}
        onCancel={() => setPwUser(null)}
        forceRender
      >
        <Form form={pform} layout="vertical">
          <Form.Item
            label="新密码（已经随机生成一个，也可以自己改）"
            required
            extra="重设后把新密码告诉对方，对方用它登录。"
          >
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="password" noStyle rules={[{ required: true, min: MIN_PASSWORD, message: `密码至少 ${MIN_PASSWORD} 位` }]}>
                <Input autoComplete="off" />
              </Form.Item>
              <Button onClick={() => pform.setFieldsValue({ password: randomPassword() })}>换一个</Button>
            </Space.Compact>
          </Form.Item>
        </Form>
      </Modal>
      <Modal open={inviteOpen} title="邀请新用户" okText="加入邀请名单" onOk={saveInvite} onCancel={() => setInviteOpen(false)} forceRender>
        <Form form={iform} layout="vertical">
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email', message: '请填正确的邮箱' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="full_name" label="姓名">
            <Input />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          {iRole === 'sales' && (
            <Form.Item name="salesperson_id" label="对应业务员" rules={[{ required: true, message: '业务员角色必须选' }]}>
              <Select showSearch={{ optionFilterProp: 'label' }} options={spOptions} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  )
}
