export const sources = [
  { id: 'GD-WEB-2026', agency: '廣東省公安廳交通管理局／陽春市人民政府', title: '兩地牌網辦業務指引', url: 'https://www.yangchun.gov.cn/xxgk/zdlyxxgk/gajg/fwgk/content/post_952712.html', checkedAt: '2026-10-15', appliesTo: '內地指標延期、變更駕駛人、換車' },
  { id: 'GD-NEW-HK', agency: '廣東省公安廳交通管理局', title: '香港入出內地商務車指標新辦（非港珠澳大橋口岸）', url: 'https://gdga.gd.gov.cn/jgj/jtzn/content/post_4130906.html', checkedAt: '2026-10-15', appliesTo: '指定商務車新申請類別' },
  { id: 'GD-NEW-MO', agency: '廣東省公安廳交通管理局', title: '新辦通行珠澳口岸粵澳小汽車業務辦理流程', url: 'https://gdga.gd.gov.cn/jgj/jtzn/content/post_2278464.html', checkedAt: '2026-10-15', appliesTo: '粵澳新申請；舊頁須重新核實具體步驟' },
  { id: 'HK-CRP', agency: '香港運輸署', title: '往來粵港車輛申請封閉道路通行許可證', url: 'https://www.td.gov.hk/tc/public_services/licences_and_permits/closed_road_permit_for_cross_boundary_vehicles/how_to_apply_for_closed_road_permit_for_boundary/index.html', checkedAt: '2026-10-15', appliesTo: '粵港 CRP 新辦、續期、換車、司機、口岸及補領' },
  { id: 'HK-MAINLAND-CHECKLIST', agency: '香港運輸署', title: '粵港常規配額及國際通行許可證（適用於內地車輛）2026年3月文件清單', url: 'https://www.td.gov.hk/filemanager/tc/content_5258/Mainland%20Regular%20Quota%20and%20International%20Circulation%20Permit_Applicable%20for%20Mainland%20Vehicles_tc_CBU.pdf', checkedAt: '2026-10-15', appliesTo: '內地車輛來港，含條件式驗車' },
  { id: 'HK-INDIVIDUAL-CHECKLIST', agency: '香港運輸署', title: '粵港常規配額（香港私家車個人名義）2026年1月文件清單', url: 'https://www.td.gov.hk/filemanager/tc/content_5258/ML_Individual_HKPC_chi_v3.pdf', checkedAt: '2026-10-15', appliesTo: '香港私家車個人名義' },
  { id: 'HK-VEHICLE-EXAM', agency: '香港運輸署', title: '怎樣辦理車輛登記及領取牌照', url: 'https://www.td.gov.hk/tc/public_services/licences_and_permits/vehicle_licences/how_to_apply_for_registering_and_licensing_a_vehic/index.html?print=1', checkedAt: '2026-10-15', appliesTo: '香港註冊車輛檢驗與牌照續期' },
  { id: 'MO-FIRST', agency: '澳門海關', title: '車輛邊境通行證首次申請', url: 'https://www.gov.mo/zh-hant/services/ps-1455/ps-1455a/', checkedAt: '2026-10-15', appliesTo: '粵澳首次申請' },
  { id: 'MO-RENEW', agency: '澳門海關', title: '車輛邊境通行證續期', url: 'https://www.gov.mo/zh-hant/services/ps-1455/ps-1455b/', checkedAt: '2026-10-15', appliesTo: '粵澳續期' },
  { id: 'MO-REPLACE', agency: '澳門海關', title: '車輛邊境通行證補領', url: 'https://www.gov.mo/zh-hant/services/ps-1455/ps-1455c/', checkedAt: '2026-10-15', appliesTo: '粵澳損毀或遺失補領' },
  { id: 'MO-FORM', agency: '澳門海關', title: '車輛邊境通行證及網上服務申請表', url: 'https://www.customs.gov.mo/form/SA214.pdf', checkedAt: '2026-10-15', appliesTo: '粵澳首次、更換、續期及補辦表格與條件式文件' },
  { id: 'MO-INSPECTION', agency: '澳門交通事務局', title: '車輛定期檢驗', url: 'https://www.gov.mo/zh-hant/services/ps-1933/ps-1933a/', checkedAt: '2026-10-17', appliesTo: '澳門註冊車輛年度定期檢驗；日期由交通事務局訂定，逾期須繳逾期費，超過限期未驗取消註冊' },
  { id: 'MO-VEHICLE-TAX', agency: '澳門交通事務局', title: '車輛使用牌照稅－繳納', url: 'https://www.gov.mo/zh-hant/services/ps-1926/ps-1926j/', checkedAt: '2026-10-17', appliesTo: '澳門已註冊車輛每年一月至三月繳交行車稅；繳稅前須先繳清交通違例罰款' },
  { id: 'HK-FORMS', agency: '香港運輸署', title: '許可證官方表格索引', url: 'https://www.td.gov.hk/tc/public_forms/td_forms/permit/index_t.html', checkedAt: '2026-10-15', appliesTo: 'TD547、TD547D 現行表格' },
  { id: 'CN-CUSTOMS', agency: '海關總署', title: '進出境運輸工具備案辦事指南', url: 'https://online.customs.gov.cn/static/pages/guides/000629018001/000629018001.html', checkedAt: '2026-10-15', appliesTo: '海關備案／變更；具體口岸須核實' }
]

