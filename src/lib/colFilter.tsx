import { SearchOutlined } from '@ant-design/icons'
import { Button, Input, Space } from 'antd'
import type { ColumnType } from 'antd/es/table'
import { tr } from './i18n'

type Get<T> = (r: T) => unknown
const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/,/g, '').trim()

/** 文字列的列头筛选：点列头的放大镜，输入“包含什么”。筛的是已经加载到列表里的行（金额不用管千分位逗号） */
export function textCol<T>(get: Get<T>): Partial<ColumnType<T>> {
  return {
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
      <div style={{ padding: 8 }} onKeyDown={(e) => e.stopPropagation()}>
        <Input
          autoFocus
          allowClear
          placeholder={tr('包含…')}
          value={(selectedKeys[0] as string) ?? ''}
          onChange={(e) => {
            // 输入框清空（包括点输入框里的 ×）就等于不筛：马上生效，不用再点“筛选”
            setSelectedKeys(e.target.value ? [e.target.value] : [])
            if (!e.target.value) confirm({ closeDropdown: false })
          }}
          onPressEnter={() => confirm()}
          style={{ width: 220, display: 'block', marginBottom: 8 }}
        />
        <Space>
          <Button type="primary" size="small" onClick={() => confirm()}>
            {tr('筛选')}
          </Button>
          <Button size="small" onClick={() => clearFilters?.({ confirm: true, closeDropdown: true })}>
            {tr('清除')}
          </Button>
        </Space>
      </div>
    ),
    filterIcon: () => <SearchOutlined />,
    onFilter: (value, r) => norm(get(r)).includes(norm(value)),
  }
}

/** 选项列的列头筛选：按列表里出现过的值勾选（账户、业务员、状态这类），多了可以在里面搜 */
export function pickCol<T>(rows: T[], get: Get<T>, label: (v: string) => string = (v) => v): Partial<ColumnType<T>> {
  const vals = [...new Set(rows.map((r) => String(get(r) ?? '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'))
  return {
    filters: vals.map((v) => ({ text: label(v), value: v })),
    filterSearch: true,
    onFilter: (value, r) => String(get(r) ?? '') === value,
  }
}
