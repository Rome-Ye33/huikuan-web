import { KeyOutlined } from '@ant-design/icons'
import { App, Button, Form, Input, Modal } from 'antd'
import { useState } from 'react'
import { MIN_PASSWORD } from '../lib/account'
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/errors'
import { useI18n } from '../lib/i18n'
import { supabase } from '../lib/supabase'

type Values = { current: string; password: string; again: string }

/** 页头的“修改密码”：每个人改自己的。先核对当前密码，免得别人拿着没锁的电脑把密码改掉 */
export default function ChangePassword() {
  const { t } = useI18n()
  const { session } = useAuth()
  const { message } = App.useApp()
  const [form] = Form.useForm<Values>()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const email = session?.user.email ?? ''

  const close = () => {
    setOpen(false)
    form.resetFields()
  }

  const save = async (v: Values) => {
    setBusy(true)
    const check = await supabase.auth.signInWithPassword({ email, password: v.current })
    if (check.error) {
      setBusy(false)
      if (/Invalid login credentials/i.test(check.error.message)) {
        form.setFields([{ name: 'current', errors: [t('当前密码不对')] }])
        return
      }
      return message.error(errorText(check.error))
    }
    const { error } = await supabase.auth.updateUser({ password: v.password })
    setBusy(false)
    if (error) return message.error(errorText(error))
    message.success(t('密码已修改，下次登录请用新密码'))
    close()
  }

  return (
    <>
      <Button type="text" className="header-password" icon={<KeyOutlined />} aria-label={t('修改密码')} onClick={() => setOpen(true)}>
        <span className="header-password-text">{t('修改密码')}</span>
      </Button>
      <Modal
        open={open}
        title={t('修改密码')}
        okText={t('保存新密码')}
        confirmLoading={busy}
        onOk={() => form.submit()}
        onCancel={close}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false} onFinish={save}>
          {/* 给浏览器的密码管理器看的，这样它知道新密码是哪个账号的 */}
          <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
          <Form.Item name="current" label={t('当前密码')} rules={[{ required: true, message: t('请填当前密码') }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="password"
            label={t('新密码')}
            dependencies={['current']}
            rules={[
              { required: true, min: MIN_PASSWORD, message: t('密码至少 {MIN_PASSWORD} 位', { MIN_PASSWORD }) },
              { max: 72, message: t('密码最多 72 位') },
              ({ getFieldValue }) => ({
                validator: (_, x: string) =>
                  x && x === getFieldValue('current') ? Promise.reject(new Error(t('新密码不能和当前密码一样'))) : Promise.resolve(),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="again"
            label={t('再输一次新密码')}
            dependencies={['password']}
            rules={[
              { required: true, message: t('请再输一次新密码') },
              ({ getFieldValue }) => ({
                validator: (_, x: string) =>
                  !x || x === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error(t('两次输入的新密码不一样'))),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          {/* 让输入框里按回车也能保存 */}
          <button type="submit" hidden />
        </Form>
      </Modal>
    </>
  )
}
