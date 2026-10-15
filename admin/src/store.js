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
} from "@lucide/vue";
import { api, save, clear, user } from "./api";
const navigation = [
  { id: "overview", name: "管理總覽", icon: LayoutDashboard },
  { id: "dashboard", name: "案件工作台", icon: LayoutDashboard },
  { id: "companies", name: "公司與指標", icon: UsersRound },
  { id: "rules", name: "規則設定", icon: ClipboardCheck },
  { id: "requests", name: "代辦案件", icon: FolderKanban },
  { id: "customers", name: "客戶管理", icon: UsersRound },
  { id: "vehicles", name: "車輛與牌證", icon: CarFront },
  { id: "sources", name: "官方來源", icon: BookOpenCheck },
];
const account = ref(user()),
  view = ref("overview"),
  companyCustomer = ref(""),
  error = ref(""),
  notice = ref(""),
  loginForm = ref({ username: "", password: "" }),
  loggingIn = ref(false),
  customers = ref([]),
  vehicles = ref([]),
  plates = ref([]),
  requests = ref([]),
  services = ref([]),
  sources = ref([]),
  search = ref(""),
  statusFilter = ref(""),
  selected = ref(null),
  selectedCustomer = ref(null),
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
  vehicleForm = ref({});
watch(selectedPlate, async (plate) => {
  if (!plate) return;
  try {
    plateGroups.value = await api(
      "/company-groups?customerId=" + encodeURIComponent(plate.customer_id),
    );
    Object.assign(plateForm.value, {
      groupId: plate.group_id || "",
      indicatorCategory: plate.indicator_category || "",
      port: plate.port || "",
    });
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
const credentialRecords = ref([]);
const newCount = computed(
    () => requests.value.filter((r) => r.status === "新要求").length,
  ),
  activeCount = computed(
    () =>
      requests.value.filter(
        (r) => r.status !== "已完成" && r.status !== "新要求",
      ).length,
  ),
  filteredRequests = computed(() =>
    requests.value.filter(
      (r) =>
        (!statusFilter.value ||
          (statusFilter.value === "active"
            ? r.status !== "已完成" && r.status !== "新要求"
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
        credential: "新增牌證",
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
const dueCredentials = computed(() =>
  credentialRecords.value
    .filter((c) => c.status === "已核對" && c.expires_on)
    .map((c) => ({
      ...c,
      days: Math.ceil(
        (new Date(c.expires_on + "T00:00:00") - new Date()) / 86400000,
      ),
    }))
    .filter((c) => Number.isFinite(c.days) && c.days <= 120)
    .sort((a, b) => a.days - b.days),
);
const focusTitle = computed(() =>
  newCount.value
    ? `有 ${newCount.value} 項新要求等待受理`
    : activeCount.value
      ? `有 ${activeCount.value} 個案件正在辦理`
      : "案件隊列已處理完成",
);
const focusDescription = computed(() =>
  newCount.value
    ? "請先核對客戶提交的業務類型、路線與資料，再安排下一步。"
    : activeCount.value
      ? "逐項更新辦理節點，讓客戶在用戶端看到準確進度。"
      : "可查看車輛牌證日期，或為客戶建立新的代辦案件。",
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
  view.value = "requests";
}
function openVehicleById(id) {
  const vehicle = vehicles.value.find((v) => v.id === id);
  if (vehicle) openVehicle(vehicle);
}
function openPlateById(id) {
  openPlate({ id });
}
function openDeadline(item) {
  if (item.ownerType === "company") {
    companyCustomer.value = item.customerId;
    view.value = "companies";
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
    const [c, v, p, r, cat] = await Promise.all([
      api("/customers"),
      api("/vehicles"),
      api("/plate-assets"),
      api("/requests"),
      api("/catalog"),
    ]);
    customers.value = c;
    vehicles.value = v;
    plates.value = p;
    requests.value = r;
    services.value = cat.services;
    sources.value = cat.sources;
    const details = await Promise.all(
      v.map((item) => api("/vehicles/" + item.id)),
    );
    credentialRecords.value = details.flatMap((item) =>
      (item.credentials || []).map((c) => ({
        ...c,
        plate: item.plate,
        vehicleId: item.id,
      })),
    );
    error.value = "";
  } catch (e) {
    if (e.status === 401) {
      clear();
      account.value = null;
      error.value = "登入已失效，請重新登入";
    } else error.value = e.message;
  }
}
async function login() {
  if (loggingIn.value) return;
  error.value = "";
  if (!loginForm.value.username || !loginForm.value.password) {
    error.value = "請輸入管理員帳號和密碼";
    return;
  }
  loggingIn.value = true;
  try {
    const result = await api("/admin/login", "POST", loginForm.value);
    if (result.user.role !== "admin") throw new Error("此帳號不是管理員");
    save(result);
    account.value = result.user;
    loginForm.value.password = "";
    await refresh();
  } catch (e) {
    error.value = e.message;
  } finally {
    loggingIn.value = false;
  }
}
function logout() {
  clear();
  account.value = null;
  view.value = "overview";
}
function navigate(id) {
  view.value = id;
  error.value = "";
  notice.value = "";
}
function showSuccess(message) {
  error.value = "";
  notice.value = message;
}
function showError(e) {
  notice.value = "";
  error.value = e.message || "操作失敗，請稍後重試";
}
async function openRequest(r) {
  try {
    selected.value = await api("/requests/" + r.id);
    editRequest.value = {
      status: selected.value.status,
      stage: selected.value.stage,
      note: "",
    };
    view.value = "request-detail";
  } catch (e) {
    showError(e);
  }
}
function openCustomer(c) {
  selectedCustomer.value = c;
  view.value = "customer-detail";
}
async function openVehicle(v) {
  try {
    selectedVehicle.value = await api("/vehicles/" + v.id);
    view.value = "vehicle-detail";
  } catch (e) {
    showError(e);
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
    };
    cardDraft.value = { ...(selectedPlate.value.cardData || {}) };
    view.value = "plate-detail";
  } catch (e) {
    showError(e);
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
    showSuccess("案件進度已儲存");
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
    const r = await api("/requests", "POST", newRequest.value);
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
    showSuccess("案件已建立");
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
    await api("/customer-users", "POST", {
      ...form.value,
      customerId: selectedCustomer.value.id,
    });
    modal.value = null;
    form.value = {};
    showSuccess("客戶登入已開通，請以安全渠道交付初始密碼");
  } catch (e) {
    showError(e);
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
async function createCredential() {
  try {
    await api("/credentials", "POST", {
      ...form.value,
      vehicleId: selectedVehicle.value.id,
    });
    modal.value = null;
    form.value = {};
    await openVehicle(selectedVehicle.value);
    await refresh();
    showSuccess("牌證已新增，待專員核對");
  } catch (e) {
    showError(e);
  }
}
async function updateCredential(item, status) {
  try {
    await api("/credentials/" + item.id, "PATCH", { status });
    await openVehicle(selectedVehicle.value);
    await refresh();
    showSuccess("牌證狀態已更新");
  } catch (e) {
    showError(e);
    await openVehicle(selectedVehicle.value);
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
  requests,
  services,
  sources,
  search,
  statusFilter,
  selected,
  selectedCustomer,
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
  credentialRecords,
  newCount,
  activeCount,
  filteredRequests,
  customerVehicles,
  customerPlates,
  customerRequests,
  selectedSources,
  selectedGuidance,
  modalTitle,
  priorityRequests,
  requestRank,
  dueCredentials,
  focusTitle,
  focusDescription,
  statusTone,
  serviceIcon,
  goFilteredRequests,
  openVehicleById,
  openPlateById,
  openDeadline,
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
  createCredential,
  updateCredential,
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
};
export function useAdminStore() {
  return adminStore;
}
