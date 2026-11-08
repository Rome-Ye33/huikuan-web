import { Select } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cleanSearch, usd } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Vehicle } from '../lib/supabase'
import { useT } from '../lib/i18n'

// 按大架号或客户名搜车辆（远程搜索）

type Props = {
  value?: number | null
  onChange?: (id: number | null, vehicle: Vehicle | null) => void
  /** 已知的车辆（编辑时把已选的车放进来，好显示名称） */
  known?: Vehicle[]
  placeholder?: string
  style?: React.CSSProperties
  disabled?: boolean
}

export function vehicleLabel(v: Vehicle): string {
  return `${v.vin} · ${v.model} · ${v.customer_name}`
}

export default function VehicleSelect({ value, onChange, known = [], placeholder, style, disabled }: Props) {
  const t = useT()
  const [found, setFound] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const search = (q: string) => {
    window.clearTimeout(timer.current)
    const s = cleanSearch(q)
    if (s.length < 2) return
    timer.current = window.setTimeout(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('v_vehicle_ledger')
        .select('*')
        .or(`vin.ilike.%${s}%,customer_name.ilike.%${s}%,model.ilike.%${s}%`)
        .order('vin')
        .limit(30)
      setFound(data ?? [])
      setLoading(false)
    }, 250)
  }

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const all = useMemo(() => {
    const m = new Map<number, Vehicle>()
    for (const v of [...known, ...found]) if (v.id != null) m.set(v.id, v)
    return m
  }, [known, found])

  const options = [...all.values()].map((v) => ({
    value: v.id as number,
    label: vehicleLabel(v),
    vehicle: v,
  }))

  return (
    <Select
      showSearch={{ filterOption: false, onSearch: search }}
      allowClear
      value={value ?? undefined}
      placeholder={placeholder ?? t('输入大架号或客户名搜索')}
      style={style}
      disabled={disabled}
      loading={loading}
      notFoundContent={loading ? t('搜索中…') : t('输入至少 2 个字搜索')}
      options={options}
      optionRender={(o) => {
        const v = (o.data as { vehicle: Vehicle }).vehicle
        return (
          <div>
            <div>
              <b>{v.vin}</b> · {v.model}
            </div>
            <div className="hint">
              {v.customer_name} · {v.salesperson_name ?? t('无业务员')} · {t(v.payment_method ?? '')} · {t('合同')} {usd(v.contract_usd)} · {t('余额')}{' '}
              {usd(v.balance_usd)}
            </div>
          </div>
        )
      }}
      onChange={(id: number | undefined) => onChange?.(id ?? null, id != null ? (all.get(id) ?? null) : null)}
    />
  )
}
