import { App as AntApp, ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import { LangProvider, useI18n } from './lib/i18n'
import { RefDataProvider } from './lib/refdata'
import './styles.css'

// antd 自带的文字（日期选择、分页、确认框按钮）跟着界面语言走
function Themed({ children }: { children: ReactNode }) {
  const { lang } = useI18n()
  return (
    <ConfigProvider locale={lang === 'en' ? enUS : zhCN} theme={{ token: { colorPrimary: '#1d4ed8', borderRadius: 6 } }}>
      {children}
    </ConfigProvider>
  )
}

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
