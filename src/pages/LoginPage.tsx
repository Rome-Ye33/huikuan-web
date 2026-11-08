import { LockOutlined, MailOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Form, Input, Tabs, Typography } from 'antd'
import { useState } from 'react'
import LangSwitch from '../components/LangSwitch'
import { accountCall, MIN_PASSWORD } from '../lib/account'
import { errorText } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'

type Values = { email: string; password: string; full_name?: string }

export default function LoginPage() {
  const t = useT()
  const { message } = App.useApp()
  const [tab, setTab] = useState('login')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(false)

  const login = async (v: Values) => {
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: v.email.trim(), password: v.password })
    setBusy(false)
    if (error) message.error(errorText(error))
  }

  // 注册走服务端：只有邀请名单上的邮箱能开通，不发确认邮件，开通后直接登录
  const signup = async (v: Values) => {
    setBusy(true)
    try {
      await accountCall({ action: 'register', email: v.email.trim(), password: v.password, full_name: v.full_name?.trim() || undefined })
    } catch (e) {
      setBusy(false)
      message.error(errorText(e))
      return
    }
    const { error } = await supabase.auth.signInWithPassword({ email: v.email.trim(), password: v.password })
    setBusy(false)
    if (error) {
      setNotice(true)
      setTab('login')
    }
  }

  return (
    <div className="login-wrap">
      <Card className="login-card">
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <LangSwitch />
        </div>
        <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 4, marginTop: 4 }}>
          {t('回款管理')}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          {t('到账录入 · 拆分到车 · 报款 · 车辆台账')}
        </Typography.Paragraph>
        {notice && <Alert type="success" showIcon title={t('账号已开通，请用刚才的邮箱和密码登录。')} style={{ marginBottom: 12 }} />}
        <Tabs
          activeKey={tab}
          onChange={setTab}
          centered
          items={[
            {
              key: 'login',
              label: t('登录'),
              children: (
                <Form name="login" layout="vertical" onFinish={login} requiredMark={false}>
                  <Form.Item name="email" label={t('邮箱')} rules={[{ required: true, type: 'email', message: t('请填邮箱') }]}>
                    <Input prefix={<MailOutlined />} autoComplete="email" />
                  </Form.Item>
                  <Form.Item name="password" label={t('密码')} rules={[{ required: true, message: t('请填密码') }]}>
                    <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={busy}>
                    {t('登录')}
                  </Button>
                </Form>
              ),
            },
            {
              key: 'signup',
              label: t('第一次使用'),
              children: (
                <Form name="signup" layout="vertical" onFinish={signup} requiredMark={false}>
                  <Typography.Paragraph type="secondary">
                    {t('管理员把你的邮箱加进邀请名单后，用这个邮箱在这里设置密码，设好就能直接用。忘记密码请找管理员重设。')}
                  </Typography.Paragraph>
                  <Form.Item name="email" label={t('邮箱')} rules={[{ required: true, type: 'email', message: t('请填邮箱') }]}>
                    <Input prefix={<MailOutlined />} autoComplete="email" />
                  </Form.Item>
                  <Form.Item name="full_name" label={t('姓名')}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="password" label={t('设置密码')} rules={[{ required: true, min: MIN_PASSWORD, message: t('密码至少 {MIN_PASSWORD} 位', { MIN_PASSWORD }) }]}>
                    <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={busy}>
                    {t('注册')}
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
