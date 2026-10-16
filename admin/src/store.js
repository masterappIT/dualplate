import { ref, computed, watch } from "vue";
import {
  LayoutDashboard,
  FolderKanban,
  UsersRound,
  CarFront,
  BookOpenCheck,
  FilePlus2,
  RefreshCcw,
  ArrowLeftRight,
  ClipboardCheck,
  FileText,
  ShieldCheck,
  LogOut,
  ArrowUpRight,
  BellRing,
  Clock3,
  CalendarClock,
  BriefcaseBusiness,
  Settings2,
  Table2,
  KeyRound,
  ReceiptText,
  Calculator,
  FileSpreadsheet,
} from "@lucide/vue";
import { api, save, clear, user } from "./api";
import { router } from './router';
import { pushToast } from './composables/toast';
const navigation = [
  { id: "dashboard", name: "今日工作", icon: CalendarClock },
  { id: "customers", name: "客戶", icon: UsersRound },
  { id: "plates", name: "牌照", icon: Table2 },
  { id: "business", name: "業務", icon: BriefcaseBusiness },
  // 出租、收費、報帳只限管理者（後端同樣限制）；月報員工可看
  { id: "rentals", name: "出租與租金", icon: KeyRound, adminOnly: true },
  { id: "fees", name: "收費", icon: ReceiptText, adminOnly: true },
  { id: "filings", name: "報帳報稅", icon: Calculator, adminOnly: true },
  { id: "reports", name: "月報", icon: FileSpreadsheet },
  { id: "settings", name: "設定", icon: Settings2 },
];
const account = ref(user()),
  view = ref("dashboard"),
  companyCustomer = ref(""),
  error = ref(""),
  notice = ref(""),
  loginForm = ref({ username: "", password: "" }),
  loggingIn = ref(false),
  customers = ref([]),
  vehicles = ref([]),
  plates = ref([]),
  companyGroups = ref([]),
  companyRecords = ref([]),
  requests = ref([]),
  requestDetails = ref([]),
  services = ref([]),
  sources = ref([]),
  search = ref(""),
  statusFilter = ref(""),
  selected = ref(null),
  selectedCustomer = ref(null),
  recentCustomerAccounts = ref([]),
  customerTab = ref("overview"),
  selectedVehicle = ref(null),
  selectedPlate = ref(null),
  plateForm = ref({}),
  cardDraft = ref({}),
  cardFieldStatus = ref({}),
  modal = ref(null),
  form = ref({}),
  editRequest = ref({}),
  newRequest = ref({
    customerId: "",
    route: "粵港",
    serviceCode: "new_application",
    vehicleId: "",
    plateAssetId: "",
    title: "",
    description: "",
  });
const plateGroups = ref([]),
  vehicleForm = ref({}),
  overviewData = ref({ counts: {}, deadlines: [], customers: [], plates: { total: 0, byUsage: {} } }),
  todayTab = ref("due"),
  todayCustomerId = ref(""),
  customerSearch = ref(""),
  plateFilter = ref("all"),
  plateSearch = ref(""),
  selectedPlateIds = ref([]),
  bulkRule = ref("hk_crp"),
  bulkDate = ref(""),
  importPreview = ref(null),
  importCsv = ref("");
watch(selectedPlate, async (plate) => {
  if (!plate) return;
  try {
    plateGroups.value = await api(
      "/company-groups?customerId=" + encodeURIComponent(plate.customer_id),
    );
  } catch (e) {
    showError(e);
  }
});
watch(selectedVehicle, (vehicle) => {
  if (vehicle)
    vehicleForm.value = {
      firstRegisteredOn: vehicle.first_registered_on || "",
      origin: vehicle.origin,
      plate: vehicle.plate,
      brand: vehicle.brand || "",
      model: vehicle.model || "",
      vin: vehicle.vin || "",
      manufacturedYear: vehicle.manufactured_year || "",
      notes: vehicle.notes || "",
    };
});
async function saveVehicle() {
  try {
    await api(
      "/vehicles/" + selectedVehicle.value.id,
      "PATCH",
      vehicleForm.value,
    );
    await refresh();
    await openVehicle(selectedVehicle.value);
    showSuccess("車輛資料已儲存");
  } catch (e) {
    showError(e);
  }
}

