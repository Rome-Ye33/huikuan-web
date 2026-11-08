import {
  AuditOutlined,
  BankOutlined,
  CarOutlined,
  DatabaseOutlined,
  LogoutOutlined,
  MoneyCollectOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { Button, Layout, Menu, Result, Space, Spin, Tag, Typography } from 'antd'
import { lazy, Suspense, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ROLE_LABEL, useAuth } from './lib/auth'
import LoginPage from './pages/LoginPage'

const ReceiptsPage = lazy(() => import('./pages/ReceiptsPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const VehiclesPage = lazy(() => import('./pages/VehiclesPage'))
const ReconcilePage = lazy(() => import('./pages/ReconcilePage'))
const BaseDataPage = lazy(() => import('./pages/BaseDataPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))

const { Sider, Header, Content } = Layout

function FullSpin() {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spin size="large" />
    </div>
  )
}

export default function App() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)

  if (auth.loading) return <FullSpin />
  if (!auth.session) return <LoginPage />
  if (!auth.role) {
    return (
      <Result
        status="403"
        title="账号还没有开通"
        subTitle={`${auth.session.user.email} 已登录，但还没有分配角色或已停用，请联系管理员。`}
        extra={<Button onClick={auth.signOut}>退出登录</Button>}
      />
    )
  }

  const items = auth.isStaff
    ? [
        { key: '/receipts', icon: <MoneyCollectOutlined />, label: '到账录入' },
        { key: '/reports', icon: <AuditOutlined />, label: '报款' },
        { key: '/vehicles', icon: <CarOutlined />, label: '车辆台账' },
        { key: '/reconcile', icon: <BankOutlined />, label: '银行对账' },
        { key: '/base', icon: <DatabaseOutlined />, label: '基础资料' },
        ...(auth.isAdmin ? [{ key: '/users', icon: <TeamOutlined />, label: '用户与权限' }] : []),
      ]
    : [{ key: '/vehicles', icon: <CarOutlined />, label: '我的车辆' }]

  const home = auth.isStaff ? '/receipts' : '/vehicles'
  const selected = items.find((i) => location.pathname.startsWith(i.key))?.key ?? home

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth={0} collapsed={collapsed} onCollapse={setCollapsed} width={180}>
        <div className="app-logo">回款管理</div>
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
          <Space>
            <Typography.Text>{auth.profile?.full_name || auth.session.user.email}</Typography.Text>
            <Tag color={auth.isAdmin ? 'red' : auth.isStaff ? 'blue' : 'green'}>{ROLE_LABEL[auth.role]}</Tag>
            <Button type="text" icon={<LogoutOutlined />} onClick={auth.signOut}>
              退出
            </Button>
          </Space>
        </Header>
        <Content className="app-content">
          <Suspense fallback={<FullSpin />}>
            <Routes>
              {auth.isStaff && <Route path="/receipts" element={<ReceiptsPage />} />}
              {auth.isStaff && <Route path="/reports" element={<ReportsPage />} />}
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
