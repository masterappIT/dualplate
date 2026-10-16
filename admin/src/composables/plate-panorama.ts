import { computed } from 'vue'
import { useAdminStore } from '../store'

export function usePlatePanorama() {
  const { customers, plates, companyRecords, companyGroups, vehicles, overviewData } = useAdminStore()
  const deadlines = computed(() => overviewData.value.deadlines || [])
  const forPlate = (id: string) => deadlines.value.filter(item => item.ownerType === 'plate' && item.ownerId === id)
  const plateDanger = (id: string) => forPlate(id).some(item => item.level === 'overdue')
  // 全景按狀態分組；口徑與牌照表格的「狀態」欄一致，逾期另按到期列表判斷
  const plateStatus = (plate: any) => plateDanger(plate.id) || plate.health_status === 'overdue' ? 'overdue' : plate.health_status === 'due' ? 'due' : plate.health_status === 'ok' ? 'ok' : 'missing'
  const shortNames: Record<string, string> = { approval: '批文到期', hk_crp: 'CRP 到期', mo_permit: '澳門通行證到期', customs_filing: '海關備案', new_card_filing: '新批文生效日', crossing_90: '最近過關日期' }
  const shortName = (item: any) => shortNames[item.ruleCode] || item.name
  // 牌照下方寫明原因：缺哪些日期，或最急的是哪一項
  const plateReason = (id: string, status: string) => {
    if (status === 'ok') return '正常'
    if (status === 'missing') {
      const names = [...new Set(forPlate(id).filter(item => item.level === 'missing').map(shortName))]
      return names.length ? `缺${names.slice(0, 2).join('、')}${names.length > 2 ? ` 等 ${names.length} 項` : ''}` : '資料不全'
    }
    const urgent = forPlate(id).filter(item => item.level === status && item.dueOn).sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0]
    return urgent ? `${shortName(urgent)} ${urgent.dueOn.slice(0, 10)}` : status === 'overdue' ? '已逾期' : '需處理'
  }
  const plateGroups = [{ id: 'overdue', label: '已逾期', tone: 'danger' }, { id: 'due', label: '需處理', tone: 'warning' }, { id: 'missing', label: '資料不全', tone: 'neutral' }, { id: 'ok', label: '正常', tone: 'ok' }]
  const categories = computed(() => {
    const customerEntries = customers.value.map(customer => ({
      id: String(customer.id), label: customer.name, sub: `${plates.value.filter(plate => plate.customer_id === customer.id).length} 個牌照`,
      danger: deadlines.value.some(item => item.customerId === customer.id && item.level === 'overdue'),
      details: [{ label: '牌照', value: plates.value.filter(plate => plate.customer_id === customer.id).length }],
      chain: [{ label: '客戶', value: customer.name }, ...companyRecords.value.filter(company => company.customer_id === customer.id).map(company => ({ label: company.jurisdiction === '內地' ? '內地公司' : company.jurisdiction === '澳門' ? '澳門公司' : '香港公司', value: company.name }))],
    }))
    // 只有一位客戶有牌照時，不在每個牌照下重複客戶名稱
    const manyOwners = new Set(plates.value.map(plate => plate.customer_id)).size > 1
    const plateEntries = plates.value.map(plate => {
      const customer = customers.value.find(item => item.id === plate.customer_id)
      const status = plateStatus(plate)
      const reason = plateReason(plate.id, status)
      const group = companyGroups.value.find(item => item.id === plate.group_id)
      const companyNames = companyRecords.value.filter(company => group && company.group_id === group.id && company.customer_id === plate.customer_id).sort((first, second) => Number(first.jurisdiction === '內地') - Number(second.jurisdiction === '內地'))
      const vehicle = vehicles.value.find(item => item.id === plate.vehicle_id)
      const drivers = Object.entries(plate.card_data || {}).filter(([key, value]) => /^driver\d+$/.test(key) && value).map(([, value]) => String(value))
      return {
        id: String(plate.id), label: plate.mainland_plate || plate.local_plate || plate.card_number || '車牌待補', plate: plate.mainland_plate || plate.local_plate, plateId: String(plate.id),
        sub: manyOwners ? `${reason} · ${customer?.name || '客戶待補'}` : reason,
        group: status,
        danger: status === 'overdue',
        details: [{ label: '客戶', value: customer?.name || '待補' }, { label: '口岸', value: plate.port || plate.card_data?.crossing || '待補' }, { label: '路線', value: plate.route }],
        chain: [{ label: '客戶', value: customer?.name || '待補' }, ...companyNames.map(company => ({ label: company.jurisdiction === '內地' ? '內地公司' : company.jurisdiction === '澳門' ? '澳門公司' : '香港公司', value: company.name })), { label: '牌照', value: plate.mainland_plate || plate.local_plate || '車牌待補' }, { label: '車輛', value: vehicle?.plate || '未連結車輛' }, ...drivers.map(driver => ({ label: '司機', value: driver }))],
        deadlines: forPlate(plate.id).map(item => ({ name: item.name, dueOn: item.dueOn })),
      }
    })
    const companyEntries = companyRecords.value.map(company => ({
      id: String(company.id), label: company.name, sub: `${company.jurisdiction || '公司'} · ${company.status || '狀態待補'}`,
      danger: /註銷|解散/.test(company.status || ''), details: [{ label: '客戶', value: customers.value.find(item => item.id === company.customer_id)?.name || '待補' }, { label: '狀態', value: company.status }],
      chain: [{ label: '客戶', value: customers.value.find(item => item.id === company.customer_id)?.name || '待補' }, { label: '公司', value: company.name }],
    }))
    return [
      { id: 'customers', label: '客戶', entries: customerEntries, ratio: customerEntries.length ? customerEntries.filter(item => item.danger).length / customerEntries.length : 0 },
      { id: 'plates', label: '牌照', entries: plateEntries, groups: plateGroups, ratio: plateEntries.length ? plateEntries.filter(item => item.group === 'ok').length / plateEntries.length : 0 },
      { id: 'companies', label: '公司', entries: companyEntries, ratio: companyEntries.length ? companyEntries.filter(item => !item.danger).length / companyEntries.length : 0 },
    ]
  })
  const summary = computed(() => [
    { label: '客戶', value: customers.value.length }, { label: '牌照', value: plates.value.length }, { label: '公司', value: companyRecords.value.length },
    { label: '逾期牌照', value: plates.value.filter(plate => plateDanger(plate.id)).length, danger: true },
    { label: '已註銷內地公司', value: companyRecords.value.filter(company => company.jurisdiction === '內地' && /註銷|解散/.test(company.status || '')).length, danger: true },
    // 與牌照表格「資料不全」篩選同一口徑：有到期日未錄入（health_status = missing），可點擊跳到該篩選
    { label: '資料不全', value: plates.value.filter(plate => plateStatus(plate) === 'missing').length, danger: true, action: 'missing' },
  ])
  return { categories, summary, deadlines, plateDanger }
}
