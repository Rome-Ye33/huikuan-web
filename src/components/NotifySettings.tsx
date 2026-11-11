import { MailOutlined } from '@ant-design/icons'
import { App, Button, Form, Modal, Switch, Tag, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/errors'
import { useI18n } from '../lib/i18n'
import { saveMyNotify, sendTestEmail } from '../lib/notify'

type Values = { on: boolean }

/**
 * 页头的“邮件提醒”：有新的待办时发邮件到自己登录用的邮箱（默认开着）。可以关掉、给自己发一封测试邮件。
 * 提醒邮件和网站用同一种语言：网站的语言和存着的不一样时（登录、切换中文 / EN）就记下来，不用另外设。
 */
export default function NotifySettings() {
  const { t, lang } = useI18n()
  const { profile, reloadProfile } = useAuth()
  const { message } = App.useApp()
  const [form] = Form.useForm<Values>()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const on = profile?.notify_email !== false
  const email = profile?.email ?? ''
  const savedLang = profile?.notify_lang

  // 同一种语言只试一次，存不上（比如没网）也不会一直重试
  const tried = useRef<string | null>(null)
  useEffect(() => {
    if (!savedLang || savedLang === lang || tried.current === lang) return
    tried.current = lang
    saveMyNotify(null, lang)
      .then(reloadProfile)
      .catch(() => {})
  }, [savedLang, lang, reloadProfile])

  const show = () => {
    form.setFieldsValue({ on })
    setOpen(true)
  }

  /** 存起来，返回存下的 */
  const persist = async (): Promise<Values> => {
    const v = form.getFieldsValue()
    await saveMyNotify(v.on !== false, lang)
    await reloadProfile()
    return v
  }

  const save = async () => {
    setBusy('save')
    try {
      const v = await persist()
      message.success(v.on !== false ? t('已保存，有新的待办会发邮件提醒你') : t('已保存，不再发邮件提醒'))
      setOpen(false)
    } catch (e) {
      message.error(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setBusy('test')
    try {
      await persist()
      const to = await sendTestEmail()
      message.success(t('测试邮件已发到 {email}，请看看收件箱，没有的话也看看垃圾邮件', { email: to || email }))
    } catch (e) {
      message.error(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Button type="text" className="header-notify" icon={<MailOutlined />} aria-label={t('邮件提醒')} onClick={show}>
        <span className="header-notify-text">{t('邮件提醒')}</span>
      </Button>
      <Modal
        open={open}
        title={t('邮件提醒')}
        onCancel={() => setOpen(false)}
        destroyOnHidden
        footer={
          <div className="notify-footer">
            <Button onClick={test} loading={busy === 'test'} disabled={busy === 'save'}>
              {t('发一封测试邮件')}
            </Button>
            <span className="notify-footer-right">
              <Button onClick={() => setOpen(false)}>{t('取消')}</Button>
              <Button type="primary" onClick={save} loading={busy === 'save'} disabled={busy === 'test'}>
                {t('保存')}
              </Button>
            </span>
          </div>
        }
      >
        <Typography.Paragraph type="secondary">
          {t('有新的待办时（到账要审核、提成单轮到你审批、单据被退回、提成要发放），系统会发一封邮件到你登录用的邮箱，点邮件里的“打开处理”就能直接打开那张单，不用一直开着网站。')}
        </Typography.Paragraph>
        <div style={{ marginBottom: 16 }}>
          {on ? <Tag color="green">{t('已开启：发到 {email}', { email })}</Tag> : <Tag>{t('已关闭')}</Tag>}
        </div>
        <Form form={form} layout="vertical" preserve={false} onFinish={save}>
          <Form.Item
            name="on"
            label={t('有新的待办时发邮件提醒我')}
            valuePropName="checked"
            extra={t('提醒邮件和网站用同一种语言，现在是中文。在页头切换语言，邮件也跟着换。')}
          >
            <Switch />
          </Form.Item>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t('收不到的话看看垃圾邮件，把它标成“不是垃圾邮件”，以后就会进收件箱。')}
        </Typography.Paragraph>
      </Modal>
    </>
  )
}
