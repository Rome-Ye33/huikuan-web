import { Segmented } from 'antd'
import { useI18n } from '../lib/i18n'
import type { Lang } from '../lib/i18n'

/** 中文 / English 切换，记在浏览器里（登录后按人记） */
export default function LangSwitch() {
  const { lang, setLang } = useI18n()
  return (
    <Segmented
      size="small"
      value={lang}
      onChange={(v) => setLang(v as Lang)}
      options={[
        { label: '中文', value: 'zh' },
        { label: 'EN', value: 'en' },
      ]}
    />
  )
}
