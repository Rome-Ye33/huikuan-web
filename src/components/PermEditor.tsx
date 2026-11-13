import { Alert, App, Button, Modal, Radio, Space, Table, Tag, Typography } from 'antd'
import { useState } from 'react'
import { PERM_LEVELS, PERM_MODULES, permOf, storedPerms } from '../lib/perms'
import type { PermLevel, PermModule, Perms } from '../lib/perms'
import type { Json } from '../lib/database.types'
import { errorText } from '../lib/errors'
import { useT } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import type { AppRole } from '../lib/supabase'

// 财务的模块权限（数据库 31）：每个财务账号（邀请名单上还没注册的也行）、每个模块一档 不可见 / 只看 / 可编辑。
// 管理员永远全部可编辑；业务员不用这个（只看得到自己名下的）。

/** 每个模块“可编辑”能做什么（只看 = 能打开看，这些都做不了） */
const MODULE_HINT: Record<PermModule, string> = {
  receipts: '录到账、拆分、审核业务员提交、请业务员填写、报款',
  cheques: '录支票、存票、退票、导入表格',
  vehicles: '新增、修改、导入车辆，录期初、优惠折让',
  commission: '替业务员开提成单、修改、标记发放',
  reconcile: '导入银行流水、配对、忽略',
  base: '客户、汇率（业务员、收款账户、款项性质只有管理员能改）',
}

const LEVEL_COLOR: Record<PermLevel, string> = { none: 'default', view: 'default', edit: 'blue' }

/** 表格里的一格：这个人现在的模块权限 */
export function PermSummary({ role, perms }: { role: AppRole | null; perms: Json | null }) {
  const t = useT()
  if (role === 'admin') return <span className="hint">{t('管理员：全部可编辑')}</span>
  if (role !== 'finance') return null
  if (perms === null) return <Tag color="green">{t('全部可编辑')}</Tag>
  const shown = PERM_MODULES.map((m) => ({ ...m, level: permOf('finance', perms, m.key) })).filter((m) => m.level !== 'none')
  if (!shown.length) return <Tag>{t('全部不可见')}</Tag>
  return (
    <Space size={[0, 4]} wrap className="perm-tags">
      {shown.map((m) => (
        <Tag key={m.key} color={LEVEL_COLOR[m.level]}>
          {m.level === 'edit' ? t(m.label) : t('{module}（只看）', { module: t(m.label) })}
        </Tag>
      ))}
    </Space>
  )
}

export type PermTarget =
  | { kind: 'profile'; id: string; name: string; perms: Json | null }
  | { kind: 'invite'; email: string; name: string; perms: Json | null }

/** 设置一个财务账号（或邀请名单上的人）的模块权限 */
export default function PermEditor({ target, onClose }: { target: PermTarget | null; onClose: (saved: boolean) => void }) {
  const t = useT()
  const { message } = App.useApp()
  const [levels, setLevels] = useState<Perms>({})
  const [saving, setSaving] = useState(false)
  // 打开另一个人时，按他现在的权限重新填（在渲染时对上，不用 effect）
  const [shownFor, setShownFor] = useState<PermTarget | null>(null)
  if (target !== shownFor) {
    setShownFor(target)
    if (target) setLevels(Object.fromEntries(PERM_MODULES.map((m) => [m.key, permOf('finance', target.perms, m.key)])) as Perms)
  }

  const setAll = (level: PermLevel) => setLevels(Object.fromEntries(PERM_MODULES.map((m) => [m.key, level])) as Perms)

  const save = async () => {
    if (!target) return
    setSaving(true)
    const perms = storedPerms(levels)
    const { error } =
      target.kind === 'profile'
        ? await supabase.from('profiles').update({ perms }).eq('id', target.id)
        : await supabase.from('user_invites').update({ perms }).eq('email', target.email)
    setSaving(false)
    if (error) {
      message.error(errorText(error))
      return
    }
    message.success(t('已保存'))
    onClose(true)
  }

  return (
    <Modal
      open={!!target}
      title={t('模块权限：{name}', { name: target?.name ?? '' })}
      okText={t('保存')}
      confirmLoading={saving}
      onOk={() => void save()}
      onCancel={() => onClose(false)}
      width={720}
      destroyOnHidden
      className="perm-editor"
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title={t('不可见：菜单里没有这一项。只看：能打开看、能导出，不能新建、修改、删除。可编辑：都能做。')}
        description={t('审批照旧按审批岗位：轮到他审批的单，就算这个模块是只看或不可见，也能在工作台里打开、通过或退回。')}
      />
      <Space wrap style={{ marginBottom: 8 }}>
        <Button size="small" onClick={() => setAll('edit')}>
          {t('全部可编辑')}
        </Button>
        <Button size="small" onClick={() => setAll('view')}>
          {t('全部只看')}
        </Button>
      </Space>
      <Table
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={PERM_MODULES}
        columns={[
          {
            title: t('模块'),
            render: (_, m) => (
              <div>
                <Typography.Text strong>{t(m.label)}</Typography.Text>
                <div className="hint">{t('可编辑：{what}', { what: t(MODULE_HINT[m.key]) })}</div>
              </div>
            ),
          },
          {
            title: t('权限'),
            width: 230,
            render: (_, m) => (
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                size="small"
                value={levels[m.key] ?? 'none'}
                onChange={(e) => setLevels((l) => ({ ...l, [m.key]: e.target.value as PermLevel }))}
                options={PERM_LEVELS.map((l) => ({ value: l.key, label: t(l.label) }))}
              />
            ),
          },
        ]}
      />
      <div className="hint" style={{ marginTop: 8 }}>
        {t('从支票、银行流水生成到账，还要“到账录入”可编辑。客户在车辆、支票的录入框里也能直接新建。')}
      </div>
    </Modal>
  )
}
