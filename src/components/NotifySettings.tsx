import { WhatsAppOutlined } from '@ant-design/icons'
import { App, Button, Form, Input, Modal, Radio, Tag, Typography } from 'antd'
import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/errors'
import { useI18n } from '../lib/i18n'
import type { Lang } from '../lib/i18n'
import { formatPhone, normalizePhone, saveMyNotify, sendTestMessage } from '../lib/notify'

type Values = { whatsapp: string; lang: Lang }

/** 页头的“WhatsApp 提醒”：每个人填自己的 WhatsApp 号码、选提醒用的语言，可以给自己发一条测试消息 */
export default function NotifySettings() {
  const { t, lang } = useI18n()
  const { profile, reloadProfile } = useAuth()
  const { message } = App.useApp()
  const [form] = Form.useForm<Values>()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const saved = profile?.whatsapp ?? null

  const show = () => {
    // 还没填过号码的，提醒语言先按现在的界面语言
    const l: Lang = saved ? (profile?.notify_lang === 'en' ? 'en' : 'zh') : lang
    form.setFieldsValue({ whatsapp: formatPhone(saved), lang: l })
    setOpen(true)
  }

  /** 存起来；返回存下的号码（null = 没填），表单不对返回 false */
  const persist = async (): Promise<string | null | false> => {
    const v = await form.validateFields().catch(() => null)
    if (!v) return false
    const num = normalizePhone(v.whatsapp) ?? null
    await saveMyNotify(num, v.lang)
    await reloadProfile()
    form.setFieldsValue({ whatsapp: formatPhone(num) })
    return num
  }

  const save = async () => {
    setBusy('save')
    try {
      const num = await persist()
      if (num === false) return
      message.success(num ? t('已保存，有新的待办会发 WhatsApp 提醒你') : t('已保存，不再发 WhatsApp 提醒'))
      setOpen(false)
    } catch (e) {
      message.error(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    // 号码空着点测试：只提示，不存（不然等于把提醒关掉了）
    if (normalizePhone(form.getFieldValue('whatsapp')) === null) {
      form.setFields([{ name: 'whatsapp', errors: [t('请先填 WhatsApp 号码')] }])
      return
    }
    setBusy('test')
    try {
      const num = await persist()
      if (num === false) return
      await sendTestMessage()
      message.success(t('测试消息已发出，请看看 WhatsApp 有没有收到'))
    } catch (e) {
      message.error(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Button type="text" className="header-notify" icon={<WhatsAppOutlined />} aria-label={t('WhatsApp 提醒')} onClick={show}>
        <span className="header-notify-text">{t('WhatsApp 提醒')}</span>
      </Button>
      <Modal
        open={open}
        title={t('WhatsApp 提醒')}
        onCancel={() => setOpen(false)}
        destroyOnHidden
        footer={
          <div className="notify-footer">
            <Button onClick={test} loading={busy === 'test'} disabled={busy === 'save'}>
              {t('发一条测试消息')}
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
          {t('有新的待办时（到账要审核、提成单轮到你审批、单据被退回、提成要发放），系统会给你发一条 WhatsApp 消息，点消息里的按钮就能直接打开那张单，不用一直开着网站。')}
        </Typography.Paragraph>
        <div style={{ marginBottom: 16 }}>
          {saved ? (
            <Tag color="green">{t('已开启：发到 {phone}', { phone: formatPhone(saved) })}</Tag>
          ) : (
            <Tag>{t('还没开启')}</Tag>
          )}
        </div>
        <Form form={form} layout="vertical" preserve={false} onFinish={save}>
          <Form.Item
            name="whatsapp"
            label={t('WhatsApp 号码')}
            extra={t('带国家区号，比如加纳 +233 24 123 4567、中国 +86 138 0013 8000。加纳号码也可以直接写 024 123 4567。不填就不发。')}
            rules={[
              {
                validator: (_, v: string) =>
                  normalizePhone(v) === undefined
                    ? Promise.reject(new Error(t('号码不对，请带国家区号，比如 +233 24 123 4567')))
                    : Promise.resolve(),
              },
            ]}
          >
            <Input prefix={<WhatsAppOutlined />} placeholder="+233 24 123 4567" inputMode="tel" autoComplete="tel" allowClear />
          </Form.Item>
          <Form.Item name="lang" label={t('提醒用的语言')}>
            <Radio.Group
              optionType="button"
              options={[
                { value: 'zh', label: '中文' },
                { value: 'en', label: 'English' },
              ]}
            />
          </Form.Item>
          {/* 让输入框里按回车也能保存 */}
          <button type="submit" hidden />
        </Form>
      </Modal>
    </>
  )
}