async function saveTrackedItem(item) {
  try {
    await api('/tracked-items', 'PUT', { ownerType: item.ownerType, ownerId: item.ownerId, code: item.code, expiresOn: item.expiresOn || '', notes: item.notes || '' })
    await refresh()
    showSuccess('到期日期已儲存')
    return true
  } catch (error) { showError(error); await refresh(); return false }
}

async function saveBulkDates() {
  if (!selectedPlateIds.value.length || !bulkDate.value) return showError(new Error('請先勾選牌照並填寫日期'))
  try {
    await api('/tracked-items/bulk', 'PUT', { plateIds: selectedPlateIds.value, code: bulkRule.value, expiresOn: bulkDate.value })
    selectedPlateIds.value = []
    bulkDate.value = ''
    await refresh()
    showSuccess('已批量儲存到期日期')
  } catch (error) { showError(error) }
}

async function previewPlateImport(csv) {
  try { importPreview.value = null; importCsv.value = csv; importPreview.value = await api('/import/plates?dryRun=1', 'POST', { csv }) } catch (error) { showError(error) }
}

async function confirmPlateImport() {
  try { importPreview.value = await api('/import/plates', 'POST', { csv: importCsv.value, previewKey: importPreview.value?.previewKey, confirm: true }); await refresh(); showSuccess('牌照匯入已完成') } catch (error) { showError(error) }
}
const cardFields = [
  ["cardNumber", "編號"],
  ["company", "商號"],
  ["contractor", "內承單位"],
  ["crossing", "通行口岸"],
  ["serial", "卡面流水號"],
  ["mainlandPlate", "內地車牌號"],
  ["localPlate", "港澳車牌號"],
  ["driver1", "駕駛人 1"],
  ["driver2", "駕駛人 2"],
  ["driver3", "駕駛人 3"],
  ["currentApproval", "現批文號"],
  ["previousApproval", "原批文號"],
  ["color", "顏色"],
  ["seats", "座位／噸位"],
  ["purpose", "請予辦理"],
  ["validFrom", "有效期開始"],
  ["validTo", "有效期結束"],
  ["notes", "備註"],
].map(([key, label]) => ({ key, label }));
const todayLabel = new Intl.DateTimeFormat("zh-Hant", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
}).format(new Date());
const newCount = computed(
    () => requests.value.filter((r) => r.status === "新要求").length,
  ),
  activeCount = computed(
    () =>
      requests.value.filter(
        (r) => ['待開始', '進行中', '待客戶提供'].includes(r.status),
      ).length,
  ),
  filteredRequests = computed(() =>
    requests.value.filter(
      (r) =>
        (!statusFilter.value ||
          (statusFilter.value === "active"
            ? ['待開始', '進行中', '待客戶提供'].includes(r.status)
            : r.status === statusFilter.value)) &&
        `${r.title} ${r.customer_name} ${r.plate || ""}`
          .toLowerCase()
          .includes(search.value.toLowerCase()),
    ),
  ),
  customerVehicles = computed(() =>
    vehicles.value.filter((v) => v.customer_id === selectedCustomer.value?.id),
  ),
  customerPlates = computed(() =>
    plates.value.filter((p) => p.customer_id === selectedCustomer.value?.id),
  ),
  customerRequests = computed(() =>
    requests.value.filter((r) => r.customer_id === selectedCustomer.value?.id),
  ),
  selectedSources = computed(() =>
    sources.value.filter((s) =>
      selected.value?.plan?.sourceIds?.includes(s.id),
    ),
  ),
  selectedGuidance = computed(() => selected.value?.inspectionGuidance || []),
  modalTitle = computed(
    () =>
      ({
        customer: "新增客戶",
        "customer-user": "開通客戶登入",
        vehicle: "登記車輛",
        plate: "登記兩地牌",
        rental: "登記出租",
        inspection: "建立驗車任務",
      })[modal.value] || "操作",
  );
const priorityRequests = computed(() =>
  [...requests.value]
    .sort(
      (a, b) =>
        requestRank(a) - requestRank(b) ||
        String(b.updated_at).localeCompare(String(a.updated_at)),
    )
    .slice(0, 6),
);
const requestRank = (r) =>
  r.status === "新要求" ? 0 : r.status === "已完成" ? 2 : 1;
