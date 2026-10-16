/* 移植自 scaffold-vue/src/composables/list.ts，已改：適配管理端現有陣列 API，不要求服務端分頁。 */
import { computed, ref, watch, type Ref } from 'vue'

export interface ListPageState {
  query: Record<string, unknown>
  rows: Ref<any[]>
  total: Ref<number>
  page: Ref<number>
  pageSize: Ref<number>
  loading: Ref<boolean>
  exporting: Ref<boolean>
  selected: Ref<(string | number)[]>
  load: () => Promise<void>
  search: () => Promise<void>
  reset: () => Promise<void>
  setPage: (page: number) => Promise<void>
  setPageSize: (size: number) => Promise<void>
  exportData: () => Promise<void>
  canExport: boolean
}

export function useListPage(source: Ref<any[]>, refresh: () => Promise<void>, selected = ref<(string | number)[]>([])): ListPageState {
  const page = ref(1)
  const pageSize = ref(10)
  const loading = ref(false)
  const exporting = ref(false)
  const total = computed(() => source.value.length)
  const rows = computed(() => source.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
  watch(total, value => { if (page.value > Math.max(1, Math.ceil(value / pageSize.value))) page.value = 1 })
  async function load() { loading.value = true; try { await refresh() } finally { loading.value = false } }
  async function search() { page.value = 1 }
  async function reset() { page.value = 1 }
  async function setPage(value: number) { page.value = value }
  async function setPageSize(value: number) { pageSize.value = value; page.value = 1 }
  async function exportData() {}
  return { query: {}, rows, total, page, pageSize, loading, exporting, selected, load, search, reset, setPage, setPageSize, exportData, canExport: false }
}
