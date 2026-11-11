import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, App, Button, Input, Modal, Tooltip } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { errorText } from '../lib/errors'
import { parseFlow, useFlow } from '../lib/flow'
import type { FlowDocType } from '../lib/flow'
import { useT } from '../lib/i18n'
import { useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'

// 调整审批流（管理员）：提成单的或到账的，加一级、删一级、改名字（中文、英文）、调顺序，一次保存（save_approval_flow）。
// 提成单：开头“业务员开单提交”、最后“财务发放”不变，至少一级。到账：开头“财务录入”、最后“生效”不变，可以一级都不留（录入就生效）。
// 改了只影响之后提交（录入）的单据；审批中的按记下的流程走完。每一级由谁审不在这里改，在“用户与权限”的审批流卡片上选人。

type Props = {
  open: boolean
  docType: FlowDocType
  /** 这一级上现在有几个人（已注册的和邀请名单上的）：删的时候提醒会去掉他们的岗位 */
  peopleOn: (key: string) => number
  onClose: (saved: boolean) => void
}

type Row = { id: string; key: string | null; name: string; name_en: string }

const MAX_STEPS = 10
const MAX_NAME = 20
const MAX_EN = 40

/** 名字前后的空格去掉、中间连着的空格合成一个（和数据库存的一样） */
const clean = (s: string) => s.trim().replace(/\s+/g, ' ')
/** 按字数算（和数据库的 char_length 一样） */
const chars = (s: string) => [...s].length

/** 一行的问题：哪个框（名字 / 英文名）、怎么了 */
type Problem = { field: 'name' | 'en'; text: string } | null

export default function FlowEditor({ open, docType, peopleOn, onClose }: Props) {
  const t = useT()
  const { message, modal } = App.useApp()
  const flow = useFlow(docType)
  const isReceipt = docType === 'receipt'
  const { reloadSteps } = useRefData()
  const [rows, setRows] = useState<Row[]>([])
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  // 打开时从现在的审批流开始改
  useEffect(() => {
    if (!open) return
    setRows(flow.active.map((s) => ({ id: s.key, key: s.key, name: s.name, name_en: s.name_en ?? '' })))
    setTried(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在打开时取一次
  }, [open])

  const edit = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = i + d
      if (j < 0 || j >= rs.length) return rs
      const next = [...rs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const remove = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i))
  const add = () => {
    seq.current += 1
    setRows((rs) => [...rs, { id: `new-${seq.current}`, key: null, name: '', name_en: '' }])
  }

  /** 每一行的问题（没有就是 null） */
  const problems: Problem[] = rows.map((r, i) => {
    const name = clean(r.name)
    if (!name) return { field: 'name', text: t('请填名字') }
    if (chars(name) > MAX_NAME) return { field: 'name', text: t('名字最多 {n} 个字', { n: MAX_NAME }) }
    if (chars(clean(r.name_en)) > MAX_EN) return { field: 'en', text: t('英文名最多 {n} 个字母', { n: MAX_EN }) }
    const same = rows.findIndex((x) => clean(x.name) === name)
    if (same < i) return { field: 'name', text: t('和第 {n} 级重名了', { n: same + 1 }) }
    return null
  })

  const doSave = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('save_approval_flow', {
      p_doc_type: docType,
      p_steps: rows.map((r) => ({ key: r.key, name: clean(r.name), name_en: clean(r.name_en) })),
    })
    if (error) {
      setBusy(false)
      message.error(errorText(error))
      return
    }
    await reloadSteps()
    setBusy(false)
    message.success(t('审批流已保存'))
    onClose(true)
  }

  const save = async () => {
    setTried(true)
    if (!rows.length && !isReceipt) {
      message.error(t('审批流至少要有一级'))
      return
    }
    if (problems.some(Boolean)) return
    // 删掉的级别：提醒上面的人会去掉岗位、审批中还要经过这一级的单由管理员代办
    const removed = flow.active.filter((s) => !rows.some((r) => r.key === s.key))
    if (!removed.length) {
      await doSave()
      return
    }
    setBusy(true)
    const { data } = isReceipt
      ? await supabase.from('bank_receipts').select('step,flow').eq('status', 'pending').limit(2000)
      : await supabase.from('commission_vouchers').select('step,flow').eq('status', 'submitted').limit(2000)
    setBusy(false)
    const lines: string[] = []
    for (const s of removed) {
      const people = peopleOn(s.key)
      if (people) lines.push(t('“{name}”上的 {n} 个人会去掉这个审批岗位', { name: flow.name(s.key), n: people }))
      const waiting = (data ?? []).filter((v) => {
        const keys = parseFlow(v.flow).map((f) => f.step)
        const here = keys.indexOf(v.step ?? '')
        return here >= 0 && keys.indexOf(s.key) >= here
      }).length
      if (waiting)
        lines.push(
          isReceipt
            ? t('审批中的 {n} 笔到账还要经过“{name}”，到这一级时由管理员代办', { name: flow.name(s.key), n: waiting })
            : t('审批中的 {n} 张提成单还要经过“{name}”，到这一级时由管理员代办', { name: flow.name(s.key), n: waiting }),
        )
    }
    const none = isReceipt && !rows.length
    modal.confirm({
      title: none ? t('一级都不留？') : t('删掉 {names}？', { names: removed.map((s) => `“${flow.name(s.key)}”`).join('、') }),
      content: (
        <div>
          {lines.map((l) => (
            <div key={l}>{l}</div>
          ))}
          <div>{none ? t('到账录入后就直接生效，不再审批。') : isReceipt ? t('之后录入的到账不再走删掉的级别。') : t('之后提交的提成单不再走删掉的级别。')}</div>
        </div>
      ),
      okText: t('删掉并保存'),
      cancelText: t('再想想'),
      okButtonProps: { danger: true },
      onOk: doSave,
    })
  }

  return (
    <Modal
      open={open}
      rootClassName={`flow-editor flow-editor-${docType}`}
      title={isReceipt ? t('调整到账审批流') : t('调整提成单审批流')}
      okText={t('保存')}
      cancelText={t('取消')}
      confirmLoading={busy}
      onOk={() => void save()}
      onCancel={() => onClose(false)}
      width={680}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title={
          isReceipt
            ? t('开头“财务录入到账”和最后“生效”不变，这里改中间的审批级别：加一级、删一级、改名字、调顺序。保存后只影响之后录入（包括重新提交、重审）的到账，已经在审批中的按记下的流程走完。一级都不留就是到账录入后直接生效。每一级由谁审，保存后在审批流卡片上选。')
            : t('开头“业务员开单提交”和最后“财务发放”不变，这里改中间的审批级别：加一级、删一级、改名字、调顺序。保存后只影响之后提交（包括退回后重新提交）的提成单，已经在审批中的按提交时的流程走完。每一级由谁审，保存后在审批流卡片上选。')
        }
      />
      <div className="flow-edit-head">
        <span />
        <span>{t('名字')}</span>
        <span>{t('英文名（英文界面用，可不填）')}</span>
        <span />
      </div>
      {rows.map((r, i) => {
        const bad = tried ? problems[i] : null
        return (
          <div key={r.id} className="flow-edit-row" data-step={r.key ?? 'new'}>
            <span className="flow-edit-no">{i + 1}.</span>
            <Input
              className="flow-edit-name"
              value={r.name}
              maxLength={MAX_NAME + 10}
              status={bad?.field === 'name' ? 'error' : undefined}
              placeholder={t('比如 销售经理')}
              onChange={(e) => edit(i, { name: e.target.value })}
            />
            <Input
              className="flow-edit-en"
              value={r.name_en}
              maxLength={MAX_EN + 10}
              status={bad?.field === 'en' ? 'error' : undefined}
              placeholder={t('比如 Sales Manager')}
              onChange={(e) => edit(i, { name_en: e.target.value })}
            />
            <span className="flow-edit-btns">
              <Tooltip title={t('上移')}>
                <Button size="small" icon={<ArrowUpOutlined />} disabled={i === 0} aria-label={t('上移')} onClick={() => move(i, -1)} />
              </Tooltip>
              <Tooltip title={t('下移')}>
                <Button
                  size="small"
                  icon={<ArrowDownOutlined />}
                  disabled={i === rows.length - 1}
                  aria-label={t('下移')}
                  onClick={() => move(i, 1)}
                />
              </Tooltip>
              <Tooltip title={rows.length === 1 && !isReceipt ? t('至少要留一级') : t('删掉这一级')}>
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={rows.length === 1 && !isReceipt}
                  aria-label={t('删掉这一级')}
                  onClick={() => remove(i)}
                />
              </Tooltip>
            </span>
            {bad && <div className="flow-edit-err text-danger">{bad.text}</div>}
          </div>
        )
      })}
      <Button type="dashed" block icon={<PlusOutlined />} disabled={rows.length >= MAX_STEPS} onClick={add} style={{ marginTop: 4 }}>
        {rows.length >= MAX_STEPS ? t('最多 {n} 级', { n: MAX_STEPS }) : t('加一级')}
      </Button>
    </Modal>
  )
}