const focusTitle = computed(() =>
  newCount.value
    ? `有 ${newCount.value} 項新要求等待受理`
    : activeCount.value
      ? `有 ${activeCount.value} 個工單正在辦理`
      : "工單隊列已處理完成",
);
const focusDescription = computed(() =>
  newCount.value
    ? "請先核對客戶提交的業務類型、路線與資料，再安排下一步。"
    : activeCount.value
      ? "逐項更新辦理節點，讓客戶在用戶端看到準確進度。"
      : "可查看車輛牌證日期，或為客戶建立新的代辦工單。",
);
const statusTone = (status) =>
  status === "新要求" ? "amber" : status === "已完成" ? "gray" : "";
const serviceIcon = (code) =>
  ({
    new_application: FilePlus2,
    renewal: RefreshCcw,
    vehicle_change: ArrowLeftRight,
    inspection: ClipboardCheck,
  })[code] || FileText;
function goFilteredRequests(status) {
  statusFilter.value = status || "active";
  view.value = "business";
}
const todayDeadlines = computed(() => {
  const items = (overviewData.value.deadlines || []).filter(item => item.handler !== 'client');
  const visible = todayTab.value === "missing" ? items.filter((item) => item.level === "missing") : todayTab.value === "customer" ? requestDetails.value.flatMap((request) => (request.tasks || []).filter((task) => task.owner === 'client' && !['已完成', '不適用'].includes(task.status)).map((task) => ({ ...task, request }))) : todayTab.value === "active" ? requests.value.filter((request) => ['待開始', '進行中', '待客戶提供'].includes(request.status)) : items.filter((item) => ["overdue", "due"].includes(item.level));
  return visible.filter(item => todayOwnership.value === 'all' || Boolean(customers.value.find(customer => customer.id === (item.customerId || item.customer_id || item.request?.customer_id))?.is_self) === (todayOwnership.value === 'self')).filter(item => !todayCustomerId.value || item.customerId === todayCustomerId.value || item.customer_id === todayCustomerId.value || item.request?.customer_id === todayCustomerId.value);
});
const todayOwnership = ref('all');
const todayCounts = computed(() => ({
  overdue: (overviewData.value.deadlines || []).filter(item => item.handler !== 'client' && item.level === 'overdue').length,
  due: (overviewData.value.deadlines || []).filter((item) => item.handler !== 'client' && item.dueOn && item.daysLeft >= 0 && item.daysLeft <= 7).length,
  missing: (overviewData.value.deadlines || []).filter(item => item.handler !== 'client' && item.level === 'missing').length,
  active: requests.value.filter((request) => ['待開始', '進行中', '待客戶提供'].includes(request.status)).length,
}));
const customerRows = computed(() => {
  const term = customerSearch.value.trim().toLowerCase();
  return [...customers.value].sort((first, second) => Number(!!second.is_self) - Number(!!first.is_self)).filter((customer) => !term || `${customer.name} ${customer.kind}`.toLowerCase().includes(term)).map((customer) => {
    const entries = overviewData.value.customers?.find((item) => item.id === customer.id) || {};
    const customerPlates = plates.value.filter((plate) => plate.customer_id === customer.id);
    const groups = companyGroups.value.filter((group) => group.customer_id === customer.id);
    const next = (overviewData.value.deadlines || []).filter((item) => item.customerId === customer.id && item.dueOn).sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
    return { ...customer, plateCount: customerPlates.length, groupCount: groups.length, health: entries.health || "green", nextDue: next?.dueOn || "—" };
  });
});
const filteredPlateRows = computed(() => {
  const term = plateSearch.value.trim().toLowerCase();
  return plates.value.filter((plate) => {
    const text = `${plate.mainland_plate || ""} ${plate.local_plate || ""} ${customerName(plate.customer_id)} ${plate.route} ${plate.holder_company || ""}`.toLowerCase();
    const filterMatches = plateFilter.value === "all" || plateFilter.value === "attention" && ["overdue", "due"].includes(plate.health_status) || plateFilter.value === "rental" && plate.usage_status === "出租中" || plateFilter.value === "own" && plate.usage_status === "自用" || plateFilter.value === "empty" && plate.usage_status === "空置" || plateFilter.value === "missing" && plate.health_status === "missing";
    return filterMatches && (!term || text.includes(term));
  });
});
const allowedBulkRules = computed(() => {
  const selected = plates.value.filter(plate => selectedPlateIds.value.includes(plate.id));
  if (!selected.length) return ['hk_crp', 'mo_permit'];
  const routes = new Set(selected.map(plate => plate.route));
  return routes.size === 1 ? [routes.has('粵港') ? 'hk_crp' : 'mo_permit'] : [];
});
watch(allowedBulkRules, rules => { if (rules.length && !rules.includes(bulkRule.value)) bulkRule.value = rules[0] });
function openVehicleById(id) {
  const vehicle = vehicles.value.find((v) => v.id === id);
  if (vehicle) openVehicle(vehicle);
}
function openPlateById(id) {
  openPlate({ id });
}
function openDeadline(item) {
  if (item.ownerType === "company") {
    const customer = customers.value.find((entry) => entry.id === item.customerId);
    if (customer) {
      selectedCustomer.value = customer;
      customerTab.value = "companies";
      view.value = "customer-detail";
    }
  } else if (item.ownerType === "plate") openPlateById(item.ownerId);
  else openVehicle({ id: item.ownerId });
}
const date = (value) => (value ? String(value).slice(0, 10) : "—"),
  customerName = (id) =>
    customers.value.find((c) => c.id === id)?.name || "未找到客戶",
  serviceName = (code) =>
    services.value.find((s) => s.code === code)?.name || code,
  iconFor = (code) =>
    ({
      new_application: "＋",
      renewal: "↻",
      vehicle_change: "▰",
      driver_change: "♧",
      inspection: "◇",
      filing: "◎",
    })[code] || "▤";
