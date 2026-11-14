import { useI18n } from '../lib/i18n'
import mark from '../assets/fet-mark.jpg'

/** 系统图标：FET AUTO 的圆环标志（Rome 2026-11-11 给的公司 logo），放在白色圆角方块里。浏览器标签上的 public/favicon.png 是同一个图 */
export function LogoMark({ size = 32 }: { size?: number }) {
  return <img className="logo-mark" src={mark} width={size} height={size} alt="" aria-hidden="true" />
}

/** 图标 + 系统名。中文界面在名字下面带一行英文；英文界面只有英文 */
export default function Logo({ size = 32, className }: { size?: number; className?: string }) {
  const { t, lang } = useI18n()
  return (
    <div className={className ? `logo ${className}` : 'logo'}>
      <LogoMark size={size} />
      <div className="logo-text">
        <div className="logo-name">{t('业财管理')}</div>
        {lang === 'zh' && <div className="logo-sub">{'Sales & Finance'}</div>}
      </div>
    </div>
  )
}
