import { computed } from 'vue'
import { useAdminStore } from '../store'

export function usePlatePanorama() {
  const { customers, plates, companyRecords, companyGroups, vehicles, overviewData } = useAdminStore()
  const deadlines = computed(() => overviewData.value.deadlines || [])
  const forPlate = (id: string) => deadlines.value.filter(item => item.ownerType === 'plate' && item.ownerId === id)
  const plateDanger = (id: string) => forPlate(id).some(item => item.level === 'overdue')
  const categories = computed(() => {
    const customerEntries = customers.value.map(customer => ({
      id: String(customer.id), label: customer.name, sub: `${plates.value.filter(plate => plate.customer_id === customer.id).length} 個牌照`,
      danger: deadlines.value.some(item => item.customerId === customer.id && item.level === 'overdue'),
      details: [{ label: '牌照', value: plates.value.filter(plate => plate.customer_id === customer.id).length }],
      chain: [{ label: '客戶', value: customer.name }, ...companyRecords.value.filter(company => company.customer_id === customer.id).map(company => ({ label: company.jurisdiction === '內地' ? '內地公司' : company.jurisdiction === '澳門' ? '澳門公司' : '香港公司', value: company.name }))],
    }))
    const plateEntries = plates.value.map(plate => {
      const customer = customers.value.find(item => item.id === plate.customer_id)
      const group = companyGroups.value.find(item => item.id === plate.group_id)
      const companyNames = companyRecords.value.filter(company => group && company.group_id === group.id && company.customer_id === plate.customer_id).sort((first, second) => Number(first.jurisdiction === '內地') - Number(second.jurisdiction === '內地'))
      const vehicle = vehicles.value.find(item => item.id === plate.vehicle_id)
      const drivers = Object.entries(plate.card_data || {}).filter(([key, value]) => /^driver\d+$/.test(key) && value).map(([, value]) => String(value))
      return {
        id: String(plate.id), label: plate.mainland_plate || plate.local_plate || plate.card_number || '車牌待補', plate: plate.mainland_plate || plate.local_plate, plateId: String(plate.id),
        sub: `${customer?.name || '客戶待補'} · ${plateDanger(plate.id) ? '已逾期' : plate.health_status === 'due' ? '需處理' : plate.health_status === 'ok' ? '正常' : '資料待補'}`,
        danger: plateDanger(plate.id),
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
      { id: 'plates', label: '牌照', entries: plateEntries, ratio: plateEntries.length ? plateEntries.filter(item => item.sub.includes('正常')).length / plateEntries.length : 0 },
      { id: 'companies', label: '公司', entries: companyEntries, ratio: companyEntries.length ? companyEntries.filter(item => !item.danger).length / companyEntries.length : 0 },
    ]
  })
  const summary = computed(() => [
    { label: '客戶', value: customers.value.length }, { label: '牌照', value: plates.value.length }, { label: '公司', value: companyRecords.value.length },
    { label: '逾期牌照', value: plates.value.filter(plate => plateDanger(plate.id)).length, danger: true },
    { label: '已註銷內地公司', value: companyRecords.value.filter(company => company.jurisdiction === '內地' && /註銷|解散/.test(company.status || '')).length, danger: true },
    { label: '資料不全', value: plates.value.filter(plate => !(plate.port || plate.card_data?.crossing) || !plate.mainland_plate || !plate.vehicle_id).length, danger: true },
  ])
  return { categories, summary, deadlines, plateDanger }
}
