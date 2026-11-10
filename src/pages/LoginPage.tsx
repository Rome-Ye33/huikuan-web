import { BankOutlined, CarOutlined, FileDoneOutlined, LockOutlined, MailOutlined, MoneyCollectOutlined } from '@ant-design/icons'
import { Alert, App, Button, Form, Input, Tabs, Typography } from 'antd'
import { useState } from 'react'
import LangSwitch from '../components/LangSwitch'
import Logo from '../components/Logo'
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

  // 宽屏时左边一栏：系统名和几项主要功能
  const features = [
    { icon: <CarOutlined />, title: t('车辆台账'), text: t('每台车的合同价、已到账和余额，一目了然') },
    { icon: <MoneyCollectOutlined />, title: t('到账与报款'), text: t('业务员提交，财务审核，自动生成报款文字') },
    { icon: <FileDoneOutlined />, title: t('提成申请单'), text: t('多级线上审批，不用打印签字') },
    { icon: <BankOutlined />, title: t('银行对账'), text: t('导入银行流水，自动配对到账') },
  ]

  return (
    <div className="login-wrap">
      <aside className="login-brand">
        <Logo size={40} className="logo-lg" />
        <div className="login-brand-body">
          <h1>
            {t('车辆销售、回款和提成')}
            <br />
            {t('一个系统管起来')}
          </h1>
          <ul className="login-features">
            {features.map((f) => (
              <li key={f.title}>
                <span className="login-feature-icon">{f.icon}</span>
                <span>
                  <b>{f.title}</b>
                  <span>{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <main className="login-main">
        <div className="login-lang">
          <LangSwitch />
        </div>
        {/* 窄屏时没有左边一栏，系统名放在登录框上面 */}
        <Logo size={40} className="logo-lg login-top-logo" />
        <div className="login-card">
          <Typography.Title level={3} className="login-title">
            {t('欢迎使用')}
          </Typography.Title>
          <Typography.Paragraph type="secondary">{t('请用管理员邀请的邮箱登录')}</Typography.Paragraph>
          {notice && <Alert type="success" showIcon title={t('账号已开通，请用刚才的邮箱和密码登录。')} style={{ marginBottom: 12 }} />}
          <Tabs
            activeKey={tab}
            onChange={setTab}
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
        </div>
      </main>
    </div>
  )
}
