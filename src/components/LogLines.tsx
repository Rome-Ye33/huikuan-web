import { Button } from 'antd'
import { useState } from 'react'
import { useT } from '../lib/i18n'

// 修改记录里一次操作的几句话：一次删了、导了很多条流水时一句一行会很长，超过 10 句先只列前 10 句，点一下再全部展开。
const FOLD = 10

export default function LogLines({ lines }: { lines: string[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const long = lines.length > FOLD
  const shown = long && !open ? lines.slice(0, FOLD) : lines
  return (
    <>
      {shown.map((s, i) => (
        <div key={i} className="log-line">
          {s}
        </div>
      ))}
      {long && (
        <Button type="link" size="small" className="log-more" onClick={() => setOpen(!open)}>
          {open ? t('收起') : t('展开其余 {n} 条', { n: lines.length - FOLD })}
        </Button>
      )}
    </>
  )
}