async function refresh() {
  if (!account.value) return;
  try {
    const [c, v, p, r, cat, overview, groups, companies] = await Promise.all([
      api("/customers"),
      api("/vehicles"),
      api("/plate-assets?summary=1"),
      api("/work-orders"),
      api("/catalog"),
      api("/overview?days=90"),
      api('/company-groups'),
      api('/companies'),
    ]);
    customers.value = c;
    vehicles.value = v;
    plates.value = p;
    companyGroups.value = groups;
    companyRecords.value = companies;
    requests.value = r;
    overviewData.value = overview;
    services.value = cat.services;
    sources.value = cat.sources;
    requestDetails.value = await Promise.all(r.map((item) => api("/requests/" + item.id)));
    error.value = "";
  } catch (e) {
    if (e.status === 401) {
      clear();
      account.value = null;
      error.value = "登入已失效，請重新登入";
      router.replace({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } });
    } else error.value = e.message;
  }
}
async function login(options = {}) {
  if (loggingIn.value) return false;
  error.value = "";
  if (!loginForm.value.username || !loginForm.value.password) {
    error.value = "請輸入管理員帳號和密碼";
    return false;
  }
  loggingIn.value = true;
  try {
    const result = await api("/admin/login", "POST", loginForm.value);
    if (result.user.role !== "admin") throw new Error("此帳號不是管理員");
    await options.onAuthenticated?.();
    save(result, options.remember !== false);
    account.value = result.user;
    loginForm.value.password = "";
    await refresh();
    return true;
  } catch (e) {
    error.value = e.message;
    return false;
  } finally {
    loggingIn.value = false;
  }
}
function logout() {
  const redirect = router.currentRoute.value.fullPath;
  clear();
  account.value = null;
  router.replace({ path: '/login', query: { redirect } });
}
function navigate(id) {
  if (id === 'sources' || id === 'rules') {
    router.push(`/settings/${id}`);
    error.value = "";
    notice.value = "";
    return;
  }
  const aliases = { overview: "dashboard", companies: "customers", requests: "business", vehicles: "plates", rules: "settings", sources: "settings" };
  const target = aliases[id] || (navigation.some(item => item.id === id) ? id : 'dashboard');
  if (target === 'customers' && id === 'companies' && selectedCustomer.value) { customerTab.value = 'companies'; view.value = 'customer-detail' }
  else view.value = target;
  error.value = "";
  notice.value = "";
}
const viewPath = { dashboard: '/today', customers: '/customers', plates: '/plates', business: '/business', rentals: '/rentals', fees: '/fees', filings: '/filings', reports: '/reports', settings: '/settings', 'new-request': '/requests/new' };
let syncingRoute = false;
const routeReady = ref(false);
router.isReady().then(() => { routeReady.value = true; });
watch([view, () => selectedCustomer.value?.id, () => selectedPlate.value?.id, () => selectedVehicle.value?.id, () => selected.value?.id], ([target]) => {
  if (syncingRoute) return;
  const path = viewPath[target] || (target === 'customer-detail' && selectedCustomer.value && `/customers/${selectedCustomer.value.id}`) || (target === 'plate-detail' && selectedPlate.value && `/plates/${selectedPlate.value.id}`) || (target === 'vehicle-detail' && selectedVehicle.value && `/vehicles/${selectedVehicle.value.id}`) || (target === 'request-detail' && selected.value && `/requests/${selected.value.id}`);
  if (path && router.currentRoute.value.path !== path && !(target === 'settings' && router.currentRoute.value.path.startsWith('/settings/')) && !(target === 'reports' && router.currentRoute.value.path.startsWith('/reports/'))) router.push(path);
});
watch([() => router.currentRoute.value.fullPath, account, routeReady], async () => {
  const { name, params } = router.currentRoute.value;
  if (!account.value || !routeReady.value || name === 'login') return;
  syncingRoute = true;
  try {
    await refresh();
    if (name === 'customer-detail') {
      selectedCustomer.value = customers.value.find(item => String(item.id) === String(params.id)) || null;
      if (!selectedCustomer.value) throw new Error('找不到客戶');
    } else if (name === 'plate-detail' && !await openPlate({ id: params.id })) throw new Error('找不到牌照');
    else if (name === 'vehicle-detail' && !await openVehicle({ id: params.id })) throw new Error('找不到車輛');
    else if (name === 'request-detail' && !await openRequest({ id: params.id })) throw new Error('找不到工單');
    view.value = name === 'today' ? 'dashboard' : name === 'report-detail' ? 'reports' : ['customer-detail', 'plate-detail', 'vehicle-detail', 'request-detail'].includes(name) ? name : name || 'dashboard';
  } catch (cause) { showError(cause); view.value = 'dashboard'; await router.replace('/today'); }
  finally { syncingRoute = false; }
}, { immediate: true });
function showSuccess(message) {
  error.value = "";
  pushToast(message);
}
function showError(e) {
  notice.value = "";
  error.value = e.message || "操作失敗，請稍後重試";
  pushToast(error.value, 'danger');
}
async function openRequest(r) {
  try {
    selected.value = await api("/requests/" + r.id);
    editRequest.value = {
      status: selected.value.status,
      stage: selected.value.stage,
      note: "",
      assigneeId: selected.value.assignee_id || account.value?.id,
      dueOn: selected.value.due_on || '',
    };
    view.value = "request-detail";
    return true;
  } catch (e) {
    showError(e);
    return false;
  }
}
function openCustomer(c) {
  selectedCustomer.value = c;
  customerTab.value = "overview";
  view.value = "customer-detail";
}

