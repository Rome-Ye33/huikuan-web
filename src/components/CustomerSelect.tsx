import { App, Select } from 'antd'
import { useState } from 'react'
import { errorText } from '../lib/errors'
import { useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'

// 客户下拉：本地过滤；搜不到时可以直接新建

type Props = {
  value?: number | null
  onChange?: (id: number | null) => void
  allowCreate?: boolean
  /** 新建客户时带上的业务员 */
  salespersonId?: number | null
  placeholder?: string
  style?: React.CSSProperties
}

export default function CustomerSelect({ value, onChange, allowCreate, salespersonId, placeholder, style }: Props) {
  const t = useT()
  const { customers, reload } = useRefData()
  const { message } = App.useApp()
  const [text, setText] = useState('')
  const [creating, setCreating] = useState(false)

  const q = text.trim().toLowerCase()
  const list = customers.filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 50)
  const exact = customers.some((c) => c.name.trim().toLowerCase() === q)
  const options: { value: number; label: string }[] = list.map((c) => ({ value: c.id, label: c.name }))
  if (allowCreate && q && !exact) options.unshift({ value: -1, label: t('+ 新建客户“{name}”', { name: text.trim() }) })
  if (value != null && !options.some((o) => o.value === value)) {
    const c = customers.find((x) => x.id === value)
    if (c) options.push({ value: c.id, label: c.name })
  }

  const handle = async (id: number | undefined) => {
    if (id === -1) {
      setCreating(true)
      const { data, error } = await supabase
        .from('customers')
        .insert({ name: text.trim(), salesperson_id: salespersonId ?? null })
        .select('id')
        .single()
      setCreating(false)
      if (error) {
        message.error(errorText(error))
        return
      }
      await reload()
      setText('')
      onChange?.(data.id)
      message.success(t('已新建客户'))
      return
    }
    onChange?.(id ?? null)
  }

  return (
    <Select
      showSearch={{ filterOption: false, onSearch: setText, searchValue: text }}
      allowClear
      loading={creating}
      value={value ?? undefined}
      placeholder={placeholder ?? t('选择客户')}
      style={style}
      options={options}
      onChange={handle}
      onOpenChange={(open) => {
        if (!open) setText('')
      }}
    />
  )
}
