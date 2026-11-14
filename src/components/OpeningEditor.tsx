import { Alert, App, DatePicker, InputNumber, Modal, Space, Table, Tag } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/errors'
import { useT } from '../lib/i18n'
import { accountGroup, currencyRank, groupRank, notifyJournalChanged, scopeOf } from '../lib/journal'
import type { JournalScope } from '../lib/journal'
import { useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import type { Account } from '../lib/supabase'

// 期初余额：从哪一天开始在系统里记账（期初日期），每个账户那天开始时有多少钱（= 前一天日终余额，解款表上个月的月末余额）。
// 一个日期对所有账户；没填的账户按 0 算，余额页上会标“没设期初”。存进 bank_accounts.opening_date / opening_balance（数据库 36 的 save_openings）。
// 两本日记账各填各的账户（银行日记账填银行账户，现金日记账填现金、momo）；期初日期两本共用，两本都能编辑的人才能改。

export default function OpeningEditor({ open, scope, onClose }: { open: boolean; scope: JournalScope; onClose: (changed: boolean) => void }) {
  const t = useT()
  const { message } = App.useApp()
  const { canEdit } = useAuth()
  const { accounts, reload } = useRefData()
  const dateEditable = canEdit('journal') && canEdit('cash')
  const current = accounts.find((a) => a.opening_date)?.opening_date ?? null
  const [date, setDate] = useState<dayjs.Dayjs | null>(null)
  const [values, setValues] = useState<Record<number, number | null>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const first = accounts.find((a) => a.opening_date)?.opening_date
    setDate(first ? dayjs(first) : dateEditable ? dayjs().startOf('month') : null)
    setValues(Object.fromEntries(accounts.map((a) => [a.id, a.opening_balance == null ? null : Number(a.opening_balance)])))
  }, [open, accounts, dateEditable])

  // 启用的账户，加上停用了但设过期初的（停用的账户里可能还有钱）
  const rows = useMemo(
    () =>
      accounts
        .filter((a) => scopeOf(a) === scope)
        .filter((a) => a.active || a.opening_balance != null)
        .sort(
          (a, b) =>
            groupRank(accountGroup(a)) - groupRank(accountGroup(b)) ||
            currencyRank(a.currency) - currencyRank(b.currency) ||
            a.short_name.localeCompare(b.short_name),
        ),
    [accounts, scope],
  )

  const save = async () => {
    if (!date) return
    setSaving(true)
    const p_rows = rows.map((a) => ({ account_id: a.id, balance: values[a.id] ?? null }))
    const { error } = await supabase.rpc('save_openings', { p_date: date.format('YYYY-MM-DD'), p_rows })
    setSaving(false)
    if (error) {
      message.error(errorText(error))
      return
    }
    await reload()
    notifyJournalChanged()
    message.success(t('期初余额已保存'))
    onClose(true)
  }

  const filled = rows.filter((a) => values[a.id] != null).length

  return (
    <Modal
      open={open}
      title={t('期初余额')}
      okText={t('保存')}
      cancelText={t('取消')}
      onOk={() => void save()}
      okButtonProps={{ disabled: !date }}
      confirmLoading={saving}
      onCancel={() => onClose(false)}
      width={720}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        className="entry-tip"
        title={t('期初日期是开始在系统里记账的第一天；期初余额填前一天日终的余额（解款表里上个月的月末余额）。之前的收支不用补录。')}
      />
      {!dateEditable && !current && (
        <Alert type="warning" showIcon className="entry-tip" title={t('还没设期初日期：期初日期两本日记账共用，请银行日记账、现金日记账都能编辑的人（比如管理员）先设。')} />
      )}
      <Space wrap className="filters">
        <span>{t('期初日期')}</span>
        <DatePicker value={date} onChange={setDate} allowClear={false} disabled={!dateEditable} />
        <span className="hint">{t('已填 {n} / {m} 个账户', { n: filled, m: rows.length })}</span>
        <span className="hint">{t('期初日期银行日记账、现金日记账共用')}</span>
      </Space>
      <Table<Account>
        size="small"
        rowKey="id"
        pagination={false}
        scroll={{ y: 420 }}
        dataSource={rows}
        columns={[
          { title: t('分组'), width: 110, render: (_, a) => <span className="hint">{t(accountGroup(a))}</span> },
          { title: t('币别'), dataIndex: 'currency', width: 64 },
          {
            title: t('账户'),
            render: (_, a) => (
              <span>
                {a.short_name} {!a.active && <Tag>{t('停用')}</Tag>}
              </span>
            ),
          },
          {
            title: t('期初余额'),
            width: 190,
            render: (_, a) => (
              <InputNumber
                size="small"
                style={{ width: '100%' }}
                precision={2}
                value={values[a.id] ?? null}
                placeholder={t('没填')}
                onChange={(v) => setValues((x) => ({ ...x, [a.id]: v ?? null }))}
              />
            ),
          },
        ]}
      />
    </Modal>
  )
}