async function createRequestFromDeadline(item) {
  if (item.handler === 'client') return showError(new Error('客戶自理事項不建立員工工單'));
  const company = item.ownerType === 'company' ? companyRecords.value.find(entry => entry.id === item.ownerId) : null;
  const plate = item.ownerType === "plate" ? plates.value.find((entry) => entry.id === item.ownerId) : company?.group_id ? plates.value.find(entry => entry.group_id === company.group_id && entry.customer_id === item.customerId) : null;
  const vehicle = item.ownerType === "vehicle" ? vehicles.value.find((entry) => entry.id === item.ownerId) : plate?.vehicle_id ? vehicles.value.find((entry) => entry.id === plate.vehicle_id) : null;
  const serviceCode = item.ruleCode === "inspection" ? "inspection" : ["approval", "hk_crp", "mo_permit"].includes(item.ruleCode) ? "renewal" : ["customs_filing", "new_card_filing"].includes(item.ruleCode) ? "filing" : "other";
  if (item.ownerType === 'plate' && !plate || item.ownerType === 'vehicle' && !vehicle) return showError(new Error('到期對象不存在'));
  newRequest.value = { customerId: item.customerId, vehicleId: vehicle?.id || '', plateAssetId: plate?.id || '', route: plate?.route || vehicle?.route || '粵港', serviceCode, title: `${item.name}代辦`, description: `由今日工作帶入；對象：${item.ownerLabel}` };
  view.value = 'new-request';
}
async function openVehicle(v) {
  try {
    selectedVehicle.value = await api("/vehicles/" + v.id);
    view.value = "vehicle-detail";
    return true;
  } catch (e) {
    showError(e);
    return false;
  }
}
async function openPlate(p) {
  try {
    selectedPlate.value = await api("/plate-assets/" + p.id);
    plateForm.value = {
      mainlandPlate: selectedPlate.value.mainland_plate || "",
      localPlate: selectedPlate.value.local_plate || "",
      installationStatus: selectedPlate.value.installation_status,
      usageStatus: selectedPlate.value.usage_status,
      vehicleId: selectedPlate.value.vehicle_id || "",
      cardNumber: selectedPlate.value.card_number || "",
      cardExpiresOn: selectedPlate.value.card_expires_on || "",
      notes: selectedPlate.value.notes || "",
      groupId: selectedPlate.value.group_id || "",
      indicatorCategory: selectedPlate.value.indicator_category || "",
      port: selectedPlate.value.port || "",
    };
    cardDraft.value = { ...(selectedPlate.value.cardData || {}) };
    view.value = "plate-detail";
    return true;
  } catch (e) {
    showError(e);
    return false;
  }
}
async function saveCard() {
  try {
    const p = await api("/plate-assets/" + selectedPlate.value.id, "PUT", {
      cardData: cardDraft.value,
    });
    selectedPlate.value = p;
    cardDraft.value = { ...p.cardData };
    cardFieldStatus.value = {};
    await refresh();
    showSuccess("模擬卡已儲存並標記為已核對");
  } catch (e) {
    showError(e);
  }
}
async function createPlate() {
  try {
    const b = form.value;
    const p = await api("/plate-assets", "POST", {
      ...b,
      cardData: {
        cardNumber: b.cardNumber,
        company: b.company,
        contractor: b.contractor,
        crossing: b.crossing,
        mainlandPlate: b.mainlandPlate,
        localPlate: b.localPlate,
        validTo: b.cardExpiresOn,
      },
    });
    modal.value = null;
    await refresh();
    await openPlate(p);
    showSuccess("兩地牌已登記");
  } catch (e) {
    showError(e);
  }
}
async function savePlate() {
  try {
    const p = await api(
      "/plate-assets/" + selectedPlate.value.id,
      "PATCH",
      plateForm.value,
    );
    await refresh();
    await openPlate(p);
    showSuccess("兩地牌資料已儲存");
  } catch (e) {
    showError(e);
  }
}
async function createRental() {
  try {
    await api("/plate-rentals", "POST", {
      ...form.value,
      plateAssetId: selectedPlate.value.id,
    });
    modal.value = null;
    await refresh();
    await openPlate(selectedPlate.value);
    showSuccess("出租記錄已建立");
  } catch (e) {
    showError(e);
  }
}
async function endRental(r) {
  try {
    await api("/plate-rentals/" + r.id, "PATCH", { status: "已結束" });
    await refresh();
    await openPlate(selectedPlate.value);
    showSuccess("出租記錄已結束");
  } catch (e) {
    showError(e);
  }
}
async function readImageFile(event) {
  const file = event.target.files?.[0];
  if (!file) return null;
  if (file.size > 3500000) throw new Error("圖片不可超過 3.5 MB");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("讀取圖片失敗"));
    reader.readAsDataURL(file);
  });
}
async function uploadCard(side, event) {
  try {
    const image = await readImageFile(event);
    if (!image) return;
    const result = await api(
      "/plate-assets/" + selectedPlate.value.id + "/card/" + side,
      "POST",
      { image },
    );
    await openPlate(selectedPlate.value);
    cardFieldStatus.value = result.fieldStatus || {};
    showSuccess(
      "批文卡" +
        (side === "front" ? "正面" : "背面") +
        "已辨識，請核對欄位後儲存",
    );
  } catch (e) {
    showError(e);
  } finally {
    event.target.value = "";
  }
}
function fieldStatusText(status) {
  return status?.status === "uncertain"
    ? "請核對"
    : status?.status === "failed"
      ? "未能辨識，請手動填寫"
      : "";
}
function fieldStatusClass(status) {
  return status?.status === "failed" ? "failed" : "uncertain";
}
async function uploadPlatePhoto(kind, event) {
  try {
    const image = await readImageFile(event);
    if (!image) return;
    await api(
      "/plate-assets/" + selectedPlate.value.id + "/photo/" + kind,
      "POST",
      { image },
    );
    await openPlate(selectedPlate.value);
    showSuccess("實體車牌照片已上傳");
  } catch (e) {
    showError(e);
  } finally {
    event.target.value = "";
  }
}
async function saveRequest() {
  try {
    await api("/requests/" + selected.value.id, "PATCH", editRequest.value);
    await refresh();
    await openRequest(selected.value);
    showSuccess("工單進度已儲存");
  } catch (e) {
    showError(e);
  }
}
async function updateTask(task, status) {
  try {
    await api("/tasks/" + task.id, "PATCH", { status });
    await openRequest(selected.value);
    showSuccess("辦理節點已更新");
  } catch (e) {
    showError(e);
    await openRequest(selected.value);
  }
}
async function updateInspection(item, status) {
  try {
    await api("/inspections/" + item.id, "PATCH", { status });
    await openVehicle(selectedVehicle.value);
    showSuccess("驗車狀態已更新");
  } catch (e) {
    showError(e);
    await openVehicle(selectedVehicle.value);
  }
}
async function createRequest() {
  try {
    const r = await api("/work-orders", "POST", newRequest.value);
    newRequest.value = {
      customerId: "",
      route: "粵港",
      serviceCode: "new_application",
      vehicleId: "",
      plateAssetId: "",
      title: "",
      description: "",
    };
    await refresh();
    await openRequest(r);
    showSuccess("工單已建立");
  } catch (e) {
    showError(e);
  }
}
function openPlateFromRequest() {
  if (
    !selected.value ||
    selected.value.service_code !== "new_application" ||
    selected.value.plate_asset_id
  )
    return;
  modal.value = "plate";
}
async function createCustomer() {
  try {
    await api("/customers", "POST", form.value);
    modal.value = null;
    form.value = {};
    await refresh();
    showSuccess("客戶已新增");
  } catch (e) {
    showError(e);
  }
}
async function createCustomerUser() {
  try {
    const details = { ...form.value, customerId: selectedCustomer.value.id };
    const created = await api("/customer-users", "POST", {
      ...details,
    });
    recentCustomerAccounts.value.unshift({ id: created.id, customerId: details.customerId, name: details.name, email: details.email || '', phone: details.phone || '' });
    modal.value = null;
    form.value = {};
    showSuccess("客戶登入已開通，請以安全渠道交付初始密碼");
    return { ...details, id: created.id };
  } catch (e) {
    showError(e);
    return null;
  }
}
async function createVehicle() {
  try {
    const v = await api("/vehicles", "POST", form.value);
    modal.value = null;
    form.value = {};
    await refresh();
    await openVehicle(v);
    showSuccess("車輛已登記");
  } catch (e) {
    showError(e);
  }
}
async function createInspection() {
  try {
    await api("/inspections", "POST", {
      ...form.value,
      vehicleId: selectedVehicle.value.id,
      requestId:
        selected?.value?.vehicle_id === selectedVehicle.value.id
          ? selected.value.id
          : null,
    });
    modal.value = null;
    form.value = {};
    await openVehicle(selectedVehicle.value);
    showSuccess("驗車任務已建立");
  } catch (e) {
    showError(e);
  }
}
function openInspectionForm() {
  if (!selected.value?.vehicle) return;
  openVehicle(selected.value.vehicle).then(() => {
    form.value = {};
    modal.value = "inspection";
  });
}
watch(modal, (value) => {
  error.value = "";
  if (value) {
    form.value =
      value === "vehicle"
        ? {
            customerId: selectedCustomer.value?.id || "",
            route: "粵港",
            origin: "香港",
            type: "私家車",
          }
        : value === "plate" &&
            view.value === "request-detail" &&
            selected.value?.service_code === "new_application" &&
            !selected.value.plate_asset_id
          ? {
              customerId: selected.value.customer_id,
              route: selected.value.route,
              sourceRequestId: selected.value.id,
            }
          : value === "plate"
            ? { customerId: selectedCustomer.value?.id || "", route: "粵港" }
            : value === "customer"
              ? { kind: "個人" }
              : {};
  }
});
watch(
  () => newRequest.value.route,
  (route) => {
    if (
      !services.value.some(
        (s) =>
          s.code === newRequest.value.serviceCode && s.routes.includes(route),
      )
    )
      newRequest.value.serviceCode =
        services.value.find((s) => s.routes.includes(route))?.code || "";
    newRequest.value.vehicleId = "";
    newRequest.value.plateAssetId = "";
  },
);
watch(
  () => newRequest.value.customerId,
  () => {
    newRequest.value.vehicleId = "";
    newRequest.value.plateAssetId = "";
  },
);
watch(
  () => newRequest.value.serviceCode,
  () => {
    newRequest.value.plateAssetId = "";
  },
);

