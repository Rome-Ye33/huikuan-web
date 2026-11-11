import { ThunderboltOutlined, UploadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Input, Space, Tag, Upload } from 'antd'
import { useEffect, useState } from 'react'
import { aiConfigured, aiReadable, aiSession, MAX_AI_FILES, prepareFiles, recognize, resolveAi } from '../lib/aiFill'
import type { AiFilled, AiReceipt, AiSession } from '../lib/aiFill'
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/errors'
import { money } from '../lib/format'
import { useT } from '../lib/i18n'
import { useRefData } from '../lib/refdata'
import { uploadVoucher } from './Vouchers'

// 智能填表：新建到账时，把业务员在群里发的回款消息、银行的 Credit Alert 贴进来，
// 连同已经传好的水单截图一起交给 Claude 识别，认出来的内容直接填到下面的表里，财务核对后保存。
// 一次认出好几笔（比如一笔现金一笔 momo）时，一张表录一笔，剩下的下次新建到账接着填。

type Props = {
  /** 表里已经有的凭证（图片、PDF 会一起识别） */
  attachments: string[]
  /** 在这里传的水单截图，也挂到这笔到账的凭证上 */
  onAttach: (paths: string[]) => void
  /** 把第 index 笔填进表里；返回 false = 用户没同意盖掉已经填的内容 */
  onFill: (filled: AiFilled, index: number, attachments: string[]) => Promise<boolean>
  /** 从银行对账单生成的到账：金额按银行流水，这里只用来提示对不上 */
  lockedAmount?: number | null
}

// 开通了就不用每次打开都问一遍；没开通的每次都再问（管理员加好密钥后不用刷新页面）
let knownConfigured = false

