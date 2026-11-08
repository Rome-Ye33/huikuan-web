import {
  AuditOutlined,
  BankOutlined,
  CarOutlined,
  DatabaseOutlined,
  LogoutOutlined,
  MoneyCollectOutlined,
  SendOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { Badge, Button, Layout, Menu, Result, Space, Spin, Tag, Typography } from 'antd'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import LangSwitch from './components/LangSwitch'
import { ROLE_LABEL, useAuth } from './lib/auth'
import { useI18n } from './lib/i18n'
import { useSubmissionCount } from './lib/submissions'
import LoginPage from './pages/LoginPage'

const ReceiptsPage = lazy(() => import('./pages/ReceiptsPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const VehiclesPage = lazy(() => import('./pages/VehiclesPage'))
const ReconcilePage = lazy(() => import('./pages/ReconcilePage'))
const BaseDataPage = lazy(() => import('./pages/BaseDataPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const SubmitPage = lazy(() => import('./pages/SubmitPage'))

const { Sider, Header, Content } = Layout

function FullSpin() {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spin size="large" />
    </div>
  )
}

/** 菜单文字 + 右边的数字（待审核 / 被退回） */
function withCount(label: string, n: number) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {label}
      {n > 0 && <Badge count={n} size="small" />}
    </span>
  )
}

export default function App() {
  const auth = useAuth()
  const { t, bindUser } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const uid = auth.session?.user.id ?? null
  const isSales = auth.role === 'sales'
  const pending = useSubmissionCount('pending', auth.isStaff)
  const rejected = useSubmissionCount('rejected', isSales)

  // 登录后换成这个人上次选的语言
  useEffect(() => {
    bindUser(uid)
  }, [uid, bindUser])

  if (auth.loading) return <FullSpin />
  if (!auth.session) return <LoginPage />
  if (!auth.role) {
    return (
      <Result
        status="403"
        title={t('账号还没有开通')}
        subTitle={t('{email} 已登录，但还没有分配角色或已停用，请联系管理员。', { email: auth.session.user.email ?? '' })}
        extra={
          <Space>
            <LangSwitch />
            <Button onClick={auth.signOut}>{t('退出登录')}</Button>
          </Space>
        }
      />
    )
  }

  const items = auth.isStaff
    ? [
        { key: '/receipts', icon: <MoneyCollectOutlined />, label: withCount(t('到账录入'), pending) },
        { key: '/reports', icon: <AuditOutlined />, label: t('报款') },
        { key: '/vehicles', icon: <CarOutlined />, label: t('车辆台账') },
        { key: '/reconcile', icon: <BankOutlined />, label: t('银行对账') },
        { key: '/base', icon: <DatabaseOutlined />, label: t('基础资料') },
        ...(auth.isAdmin ? [{ key: '/users', icon: <TeamOutlined />, label: t('用户与权限') }] : []),
      ]
    : [
        { key: '/submit', icon: <SendOutlined />, label: withCount(t('提交到账'), rejected) },
        { key: '/vehicles', icon: <CarOutlined />, label: t('我的车辆') },
      ]

  const home = auth.isStaff ? '/receipts' : '/submit'
  const selected = items.find((i) => location.pathname.startsWith(i.key))?.key ?? home

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth={0} collapsed={collapsed} onCollapse={setCollapsed} width={180}>
        <div className="app-logo">{t('回款管理')}</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected]}
          items={items}
          onClick={(e) => {
            navigate(e.key)
            if (window.innerWidth < 992) setCollapsed(true)
          }}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <span />
          <Space size={8} wrap={false}>
            <LangSwitch />
            <Typography.Text className="header-name" ellipsis>
              {auth.profile?.full_name || auth.session.user.email}
            </Typography.Text>
            <Tag color={auth.isAdmin ? 'red' : auth.isStaff ? 'blue' : 'green'} style={{ marginInlineEnd: 0 }}>
              {t(ROLE_LABEL[auth.role])}
            </Tag>
            <Button type="text" icon={<LogoutOutlined />} onClick={auth.signOut}>
              <span className="header-logout">{t('退出')}</span>
            </Button>
          </Space>
        </Header>
        <Content className="app-content">
          <Suspense fallback={<FullSpin />}>
            <Routes>
              {auth.isStaff && <Route path="/receipts" element={<ReceiptsPage />} />}
              {auth.isStaff && <Route path="/reports" element={<ReportsPage />} />}
              {isSales && <Route path="/submit" element={<SubmitPage />} />}
              <Route path="/vehicles" element={<VehiclesPage />} />
              {auth.isStaff && <Route path="/reconcile" element={<ReconcilePage />} />}
              {auth.isStaff && <Route path="/base" element={<BaseDataPage />} />}
              {auth.isAdmin && <Route path="/users" element={<UsersPage />} />}
              <Route path="*" element={<Navigate to={home} replace />} />
            </Routes>
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  )
}
