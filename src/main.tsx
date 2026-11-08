import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import { RefDataProvider } from './lib/refdata'
import './styles.css'

dayjs.locale('zh-cn')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1d4ed8', borderRadius: 6 } }}>
      <AntApp>
        <HashRouter>
          <AuthProvider>
            <RefDataProvider>
              <App />
            </RefDataProvider>
          </AuthProvider>
        </HashRouter>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
)
