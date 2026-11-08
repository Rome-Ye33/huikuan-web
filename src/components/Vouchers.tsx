import { DeleteOutlined, FilePdfOutlined, PaperClipOutlined, UploadOutlined } from '@ant-design/icons'
import { App, Button, Image, Space, Tooltip, Upload } from 'antd'
import { useEffect, useState } from 'react'
import { errorText } from '../lib/errors'
import { useT } from '../lib/i18n'
import { supabase, VOUCHER_BUCKET } from '../lib/supabase'

// 凭证（水单、Credit Alert、截图）：存在私有 bucket。财务和管理员能看全部；业务员只能看自己上传的
// 路径：年/月/随机号-文件名；业务员提交到账时放在 sub/<用户id>/ 下面

function safeName(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, '') : ''
  const base = (dot >= 0 ? name.slice(0, dot) : name).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'file'
  return base + ext
}

export async function uploadVoucher(file: File, prefix?: string): Promise<string> {
  const now = new Date()
  const id = crypto.randomUUID().slice(0, 8)
  const path = `${prefix ? prefix + '/' : ''}${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}-${safeName(file.name || 'paste.png')}`
  const { error } = await supabase.storage.from(VOUCHER_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (error) throw error
  return path
}

function isImage(path: string) {
  return /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(path)
}

type Props = {
  value: string[]
  onChange?: (paths: string[]) => void
  readOnly?: boolean
  /** 上传到哪个文件夹下（业务员：sub/<用户id>） */
  prefix?: string
}

export default function Vouchers({ value, onChange, readOnly, prefix }: Props) {
  const { message } = App.useApp()
  const t = useT()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    const missing = value.filter((p) => !urls[p])
    if (missing.length === 0) return
    let alive = true
    supabase.storage
      .from(VOUCHER_BUCKET)
      .createSignedUrls(missing, 3600)
      .then(({ data }) => {
        if (!alive || !data) return
        setUrls((u) => {
          const next = { ...u }
          for (const d of data) if (d.path && d.signedUrl) next[d.path] = d.signedUrl
          return next
        })
      })
    return () => {
      alive = false
    }
  }, [value, urls])

  const addFiles = async (files: File[]) => {
    if (!onChange || files.length === 0) return
    setUploading(true)
    try {
      const paths: string[] = []
      for (const f of files) paths.push(await uploadVoucher(f, prefix))
      onChange([...value, ...paths])
      message.success(t('已上传 {n} 个凭证', { n: paths.length }))
    } catch (e) {
      message.error(t('上传失败：') + errorText(e))
    } finally {
      setUploading(false)
    }
  }

  // 直接 Ctrl+V 粘贴截图
  useEffect(() => {
    if (readOnly || !onChange) return
    const onPaste = (ev: ClipboardEvent) => {
      const items = ev.clipboardData?.files
      if (!items || items.length === 0) return
      const imgs = Array.from(items).filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf')
      if (imgs.length === 0) return
      ev.preventDefault()
      void addFiles(imgs)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  return (
    <div>
      <Space wrap size={8}>
        <Image.PreviewGroup>
          {value.map((p) => (
            <div key={p} className="voucher-thumb">
              {isImage(p) ? (
                urls[p] ? (
                  <Image src={urls[p]} width={88} height={88} style={{ objectFit: 'cover' }} />
                ) : (
                  <div className="voucher-file">
                    <PaperClipOutlined />
                  </div>
                )
              ) : (
                <a href={urls[p]} target="_blank" rel="noreferrer" className="voucher-file">
                  <FilePdfOutlined style={{ fontSize: 24 }} />
                  <span>{p.split('/').pop()?.slice(9, 25)}</span>
                </a>
              )}
              {!readOnly && onChange && (
                <Tooltip title={t('移除（不会删除已上传的文件）')}>
                  <Button
                    size="small"
                    type="text"
                    danger
                    className="voucher-remove"
                    icon={<DeleteOutlined />}
                    onClick={() => onChange(value.filter((x) => x !== p))}
                  />
                </Tooltip>
              )}
            </div>
          ))}
        </Image.PreviewGroup>
        {!readOnly && onChange && (
          <Upload
            multiple
            accept="image/*,application/pdf"
            showUploadList={false}
            beforeUpload={(file, list) => {
              if (file === list[list.length - 1]) void addFiles(list as File[])
              return false
            }}
          >
            <Button icon={<UploadOutlined />} loading={uploading}>
              {t('上传凭证')}
            </Button>
          </Upload>
        )}
      </Space>
      {!readOnly && onChange && (
        <div className="hint" style={{ marginTop: 4 }}>
          {t('可以直接 Ctrl+V 粘贴截图')}
        </div>
      )}
      {readOnly && value.length === 0 && <span className="hint">{t('没有凭证')}</span>}
    </div>
  )
}