export default function AiFill({ attachments, onAttach, onFill, lockedAmount }: Props) {
  const t = useT()
  const { message } = App.useApp()
  const { profile, isAdmin } = useAuth()
  const { accountById, customers, salespersons } = useRefData()
  const uid = profile?.id

  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(knownConfigured ? true : null)
  const [sess, setSess] = useState<AiSession | null>(() => aiSession.get(uid))
  /** 现在表里填的是第几笔 */
  const [filled, setFilled] = useState<number | null>(null)
  const [notes, setNotes] = useState<string[]>([])

  useEffect(() => {
    if (knownConfigured) return
    let alive = true
    aiConfigured()
      .then((ok) => {
        knownConfigured = ok
        if (alive) setConfigured(ok)
      })
      .catch(() => {
        // 问不到就当不知道，点识别时再报错
      })
    return () => {
      alive = false
    }
  }, [])

  const readable = attachments.filter(aiReadable).length

  const fill = async (s: AiSession, i: number): Promise<boolean> => {
    const f = await resolveAi(s.result.receipts[i], { accountById, customers, salespersons })
    const extra: string[] = []
    if (lockedAmount != null && f.header.amount_orig && Math.abs(f.header.amount_orig - lockedAmount) > 0.005)
      extra.push(t('识别到的金额 {a} 和银行流水的 {b} 不一样，表里按银行流水的', { a: money(f.header.amount_orig), b: money(lockedAmount) }))
    if (!(await onFill(f, i, s.attachments))) return false
    setFilled(i)
    setNotes([...extra, ...f.notes])
    return true
  }

  const run = async () => {
    if (!uid) return
    setError(null)
    setBusy(true)
    try {
      const prep = await prepareFiles(attachments)
      const body = text.trim()
      if (!body && prep.files.length === 0) {
        setError(prep.notes[0] ?? t('请贴上回款消息，或者传水单截图'))
        return
      }
      const result = await recognize(body, prep.files)
      const s: AiSession = { uid, at: Date.now(), result, attachments: [...attachments], fileNotes: prep.notes, saved: [] }
      aiSession.set(result.receipts.length ? s : null)
      // 对车、对客户还要查几次库：等填好了再把结果亮出来，免得中间闪一下“还没填”的样子
      let done = false
      try {
        if (result.receipts.length) done = await fill(s, 0)
      } finally {
        if (!done) {
          setFilled(null)
          setNotes([])
        }
        setSess(s)
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const fillOne = async (i: number) => {
    if (!sess) return
    setError(null)
    setBusy(true)
    try {
      await fill(sess, i)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const upload = async (files: File[]) => {
    setUploading(true)
    try {
      const paths: string[] = []
      for (const f of files) paths.push(await uploadVoucher(f))
      onAttach(paths)
      message.success(t('已上传 {n} 个凭证', { n: paths.length }))
    } catch (e) {
      message.error(t('上传失败：') + errorText(e))
    } finally {
      setUploading(false)
    }
  }

  const clear = () => {
    aiSession.set(null)
    setSess(null)
    setFilled(null)
    setNotes([])
  }

  const summary = (r: AiReceipt) =>
    [
      r.date || t('日期没认出'),
      r.amount > 0 ? `${r.currency} ${money(r.amount)}`.trim() : t('金额没认出'),
      accountById.get(r.account_id)?.short_name ?? r.account_text,
      [...new Set(r.lines.map((l) => l.customer).filter(Boolean))].join(t('、')),
    ]
      .filter(Boolean)
      .join(' · ')

  const receipts = sess?.result.receipts ?? []
  const left = receipts.filter((_, i) => !sess?.saved.includes(i)).length
  const allNotes = sess ? [...sess.fileNotes, ...notes, ...sess.result.warnings] : []
  const resultTitle = !sess
    ? ''
    : receipts.length === 0
      ? t('没认出到账，请手工录入')
      : filled === null
        ? t('上次识别到 {n} 笔到账，还有 {m} 笔没保存', { n: receipts.length, m: left })
        : receipts.length === 1
          ? t('已按识别结果填好，请逐项核对后再保存')
          : t('识别到 {n} 笔到账，一张表录一笔：这一笔保存后，再点“新建到账”接着录下一笔', { n: receipts.length })

  return (
    <Card
      size="small"
      className="ai-fill"
      style={{ marginBottom: 12 }}
      title={
        <Space size={6}>
          <ThunderboltOutlined />
          {t('智能填表')}
        </Space>
      }
    >
      {configured === false && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 8 }}
          title={t('智能填表还没开通')}
          description={
            isAdmin
              ? t('到 Supabase 后台的 Edge Functions → Secrets，加一条 ANTHROPIC_API_KEY（Claude 的 API 密钥），加好就能用。')
              : t('请管理员开通后再用，现在先手工录入。')
          }
        />
      )}
      <div className="hint" style={{ marginBottom: 6 }}>
        {t('把业务员在群里发的回款消息、银行的 Credit Alert 贴在下面，水单截图传上来，点“识别并填表”，下面的表会自动填好。')}
      </div>
      <Input.TextArea
        className="ai-fill-text"
        value={text}
        maxLength={20000}
        autoSize={{ minRows: 3, maxRows: 10 }}
        disabled={busy}
        placeholder={t('例如：WELL MOTORS 付了一台比亚迪秦预付款全款，汇率：12，业务：BOSS，编号：LC0C76C48S4120785')}
        onChange={(e) => setText(e.target.value)}
      />
      <Space wrap style={{ marginTop: 8 }}>
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          loading={busy}
          disabled={configured === false || (!text.trim() && readable === 0)}
          onClick={run}
        >
          {t('识别并填表')}
        </Button>
        <Upload
          multiple
          accept="image/*,application/pdf"
          showUploadList={false}
          beforeUpload={(file, list) => {
            if (file === list[list.length - 1]) void upload(list as File[])
            return false
          }}
        >
          <Button icon={<UploadOutlined />} loading={uploading} disabled={busy}>
            {t('上传水单截图')}
          </Button>
        </Upload>
        <span className="hint ai-fill-files">
          {busy
            ? t('正在识别，一般要十几秒到一分钟…')
            : readable > 0
              ? t('会连同“凭证”里的 {n} 个图片、PDF 一起识别', { n: Math.min(readable, MAX_AI_FILES) })
              : t('截图也可以直接 Ctrl+V 粘贴')}
        </span>
      </Space>
      {error && <Alert type="error" showIcon closable style={{ marginTop: 8 }} title={error} onClose={() => setError(null)} />}
      {sess && (
        <Alert
          className="ai-fill-result"
          type={receipts.length === 0 ? 'warning' : filled === null ? 'info' : allNotes.length ? 'warning' : 'success'}
          showIcon
          style={{ marginTop: 8 }}
          title={resultTitle}
          description={
            <div>
              {(receipts.length > 1 || filled === null) && receipts.length > 0 && (
                <div className="ai-fill-list">
                  {receipts.map((r, i) => (
                    <div key={i} className="ai-fill-item">
                      <span>
                        {i + 1}. {summary(r)}
                      </span>
                      {sess.saved.includes(i) ? (
                        <Tag color="green">{t('已保存')}</Tag>
                      ) : filled === i ? (
                        <Tag color="blue">{t('已填在下面')}</Tag>
                      ) : (
                        <Button size="small" disabled={busy} onClick={() => void fillOne(i)}>
                          {t('填这一笔')}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {allNotes.length > 0 && (
                <ul className="ai-fill-notes">
                  {allNotes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
              <Space wrap size={4}>
                {receipts.length > 0 && <span className="hint">{t('识别可能有错：金额、账户、大架号请对着凭证核对后再保存。')}</span>}
                <Button size="small" type="link" disabled={busy} onClick={clear}>
                  {t('清掉识别结果')}
                </Button>
              </Space>
            </div>
          }
        />
      )}
    </Card>
  )
}
