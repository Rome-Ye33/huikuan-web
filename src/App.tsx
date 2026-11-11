import {
  AppstoreOutlined,
  BankOutlined,
  CarOutlined,
  DatabaseOutlined,
  FileDoneOutlined,
  LogoutOutlined,
  MoneyCollectOutlined,
  SendOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { Avatar, Badge, Button, Layout, Menu, Result, Space, Spin, Tag, Typography } from 'antd'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import ChangePassword from './components/ChangePassword'
import LangSwitch from './components/LangSwitch'
import Logo from './components/Logo'
import NotifySettings from './components/NotifySettings'
import { ROLE_LABEL, useAuth } from './lib/auth'
import { useVoucherTodo } from './lib/commission'
import { useI18n } from './lib/i18n'
import { goPath, takeGo } from './lib/notify'
import { useSubmissionCount } from './lib/submissions'
import { useTodoCount } from './lib/workbench'
import LoginPage from './pages/LoginPage'

const ReceiptsPage = lazy(() => import('./pages/ReceiptsPage'))
const VehiclesPage = lazy(() => import('./pages/VehiclesPage'))
const ReconcilePage = lazy(() => import('./pages/ReconcilePage'))
const BaseDataPage = lazy(() => import('./pages/BaseDataPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const SubmitPage = lazy(() => import('./pages/SubmitPage'))
const CommissionPage = lazy(() => import('./pages/CommissionPage'))
const CommissionPrintPage = lazy(() => import('./pages/CommissionPrintPage'))
const WorkbenchPage = lazy(() => import('./pages/WorkbenchPage'))

const { Sider, Header, Content } = Layout

function FullSpin() {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spin size="large" />
    </div>
  )
}

/** 菜单文字 + 右边的数字（待审核 / 被退回）。地方不够时文字出省略号，数字总是看得见 */
function withCount(label: string, n: number) {
  return (
    <span className="menu-label">
      <span className="menu-label-text">{label}</span>
      {n > 0 && <Badge count={n} size="small" />}
    </span>
  )
}

export default function App() {
  const auth = useAuth()
  const { t, lang, bindUser } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  // 窄屏（手机、平板竖着）时菜单盖在页面上面，点旁边的灰色区域收起
  const [narrow, setNarrow] = useState(false)
  const uid = auth.session?.user.id ?? null
  const isSales = auth.role === 'sales'
  const pending = useSubmissionCount('pending', auth.isStaff)
  const rejected = useSubmissionCount('rejected', isSales)
  // 提成单待我处理：轮到我这个审批岗位的、被退回要改的、财务待发放的（数据库视图按人算好）
  const voucherTodo = useVoucherTodo(!!auth.role)
  // 工作台：到账提交、提成单里等我处理的一共几件
  const todo = useTodoCount(!!auth.role)

  // 登录后换成这个人上次选的语言
  useEffect(() => {
    bindUser(uid)
  }, [uid, bindUser])

  // 邮件提醒里的“打开处理”（?go=…）：登录好以后打开那张单
  const ready = !auth.loading && !!auth.role
  useEffect(() => {
    if (!ready) return
    const go = takeGo()
    if (go) navigate(goPath(go), { replace: true })
  }, [ready, navigate])

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

  const home = '/workbench'

  // 打印页不带菜单
  if (location.pathname.startsWith('/print/')) {
    return (
      <Suspense fallback={<FullSpin />}>
        <Routes>
          <Route path="/print/commission/:id" element={<CommissionPrintPage />} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </Suspense>
    )
  }

  const workbench = { key: '/workbench', icon: <AppstoreOutlined />, label: withCount(t('工作台'), todo) }
  const items = auth.isStaff
    ? [
        workbench,
        { key: '/receipts', icon: <MoneyCollectOutlined />, label: withCount(t('到账录入'), pending) },
        { key: '/vehicles', icon: <CarOutlined />, label: t('车辆台账') },
        { key: '/commission', icon: <FileDoneOutlined />, label: withCount(t('提成申请单'), voucherTodo) },
        { key: '/reconcile', icon: <BankOutlined />, label: t('银行对账') },
        { key: '/base', icon: <DatabaseOutlined />, label: t('基础资料') },
        ...(auth.isAdmin ? [{ key: '/users', icon: <TeamOutlined />, label: t('用户与权限') }] : []),
      ]
    : [
        workbench,
        { key: '/submit', icon: <SendOutlined />, label: withCount(t('提交到账'), rejected) },
        { key: '/vehicles', icon: <CarOutlined />, label: t('我的车辆') },
        { key: '/commission', icon: <FileDoneOutlined />, label: withCount(t('提成申请单'), voucherTodo) },
      ]

  const selected = items.find((i) => location.pathname.startsWith(i.key))?.key ?? home
  const me = auth.profile?.full_name || auth.session.user.email || ''
  const initial = ([...me][0] ?? '').toUpperCase()

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 英文菜单字长一些，侧边栏放宽，“Commission vouchers”带上两位数也放得下 */}
      <Sider
        className="app-sider"
        breakpoint="lg"
        collapsedWidth={0}
        collapsed={collapsed}
        onCollapse={setCollapsed}
        onBreakpoint={setNarrow}
        width={lang === 'en' ? 248 : 216}
      >
        <div className="app-logo">
          <Logo />
        </div>
        <Menu
          theme="dark"
          mode="inline"
          inlineIndent={16}
          selectedKeys={[selected]}
          items={items}
          onClick={(e) => {
            navigate(e.key)
            if (window.innerWidth < 992) setCollapsed(true)
          }}
        />
      </Sider>
      {narrow && !collapsed && <div className="app-sider-mask" onClick={() => setCollapsed(true)} />}
      <Layout>
        <Header className="app-header">
          <span />
          <Space size={8} wrap={false}>
            <LangSwitch />
            <span className="header-user">
              <Avatar size={28} className="header-avatar">
                {initial}
              </Avatar>
              <Typography.Text className="header-name" ellipsis>
                {me}
              </Typography.Text>
            </span>
            <Tag color={auth.isAdmin ? 'red' : auth.isStaff ? 'blue' : 'green'} style={{ marginInlineEnd: 0 }}>
              {t(ROLE_LABEL[auth.role])}
            </Tag>
            <NotifySettings />
            <ChangePassword />
            <Button type="text" icon={<LogoutOutlined />} onClick={auth.signOut}>
              <span className="header-logout">{t('退出')}</span>
            </Button>
          </Space>
        </Header>
        <Content className="app-content">
          <div className="app-page">
            <Suspense fallback={<FullSpin />}>
              <Routes>
                <Route path="/workbench" element={<WorkbenchPage />} />
                {auth.isStaff && <Route path="/receipts" element={<ReceiptsPage />} />}
                {isSales && <Route path="/submit" element={<SubmitPage />} />}
                <Route path="/vehicles" element={<VehiclesPage />} />
                <Route path="/commission" element={<CommissionPage />} />
                {auth.isStaff && <Route path="/reconcile" element={<ReconcilePage />} />}
                {auth.isStaff && <Route path="/base" element={<BaseDataPage />} />}
                {auth.isAdmin && <Route path="/users" element={<UsersPage />} />}
                <Route path="*" element={<Navigate to={home} replace />} />
              </Routes>
            </Suspense>
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}