export const routePlans = {
  new_application: {
    '粵港': { sourceIds: ['GD-NEW-HK', 'HK-CRP', 'HK-FORMS'], stages: ['申請類別與資格人工核實', '報價及代辦授權', '廣東申請材料收集', '廣東批文申請與回執', '香港 TD547D 材料收集', '香港 CRP 申請與回執', '驗車與備案適用性核對', '牌證交付與有效期核對'] },
    '粵澳': { sourceIds: ['GD-NEW-MO', 'MO-FIRST', 'MO-FORM'], stages: ['申請類別與資格人工核實', '報價及代辦授權', '廣東申請材料收集', '廣東批文申請與回執', '澳門海關申請材料收集', '澳門邊境通行證申請與回執', '電子標籤與驗車適用性核對', '牌證交付與有效期核對'] }
  },
  renewal: {
    '粵港': { sourceIds: ['GD-WEB-2026', 'HK-CRP', 'HK-FORMS'], stages: ['各證件有效期核對', '內地指標延期適用性核對', '內地延期辦理與回執', '香港 TD547 續期材料與提交', '香港 CRP 回執與新有效期核對', '相關備案核對'] },
    '粵澳': { sourceIds: ['GD-WEB-2026', 'MO-RENEW', 'MO-FORM'], stages: ['各證件有效期核對', '內地指標延期適用性核對', '內地延期辦理與回執', '澳門海關通行證續期與回執', '新有效期與相關備案核對'] }
  },
  vehicle_change: {
    '粵港': { sourceIds: ['GD-WEB-2026', 'HK-CRP', 'HK-MAINLAND-CHECKLIST', 'HK-FORMS'], stages: ['舊批文與新舊車資料核對', '新車驗車與內地保險條件核對', '內地指標換車辦理與回執', '香港 TD547 換車材料與提交', '香港 CRP 更新與回執', '海關及邊檢備案適用性核對'] },
    '粵澳': { sourceIds: ['GD-WEB-2026', 'MO-FORM'], stages: ['舊批文與新舊車資料核對', '新車驗車與保險條件核對', '內地指標換車辦理與回執', '澳門海關更換通行證材料與提交', '新通行證與電子標籤核對', '海關及邊檢備案適用性核對'] }
  },
  driver_change: {
    '粵港': { sourceIds: ['GD-WEB-2026', 'HK-CRP', 'HK-FORMS'], stages: ['司機資格與批文核對', '內地駕駛人變更與回執', '香港 TD547 司機資料變更', '香港許可證及相關備案核對'] },
    '粵澳': { sourceIds: ['GD-WEB-2026', 'MO-FORM'], stages: ['司機資格與批文核對', '內地駕駛人變更與回執', '澳門通行證司機資料核對', '相關備案核對'] }
  }
}

export function planFor(service, route) { return routePlans[service.code]?.[route] || { sourceIds: service.sourceIds, stages: service.stages } }

