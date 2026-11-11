import { ArrowRightOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { accountCall, MIN_PASSWORD, randomPassword } from '../lib/account'
import { ROLE_LABEL, useAuth } from '../lib/auth'
import { asPosts, POST_LABEL, POSTS } from '../lib/commission'
import type { Post } from '../lib/commission'
import { errorText } from '../lib/errors'
import { dateTime } from '../lib/format'
import { useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import type { AppRole, Invite, Profile } from '../lib/supabase'
import { useT } from '../lib/i18n'

const ROLES: AppRole[] = ['admin', 'finance', 'sales']
const ROLE_COLOR: Record<AppRole, string> = { admin: 'red', finance: 'blue', sales: 'green' }

export default function UsersPage() {
  const t = useT()
  const { session, reloadProfile } = useAuth()
  const { salespersons } = useRefData()
  const { message, modal } = App.useApp()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [editUser, setEditUser] = useState<Profile | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [pwUser, setPwUser] = useState<Profile | null>(null)
  const [pwBusy, setPwBusy] = useState(false)
  const [postBusy, setPostBusy] = useState<Post | null>(null)
  const [pform] = Form.useForm<{ password: string }>()
  const [uform] = Form.useForm<{
    full_name?: string
    role: AppRole | null
    salesperson_id?: number | null
    active: boolean
    notify_email: boolean
  }>()
  const [iform] = Form.useForm<{ email: string; role: AppRole; salesperson_id?: number | null; full_name?: string }>()
  const uRole = Form.useWatch('role', uform)
  const iRole = Form.useWatch('role', iform)
  const spName = new Map(salespersons.map((s) => [s.id, s.name]))
  const spOptions = salespersons.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))
  const roleOptions = ROLES.map((r) => ({ value: r, label: t(ROLE_LABEL[r]) }))

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

  // ---------- 提成单审批流：每一级由谁审（审批岗位）。已注册的人记在 profiles，还没注册的记在邀请名单、注册时带过去 ----------
  const waiting = invites.filter((i) => !registered.has(i.email))
  const usable = (p: Profile) => p.active && !!p.role
  const postsOf = (x: { approval_posts: string[] | null }) => x.approval_posts ?? []
  const personName = (p: { full_name: string | null; email: string | null }) => p.full_name || p.email || ''
  /** 这个岗位上现在有谁：p:<用户id> 或 i:<邀请邮箱> */
  const postValue = (post: Post): string[] => [
    ...profiles.filter((p) => postsOf(p).includes(post)).map((p) => 'p:' + p.id),
    ...waiting.filter((i) => postsOf(i).includes(post)).map((i) => 'i:' + i.email),
  ]
  const postOptions = (post: Post) => [
    ...profiles
      .filter((p) => usable(p) || postsOf(p).includes(post))
      .map((p) => ({ value: 'p:' + p.id, label: usable(p) ? personName(p) : t('{name}（已停用）', { name: personName(p) }) })),
    ...waiting.map((i) => ({ value: 'i:' + i.email, label: t('{name}（等待注册）', { name: personName(i) }) })),
  ]
  /** 在岗的人（启用、有角色、已注册）；一个都没有时由管理员代办 */
  const holders = (post: Post) => profiles.filter((p) => usable(p) && postsOf(p).includes(post))

  const setPost = async (post: Post, next: string[]) => {
    const cur = postValue(post)
    const changed = [...next.filter((k) => !cur.includes(k)), ...cur.filter((k) => !next.includes(k))]
    if (!changed.length) return
    setPostBusy(post)
    let failed: string | null = null
    for (const key of changed) {
      const on = next.includes(key)
      const withPost = (list: string[]) => asPosts(on ? [...list, post] : list.filter((x) => x !== post))
      if (key.startsWith('p:')) {
        const p = profiles.find((x) => 'p:' + x.id === key)
        if (!p) continue
        const { error } = await supabase.from('profiles').update({ approval_posts: withPost(postsOf(p)) }).eq('id', p.id)
        if (error) failed = errorText(error)
      } else {
        const i = invites.find((x) => 'i:' + x.email === key)
        if (!i) continue
        const { error } = await supabase.from('user_invites').update({ approval_posts: withPost(postsOf(i)) }).eq('email', i.email)
        if (error) failed = errorText(error)
      }
    }
    setPostBusy(null)
    if (failed) message.error(failed)
    else message.success(t('已保存'))
    await load()
    if (changed.includes('p:' + (session?.user.id ?? ''))) await reloadProfile()
  }
  const postTags = (list: string[]) => asPosts(list).map((p) => <Tag key={p}>{t(POST_LABEL[p])}</Tag>)

  const saveUser = async () => {
    // 填得不对时表单自己会标红，这里不用再报错
    const v = await uform.validateFields().catch(() => null)
    if (!v) return
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: v.full_name?.trim() || null,
        role: v.role,
        salesperson_id: v.role === 'sales' ? (v.salesperson_id ?? null) : null,
        active: v.active,
        notify_email: v.notify_email !== false,
      })
      .eq('id', editUser!.id)
    if (error) return message.error(errorText(error))
    message.success(t('已保存'))
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
    message.success(t('已加入邀请名单，让对方用这个邮箱在登录页“第一次使用”里设置密码'))
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
      return message.error(errorText(e))
    }
    setPwBusy(false)
    modal.success({
      title: t('密码已重设'),
      content: (
        <div>
          {t('把新密码告诉 {name}：', { name: pwUser!.full_name || pwUser!.email })}
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
      return message.error(errorText(e))
    }
    message.success(t('已删除账号'))
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
        <h2>{t('用户与权限')}</h2>
      </div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title={t('新同事：先在下面“邀请名单”加上对方的邮箱和角色，再让对方打开系统，在登录页点“第一次使用”设置密码。不在名单上的邮箱注册不了。忘记密码的用“重设密码”；离职的人把“启用”关掉即可。')}
      />
      <Card
        size="small"
        className="flow-card"
        title={t('提成单审批流')}
        style={{ marginBottom: 20 }}
      >
        <div className="flow-row">
          <div className="flow-end">{t('业务员开单提交')}</div>
          {POSTS.map((post, n) => {
            const on = holders(post)
            const pending = waiting.some((i) => postsOf(i).includes(post))
            return (
              <div key={post} className="flow-step" data-post={post}>
                <ArrowRightOutlined className="flow-arrow" />
                <div className="flow-box">
                  <div className="flow-name">
                    {n + 1}. {t(POST_LABEL[post])}
                  </div>
                  <Select
                    mode="multiple"
                    style={{ width: '100%' }}
                    placeholder={t('选审核人')}
                    loading={postBusy === post}
                    disabled={postBusy !== null}
                    showSearch={{ optionFilterProp: 'label' }}
                    value={postValue(post)}
                    options={postOptions(post)}
                    onChange={(v: string[]) => void setPost(post, v)}
                  />
                  {on.length === 0 && (
                    <div className="hint text-warn" style={{ marginTop: 2 }}>
                      {pending ? t('等对方注册；在这之前由管理员代办') : t('还没指定人，暂由管理员代办')}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          <div className="flow-step flow-last">
            <ArrowRightOutlined className="flow-arrow" />
            <div className="flow-end">{t('财务发放')}</div>
          </div>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          {t('提成单在线上按这个顺序一级一级审，不用打印签字。一个岗位可以有几个人（谁先审都行），一个人也可以兼几个岗位。岗位和角色是分开的：角色决定能看到、能录什么，岗位决定提成单轮到谁审。管理员任何一级都可以代办。')}
        </div>
      </Card>
      <Typography.Title level={5}>{t('已注册的用户')}</Typography.Title>
      <Table
        rowKey="id"
        size="small"
        dataSource={profiles}
        pagination={false}
        style={{ marginBottom: 24 }}
        columns={[
          { title: t('邮箱'), dataIndex: 'email' },
          { title: t('姓名'), dataIndex: 'full_name', width: 160 },
          { title: t('角色'), dataIndex: 'role', width: 90, render: (r: AppRole | null) => (r ? <Tag color={ROLE_COLOR[r]}>{t(ROLE_LABEL[r])}</Tag> : <Tag>{t('未授权')}</Tag>) },
          { title: t('对应业务员'), dataIndex: 'salesperson_id', width: 140, render: (v: number | null) => (v ? spName.get(v) : '') },
          { title: t('审批岗位'), dataIndex: 'approval_posts', width: 200, render: (v: string[] | null) => postTags(v ?? []) },
          {
            title: t('邮件提醒'),
            dataIndex: 'notify_email',
            width: 120,
            render: (v: boolean | null, p) =>
              v !== false ? (
                <span>
                  <Tag color="green">{t('开')}</Tag>
                  <span className="hint">{p.notify_lang === 'en' ? 'English' : '中文'}</span>
                </span>
              ) : (
                <Tag>{t('关')}</Tag>
              ),
          },
          { title: t('启用'), dataIndex: 'active', width: 70, render: (v: boolean) => (v ? <Tag color="green">{t('启用')}</Tag> : <Tag>{t('停用')}</Tag>) },
          { title: t('注册时间'), dataIndex: 'created_at', width: 150, render: (v: string) => dateTime(v) },
          {
            title: '',
            width: 200,
            render: (_, p) =>
              p.id === session?.user.id ? (
                <span className="hint">{t('自己')}</span>
              ) : (
                <Space size="middle">
                  <a
                    onClick={() => {
                      uform.setFieldsValue({
                        full_name: p.full_name ?? '',
                        role: p.role,
                        salesperson_id: p.salesperson_id,
                        active: p.active,
                        notify_email: p.notify_email !== false,
                      })
                      setEditUser(p)
                    }}
                  >
                    {t('修改')}
                  </a>
                  <a
                    onClick={() => {
                      pform.setFieldsValue({ password: randomPassword() })
                      setPwUser(p)
                    }}
                  >
                    {t('重设密码')}
                  </a>
                  <Popconfirm
                    title={t('删除账号 {email}？', { email: p.email ?? '' })}
                    description={t('只用于注册错的账号。离职的人请关掉“启用”；录过数据的账号也删不了。')}
                    okText={t('删除')}
                    okButtonProps={{ danger: true }}
                    onConfirm={() => removeUser(p)}
                  >
                    <a className="text-danger">{t('删除')}</a>
                  </Popconfirm>
                </Space>
              ),
          },
        ]}
      />
      <Space wrap style={{ marginBottom: 8 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {t('邀请名单')}
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
          {t('邀请')}
        </Button>
      </Space>
      <Table
        rowKey="email"
        size="small"
        dataSource={invites}
        pagination={false}
        columns={[
          { title: t('邮箱'), dataIndex: 'email' },
          { title: t('姓名'), dataIndex: 'full_name', width: 160 },
          { title: t('角色'), dataIndex: 'role', width: 90, render: (r: AppRole) => <Tag color={ROLE_COLOR[r]}>{t(ROLE_LABEL[r])}</Tag> },
          { title: t('对应业务员'), dataIndex: 'salesperson_id', width: 140, render: (v: number | null) => (v ? spName.get(v) : '') },
          { title: t('审批岗位'), dataIndex: 'approval_posts', width: 200, render: (v: string[] | null) => postTags(v ?? []) },
          {
            title: t('状态'),
            width: 90,
            render: (_, i) => (registered.has(i.email) ? <Tag color="green">{t('已注册')}</Tag> : <Tag color="orange">{t('等待注册')}</Tag>),
          },
          {
            title: '',
            width: 70,
            render: (_, i) => (
              <Popconfirm title={t('从邀请名单删除？已注册的账号不受影响')} onConfirm={() => removeInvite(i.email)}>
                <a className="text-danger">{t('删除')}</a>
              </Popconfirm>
            ),
          },
        ]}
      />

      <Modal open={!!editUser} title={t('修改 {email}', { email: editUser?.email ?? '' })} okText={t('保存')} onOk={saveUser} onCancel={() => setEditUser(null)} forceRender>
        <Form form={uform} layout="vertical">
          <Form.Item name="full_name" label={t('姓名')}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label={t('角色')} rules={[{ required: true }]}>
            <Select options={roleOptions} />
          </Form.Item>
          {uRole === 'sales' && (
            <Form.Item name="salesperson_id" label={t('对应业务员（只看得到这个业务员名下的车）')} rules={[{ required: true, message: t('业务员角色必须选') }]}>
              <Select showSearch={{ optionFilterProp: 'label' }} options={spOptions} />
            </Form.Item>
          )}
          <Form.Item name="active" label={t('启用')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            name="notify_email"
            label={t('邮件提醒（有新的待办时发到他的登录邮箱）')}
            extra={t('工作日上午 10 点、下午 4 点（加纳时间）汇总发。本人也可以在页头“邮件提醒”里自己改。提醒邮件的语言跟着他在网站上用的语言。')}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={!!pwUser}
        title={t('重设密码：{name}', { name: pwUser?.full_name || pwUser?.email || '' })}
        okText={t('重设')}
        confirmLoading={pwBusy}
        onOk={savePassword}
        onCancel={() => setPwUser(null)}
        forceRender
      >
        <Form form={pform} layout="vertical">
          <Form.Item
            label={t('新密码（已经随机生成一个，也可以自己改）')}
            required
            extra={t('重设后把新密码告诉对方，对方用它登录。')}
          >
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="password" noStyle rules={[{ required: true, min: MIN_PASSWORD, message: t('密码至少 {MIN_PASSWORD} 位', { MIN_PASSWORD }) }]}>
                <Input autoComplete="off" />
              </Form.Item>
              <Button onClick={() => pform.setFieldsValue({ password: randomPassword() })}>{t('换一个')}</Button>
            </Space.Compact>
          </Form.Item>
        </Form>
      </Modal>
      <Modal open={inviteOpen} title={t('邀请新用户')} okText={t('加入邀请名单')} onOk={saveInvite} onCancel={() => setInviteOpen(false)} forceRender>
        <Form form={iform} layout="vertical">
          <Form.Item name="email" label={t('邮箱')} rules={[{ required: true, type: 'email', message: t('请填正确的邮箱') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="full_name" label={t('姓名')}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label={t('角色')} rules={[{ required: true }]}>
            <Select options={roleOptions} />
          </Form.Item>
          {iRole === 'sales' && (
            <Form.Item name="salesperson_id" label={t('对应业务员')} rules={[{ required: true, message: t('业务员角色必须选') }]}>
              <Select showSearch={{ optionFilterProp: 'label' }} options={spOptions} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  )
}
