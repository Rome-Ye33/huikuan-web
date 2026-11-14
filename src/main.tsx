import { App as AntApp, ConfigProvider } from 'antd'
import type { ThemeConfig } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import { StrictMode, useEffect } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import { LangProvider, useI18n } from './lib/i18n'
import { captureGo } from './lib/notify'
import { RefDataProvider } from './lib/refdata'
import './styles.css'

// 配色：深蓝侧边栏、蓝色主色、浅灰底上放白色页面；styles.css 里是同一套颜色
const THEME: ThemeConfig = {
  token: {
    colorPrimary: '#2563eb',
    colorInfo: '#2563eb',
    colorLink: '#2563eb',
    borderRadius: 8,
    colorBgLayout: '#f3f5f9',
    colorBorderSecondary: '#edf0f5',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', 'Helvetica Neue', Arial, sans-serif",
  },
  components: {
    Layout: { siderBg: '#0c1733', headerBg: '#ffffff', headerHeight: 56, headerPadding: '0 20px', bodyBg: '#f3f5f9' },
    Menu: {
      darkItemBg: 'transparent',
      darkSubMenuItemBg: 'transparent',
      darkItemColor: 'rgba(226, 232, 240, 0.72)',
      darkItemHoverColor: '#ffffff',
      darkItemHoverBg: 'rgba(255, 255, 255, 0.07)',
      darkItemSelectedBg: '#2563eb',
      darkItemSelectedColor: '#ffffff',
      itemHeight: 42,
      itemMarginInline: 8,
      itemPaddingInline: 12,
      itemMarginBlock: 4,
      itemBorderRadius: 8,
      iconSize: 15,
    },
    Table: { headerBg: '#f6f8fb', headerColor: '#475569', headerSplitColor: 'transparent', rowHoverBg: '#f5f9ff', footerBg: '#fafbfc' },
    Card: { headerFontSize: 15 },
  },
}

// antd 自带的文字（日期选择、分页、确认框按钮）跟着界面语言走；浏览器标签上的名字也是
function Themed({ children }: { children: ReactNode }) {
  const { lang } = useI18n()
  useEffect(() => {
    document.title = lang === 'en' ? 'Sales & Finance' : '业财管理 · Sales & Finance'
  }, [lang])
  return (
    <ConfigProvider locale={lang === 'en' ? enUS : zhCN} theme={THEME}>
      {children}
    </ConfigProvider>
  )
}

// 邮件提醒里的“打开处理”带着 ?go=…：先记下来、从地址栏去掉，登录好以后再打开
captureGo()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <Themed>
        <AntApp>
          <HashRouter>
            <AuthProvider>
              <RefDataProvider>
                <App />
              </RefDataProvider>
            </AuthProvider>
          </HashRouter>
        </AntApp>
      </Themed>
    </LangProvider>
  </StrictMode>,
)