export const services = [
  { code: 'new_application', name: '新申請代辦', routes: ['粵港', '粵澳'], sourceIds: ['GD-NEW-HK', 'GD-NEW-MO', 'HK-CRP', 'MO-FIRST'], stages: ['資格類型核實', '報價及授權', '官方材料收集', '廣東批文申請', '港／澳牌證申請', '驗車及備案核對', '交付'] },
  { code: 'renewal', name: '指標／牌證續期', routes: ['粵港', '粵澳'], sourceIds: ['GD-WEB-2026', 'HK-CRP', 'MO-RENEW'], stages: ['到期資料核對', '官方材料收集', '內地延期', '港／澳續期', '備案核對', '交付'] },
  { code: 'vehicle_change', name: '換車', routes: ['粵港', '粵澳'], sourceIds: ['GD-WEB-2026', 'HK-CRP', 'HK-MAINLAND-CHECKLIST', 'MO-FIRST'], stages: ['新舊車資料核對', '驗車條件核實', '內地指標換車', '港／澳牌證更新', '海關／邊檢備案核對', '交付'] },
  { code: 'driver_change', name: '更換／新增司機', routes: ['粵港', '粵澳'], sourceIds: ['GD-WEB-2026', 'HK-CRP', 'MO-FIRST'], stages: ['司機資格核對', '內地批文變更', '港／澳資料更新', '邊檢備案核對', '交付'] },
  { code: 'crossing_change', name: '口岸變更／增加', routes: ['粵港'], sourceIds: ['HK-CRP'], stages: ['口岸與指標限制核實', '內地批文核對', '香港許可證更新', '海關／邊檢備案核對', '交付'] },
  { code: 'company_change', name: '商號／持有人資料變更', routes: ['粵港', '粵澳'], sourceIds: ['HK-MAINLAND-CHECKLIST', 'MO-FORM'], stages: ['變更類型與官方適用性核實', '證明文件收集', '內地批文變更適用性核對', '港／澳牌證更新適用性核對', '相關備案核對', '交付'] },
  { code: 'replacement', name: '批文／許可證補領', routes: ['粵港', '粵澳'], sourceIds: ['HK-CRP', 'MO-REPLACE'], stages: ['遺失／損毀核對', '官方材料收集', '補領申請', '交付'] },
  { code: 'inspection', name: '驗車代辦', routes: ['粵港', '粵澳'], sourceIds: ['GD-WEB-2026', 'GD-NEW-MO', 'HK-MAINLAND-CHECKLIST', 'HK-VEHICLE-EXAM'], stages: ['適用條件核實', '預約', '檢驗', '結果記錄', '交付'] },
  { code: 'filing', name: '海關／邊檢備案', routes: ['粵港', '粵澳'], sourceIds: ['CN-CUSTOMS', 'GD-NEW-MO'], stages: ['適用口岸與備案類型核實', '材料收集', '海關備案適用性核對', '邊檢備案適用性核對', '交付'] },
  { code: 'other', name: '其他代辦要求', routes: ['粵港', '粵澳'], sourceIds: [], stages: ['需求核實', '官方指引確認', '報價及授權', '辦理', '交付'] }
]

export function inspectionGuidance(vehicle = {}, serviceCode) {
  const results = []
  if (serviceCode === 'vehicle_change' && String(vehicle.plate || '').startsWith('粵Z')) results.push({ label: '粵Z 換車：新車驗車及內地交強險', state: 'required', sourceId: 'GD-WEB-2026' })
  if (vehicle.origin === '內地' && vehicle.route === '粵港') results.push({ label: '首次來港的內地企業私家車，或車齡滿六年的內地公務／企業私家車：香港檢驗', state: 'conditional', sourceId: 'HK-MAINLAND-CHECKLIST' })
  if (vehicle.origin === '香港' && vehicle.type === '私家車') results.push({ label: '香港車輛牌照續期：按製造年份核對六年或以上私家車年檢', state: 'conditional', sourceId: 'HK-VEHICLE-EXAM' })
  if (vehicle.origin === '澳門' && serviceCode === 'new_application') results.push({ label: '粵澳新申請：按廣東省公安廳流程核對驗車', state: 'conditional', sourceId: 'GD-NEW-MO' })
  if (vehicle.origin === '澳門') results.push({ label: '澳門定期檢驗：日期由交通事務局按註冊日訂定，照通知填寫；逾期須繳逾期費，超過限期未驗會被取消註冊', state: 'required', sourceId: 'MO-INSPECTION' })
  if (vehicle.origin === '澳門') results.push({ label: '澳門行車稅：每年一月至三月繳交，由客戶自理', state: 'required', sourceId: 'MO-VEHICLE-TAX' })
  if (!results.length) results.push({ label: '此類型驗車要求尚未由現有官方來源確定，需人工核實', state: 'review', sourceId: null })
  return results
}
