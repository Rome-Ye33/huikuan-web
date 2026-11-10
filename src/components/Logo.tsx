import { useId } from 'react'
import { useI18n } from '../lib/i18n'

/** 系统图标：蓝色圆角方块里一条往上走的线。浏览器标签上的 public/favicon.svg 是同一个图 */
export function LogoMark({ size = 32 }: { size?: number }) {
  // 一页上可能有两个图标（登录页），渐变的 id 不能重复
  const id = 'logo-' + useId().replace(/[^\w-]/g, '')
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id})`} />
      <path d="M8 21.5l5-5 4 3.5 7-8M19.5 12H24v4.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 图标 + 系统名。中文界面在名字下面带一行英文；英文界面只有英文 */
export default function Logo({ size = 32, className }: { size?: number; className?: string }) {
  const { t, lang } = useI18n()
  return (
    <div className={className ? `logo ${className}` : 'logo'}>
      <LogoMark size={size} />
      <div className="logo-text">
        <div className="logo-name">{t('销售管理')}</div>
        {lang === 'zh' && <div className="logo-sub">Sales Management</div>}
      </div>
    </div>
  )
}
