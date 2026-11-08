import { LockOutlined, MailOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Form, Input, Tabs, Typography } from 'antd'
import { useState } from 'react'
import { errorText } from '../lib/errors'
import { supabase } from '../lib/supabase'

type Values = { email: string; password: string; full_name?: string }

export default function LoginPage() {
  const { message } = App.useApp()
  const [tab, setTab] = useState('login')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const login = async (v: Values) => {
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: v.email.trim(), password: v.password })
    setBusy(false)
    if (error) message.error(errorText(error))
  }

  const signup = async (v: Values) => {
    setBusy(true)
    const { data, error } = await supabase.auth.signUp({
      email: v.email.trim(),
      password: v.password,
      options: { data: { full_name: v.full_name?.trim() || undefined } },
    })
    setBusy(false)
    if (error) {
      message.error(errorText(error))
      return
    }
    if (!data.session) {
      setNotice('注册成功。如果收到确认邮件，请先点邮件里的链接再登录；没收到的话请联系管理员。')
      setTab('login')
    }
  }

  return (
    <div className="login-wrap">
      <Card className="login-card">
        <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 4 }}>
          回款管理
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          到账录入 · 拆分到车 · 报款 · 车辆台账
        </Typography.Paragraph>
        {notice && <Alert type="success" showIcon title={notice} style={{ marginBottom: 12 }} />}
        <Tabs
          activeKey={tab}
          onChange={setTab}
          centered
          items={[
            {
              key: 'login',
              label: '登录',
              children: (
                <Form layout="vertical" onFinish={login} requiredMark={false}>
                  <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email', message: '请填邮箱' }]}>
                    <Input prefix={<MailOutlined />} autoComplete="email" />
                  </Form.Item>
                  <Form.Item name="password" label="密码" rules={[{ required: true, message: '请填密码' }]}>
                    <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={busy}>
                    登录
                  </Button>
                </Form>
              ),
            },
            {
              key: 'signup',
              label: '第一次使用',
              children: (
                <Form layout="vertical" onFinish={signup} requiredMark={false}>
                  <Typography.Paragraph type="secondary">
                    管理员把你的邮箱加进邀请名单后，用这个邮箱在这里设置密码。
                  </Typography.Paragraph>
                  <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email', message: '请填邮箱' }]}>
                    <Input prefix={<MailOutlined />} autoComplete="email" />
                  </Form.Item>
                  <Form.Item name="full_name" label="姓名">
                    <Input />
                  </Form.Item>
                  <Form.Item name="password" label="设置密码" rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}>
                    <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={busy}>
                    注册
                  </Button>
                </Form>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}
