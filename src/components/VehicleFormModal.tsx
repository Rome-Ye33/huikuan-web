import { App, Col, DatePicker, Form, Input, InputNumber, Modal, Radio, Row, Select } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { errorText } from '../lib/errors'
import { useRefData } from '../lib/refdata'
import { supabase } from '../lib/supabase'
import type { Vehicle } from '../lib/supabase'
import CustomerSelect from './CustomerSelect'
import { useT } from '../lib/i18n'

type Props = {
  open: boolean
  /** 有值 = 修改；没值 = 新建 */
  vehicle?: Vehicle | null
  /** 新建时预填（比如业务员提交到账时手填的客户、车型、大架号） */
  initial?: { vin?: string | null; model?: string | null; customer_id?: number | null; salesperson_id?: number | null }
  onClose: (savedId?: number) => void
}

type FormValues = {
  vin: string
  model: string
  customer_id: number
  salesperson_id?: number | null
  contract_date?: dayjs.Dayjs | null
  payment_method: '全款' | '分期' | '预付'
  contract_usd: number
  down_payment_usd?: number | null
  ship_status: '未发车' | '已发车'
  shipped_at?: dayjs.Dayjs | null
  note?: string
}

export default function VehicleFormModal({ open, vehicle, initial, onClose }: Props) {
  const t = useT()
  const [form] = Form.useForm<FormValues>()
  const { salespersons } = useRefData()
  const { message } = App.useApp()
  const [saving, setSaving] = useState(false)
  const method = Form.useWatch('payment_method', form)
  const ship = Form.useWatch('ship_status', form)
  const salespersonId = Form.useWatch('salesperson_id', form)

  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (vehicle) {
      form.setFieldsValue({
        vin: vehicle.vin ?? '',
        model: vehicle.model ?? '',
        customer_id: vehicle.customer_id ?? undefined,
        salesperson_id: vehicle.salesperson_id,
        contract_date: vehicle.contract_date ? dayjs(vehicle.contract_date) : null,
        payment_method: (vehicle.payment_method ?? '全款') as FormValues['payment_method'],
        contract_usd: Number(vehicle.contract_usd ?? 0),
        down_payment_usd: vehicle.down_payment_usd != null ? Number(vehicle.down_payment_usd) : null,
        ship_status: (vehicle.ship_status ?? '未发车') as FormValues['ship_status'],
        shipped_at: vehicle.shipped_at ? dayjs(vehicle.shipped_at) : null,
        note: vehicle.note ?? '',
      })
    } else {
      form.setFieldsValue({
        vin: initial?.vin ?? '',
        model: initial?.model ?? '',
        customer_id: initial?.customer_id ?? undefined,
        salesperson_id: initial?.salesperson_id ?? undefined,
        payment_method: '全款',
        ship_status: '未发车',
      })
    }
  }, [open, vehicle, initial, form])

  const save = async () => {
    const v = await form.validateFields()
    const row = {
      vin: v.vin.toUpperCase().replace(/\s+/g, ''),
      model: v.model.trim(),
      customer_id: v.customer_id,
      salesperson_id: v.salesperson_id ?? null,
      contract_date: v.contract_date ? v.contract_date.format('YYYY-MM-DD') : null,
      payment_method: v.payment_method,
      contract_usd: v.contract_usd,
      down_payment_usd: v.payment_method === '分期' ? (v.down_payment_usd ?? null) : null,
      ship_status: v.ship_status,
      shipped_at: v.ship_status === '已发车' && v.shipped_at ? v.shipped_at.format('YYYY-MM-DD') : null,
      note: v.note?.trim() || null,
    }
    setSaving(true)
    const res = vehicle?.id
      ? await supabase.from('vehicles').update(row).eq('id', vehicle.id).select('id').single()
      : await supabase.from('vehicles').insert(row).select('id').single()
    setSaving(false)
    if (res.error) {
      message.error(errorText(res.error))
      return
    }
    message.success(vehicle ? t('已保存') : t('已新增车辆'))
    onClose(res.data.id)
  }

  return (
    <Modal
      open={open}
      title={vehicle ? t('修改车辆 {vin}', { vin: vehicle.vin }) : t('新增车辆')}
      onCancel={() => onClose()}
      onOk={save}
      okText={t('保存')}
      confirmLoading={saving}
      width={720}
      forceRender
    >
      <Form form={form} layout="vertical" requiredMark="optional">
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="vin"
              label={t('大架号')}
              rules={[{ required: true, message: t('请填大架号') }]}
              normalize={(x: string) => x?.toUpperCase().replace(/\s+/g, '')}
            >
              <Input placeholder="LNB..." />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="model" label={t('车型 / 设备')} rules={[{ required: true, message: t('请填车型') }]}>
              <Input placeholder={t('如 龙工装载机、6x4自卸车直斗')} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="salesperson_id" label={t('业务员')}>
              <Select
                allowClear
                showSearch={{ optionFilterProp: 'label' }}
                options={salespersons.filter((s) => s.active || s.id === salespersonId).map((s) => ({ value: s.id, label: s.name }))}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="customer_id" label={t('客户')} rules={[{ required: true, message: t('请选客户') }]}>
              <CustomerSelect allowCreate salespersonId={salespersonId} placeholder={t('搜索客户，没有就直接新建')} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="payment_method" label={t('付款方式')} rules={[{ required: true }]}>
              <Radio.Group
                optionType="button"
                options={[
                  { value: '全款', label: t('全款') },
                  { value: '分期', label: t('分期') },
                  { value: '预付', label: t('预付') },
                ]}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="contract_date" label={t('合同日期')}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="contract_usd" label={t('合同价（USD）')} rules={[{ required: true, message: t('请填合同价') }]}>
              <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="$" />
            </Form.Item>
          </Col>
          <Col span={12}>
            {method === '分期' && (
              <Form.Item name="down_payment_usd" label={t('首付（USD）')} rules={[{ required: true, message: t('分期必须填首付') }]}>
                <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="$" />
              </Form.Item>
            )}
          </Col>
          <Col span={12}>
            <Form.Item name="ship_status" label={t('发车状态')}>
              <Radio.Group
                optionType="button"
                options={[
                  { value: '未发车', label: t('未发车') },
                  { value: '已发车', label: t('已发车') },
                ]}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            {ship === '已发车' && (
              <Form.Item name="shipped_at" label={t('发车日期')}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            )}
          </Col>
          <Col span={24}>
            <Form.Item name="note" label={t('备注')}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  )
}
