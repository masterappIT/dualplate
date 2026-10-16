<template>
  <div class="page-heading">
    <div>
      <button class="back" @click="view = 'business'">← 返回業務</button>
      <h1>{{ selected.title }}</h1>
      <p>
        {{ selected.route }} · {{ customerName(selected.customer_id) }} ·
        <PlateChip v-if="selected.vehicle?.plate" :plate="selected.vehicle.plate" :route="selected.route" /><span v-else>未指定車輛</span>
      </p>
    </div>
    <span
      class="badge large"
      :class="selected.status === '新要求' ? 'amber' : ''"
      >{{ selected.status }}</span
    >
  </div>
  <div class="detail-grid">
    <div>
      <section class="panel"><div class="panel-head"><div><h2>工單摘要</h2><p>客戶、路線與關聯車輛。</p></div></div><KeyValue :items="[{ label: '客戶', value: customerName(selected.customer_id) }, { label: '路線', value: selected.route }, { label: '車輛', value: selected.vehicle?.plate || '未指定' }, { label: '目前階段', value: selected.stage }]" /></section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>受理與進度</h2>
            <p>官方結果須按實際回執或證件更新</p>
          </div>
        </div>
        <div class="form-grid">
          <Field label="工單狀態"><Select v-model="editRequest.status" :options="statusOptions" /></Field>
          <Field label="目前階段"><Select v-model="editRequest.stage" :options="stageOptions" /></Field>
        </div>
        <Field label="更新說明"><TextInput v-model="editRequest.note" multiline placeholder="記錄客戶配合、官方回覆或下一步安排" /></Field>
        <Button variant="primary" @click="saveRequest">儲存進度</Button>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>辦理節點</h2>
            <p>分別核對內地、香港／澳門的步驟</p>
          </div>
        </div>
        <div v-for="task in selected.tasks" :key="task.id" class="task-row">
          <span
            class="task-number"
            :class="task.status === '已完成' ? 'done' : ''"
            >{{ task.status === "已完成" ? "✓" : "○" }}</span
          >
          <div class="task-main">
            <strong>{{ task.title }}</strong
            ><small
              >{{ task.jurisdiction }} ·
              {{ task.source_id || "待確認官方來源" }}</small
            >
          </div>
          <select
            :value="task.status"
            @change="updateTask(task, $event.target.value)"
          >
            <option>待辦</option>
            <option>待官方核實</option>
            <option>辦理中</option>
            <option>待客戶配合</option>
            <option>已完成</option>
            <option>不適用</option>
          </select>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>更新紀錄</h2>
            <p>客戶可看到與其工單相關的進度</p>
          </div>
        </div>
        <div v-for="a in selected.activities" :key="a.id" class="activity-row">
          <span class="activity-dot"></span>
          <div>
            <strong>{{ a.detail }}</strong
            ><small
              >{{ a.actor_name || "系統" }} · {{ date(a.created_at) }}</small
            >
          </div>
        </div>
      </section>
    </div>
    <div>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>關聯兩地牌</h2>
            <p>工單與現有兩地牌分開管理</p>
          </div>
        </div>
        <button
          v-if="selected.plateAsset"
          class="button outline full"
          @click="openPlate(selected.plateAsset)"
        >
          查看批文卡 {{ selected.plateAsset.card_number }} →</button
        ><template v-else-if="selected.service_code === 'new_application'"
          ><p class="description">取得正式批文卡後，從此工單建立兩地牌檔案。</p>
          <button class="button primary full" @click="openPlateFromRequest">
            批文卡已取得 · 建立檔案
          </button></template
        >
        <p v-else class="description">此工單尚未關聯兩地牌檔案。</p>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>客戶需求</h2>
            <p>提交內容</p>
          </div>
        </div>
        <p class="description">{{ selected.description || "未填寫說明" }}</p>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>官方依據</h2>
            <p>僅列此服務線適用的官方來源</p>
          </div>
        </div>
        <a
          v-for="source in selectedSources"
          :key="source.id"
          class="source-link"
          :href="source.url"
          target="_blank"
          rel="noopener"
          ><strong>{{ source.title }}</strong
          ><small>{{ source.agency }} · 核對 {{ source.checkedAt }}</small
          ><span>↗</span></a
        >
        <div v-if="!selectedSources.length" class="empty">
          此類要求需先人工確認官方指引
        </div>
      </section>
      <section v-if="selected.vehicle" class="panel">
        <div class="panel-head">
          <div>
            <h2>驗車提示</h2>
            <p>須按車輛類型和業務核對</p>
          </div>
        </div>
        <div v-for="g in selectedGuidance" :key="g.label" class="guidance">
          <span class="badge" :class="g.state === 'required' ? 'amber' : ''">{{
            g.state === "required"
              ? "須辦"
              : g.state === "review"
                ? "待核實"
                : "條件式"
          }}</span
          ><span
            >{{ g.label }}
            <a
              v-if="g.sourceId"
              :href="sources.find((s) => s.id === g.sourceId)?.url"
              target="_blank"
              rel="noopener"
              >官方依據 ↗</a
            ></span
          >
        </div>
        <button class="button outline full" @click="openInspectionForm">
          ＋ 建立驗車任務
        </button>
      </section>
    </div>
  </div>
</template>
<script setup>
import { computed } from 'vue'
import { useAdminStore } from "../store";
import Field from '../components/ui/Field.vue'
import Select from '../components/ui/Select.vue'
import TextInput from '../components/ui/TextInput.vue'
import Button from '../components/ui/Button.vue'
import PlateChip from '../components/ui/PlateChip.vue'
import KeyValue from '../components/ui/KeyValue.vue'
const {
  view,
  selected,
  customerName,
  editRequest,
  saveRequest,
  date,
  updateTask,
  openPlate,
  openPlateFromRequest,
  selectedSources,
  selectedGuidance,
  sources,
  openInspectionForm,
} = useAdminStore();
const statusOptions = ['新要求', '待資格核實', '待報價／授權', '待收件', '辦理中', '待客戶配合', '待交付', '已完成', '暫停']
const stageOptions = computed(() => ['待內部受理', ...(selected.value?.plan?.stages || [])])
</script>