export const adminStore = {
  navigation,
  account,
  view,
  companyCustomer,
  error,
  notice,
  loginForm,
  loggingIn,
  customers,
  vehicles,
  plates,
  companyGroups,
  companyRecords,
  requests,
  services,
  sources,
  search,
  statusFilter,
  selected,
  selectedCustomer,
  recentCustomerAccounts,
  customerTab,
  selectedVehicle,
  selectedPlate,
  plateForm,
  cardDraft,
  cardFieldStatus,
  modal,
  form,
  editRequest,
  newRequest,
  plateGroups,
  vehicleForm,
  saveVehicle,
  cardFields,
  todayLabel,
  newCount,
  activeCount,
  filteredRequests,
  overviewData,
  todayTab,
  todayCustomerId,
  todayOwnership,
  todayCounts,
  todayDeadlines,
  saveTrackedItem,
  saveBulkDates,
  previewPlateImport,
  confirmPlateImport,
  customerSearch,
  customerRows,
  plateFilter,
  plateSearch,
  filteredPlateRows,
  selectedPlateIds,
  bulkRule,
  allowedBulkRules,
  bulkDate,
  importPreview,
  importCsv,
  customerVehicles,
  customerPlates,
  customerRequests,
  selectedSources,
  selectedGuidance,
  modalTitle,
  priorityRequests,
  requestRank,
  focusTitle,
  focusDescription,
  statusTone,
  serviceIcon,
  goFilteredRequests,
  openVehicleById,
  openPlateById,
  openDeadline,
  createRequestFromDeadline,
  date,
  customerName,
  serviceName,
  iconFor,
  refresh,
  login,
  logout,
  navigate,
  showSuccess,
  showError,
  openRequest,
  openCustomer,
  openVehicle,
  openPlate,
  saveCard,
  createPlate,
  savePlate,
  createRental,
  endRental,
  readImageFile,
  uploadCard,
  fieldStatusText,
  fieldStatusClass,
  uploadPlatePhoto,
  saveRequest,
  updateTask,
  updateInspection,
  createRequest,
  openPlateFromRequest,
  createCustomer,
  createCustomerUser,
  createVehicle,
  createInspection,
  openInspectionForm,
  LayoutDashboard,
  FolderKanban,
  UsersRound,
  CarFront,
  BookOpenCheck,
  FilePlus2,
  RefreshCcw,
  ArrowLeftRight,
  ClipboardCheck,
  FileText,
  ShieldCheck,
  LogOut,
  ArrowUpRight,
  BellRing,
  Clock3,
  CalendarClock,
  BriefcaseBusiness,
  Settings2,
  Table2,
};
export function useAdminStore() {
  return adminStore;
}
