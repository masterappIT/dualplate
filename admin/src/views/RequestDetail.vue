<template>
  <div class="page-heading">
    <div>
      <button class="back" @click="view = 'business'">← 返回業務</button>
      <div class="eyebrow">CASE DETAIL</div>
      <h1>{{ selected.title }}</h1>
      <p>
        {{ selected.route }} · {{ customerName(selected.customer_id) }} ·
        {{ selected.vehicle?.plate || "未指定車輛" }}
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
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>受理與進度</h2>
            <p>官方結果須按實際回執或證件更新</p>
          </div>
        </div>
        <div class="form-grid">
          <div>
            <label>案件狀態</label
            ><select v-model="editRequest.status">
              <option>新要求</option>
              <option>待資格核實</option>
              <option>待報價／授權</option>
              <option>待收件</option>
              <option>辦理中</option>
              <option>待客戶配合</option>
              <option>待交付</option>
              <option>已完成</option>
              <option>暫停</option>
            </select>
          </div>
          <div>
            <label>目前階段</label
            ><select v-model="editRequest.stage">
              <option>待內部受理</option>
              <option v-for="stage in selected.plan?.stages" :key="stage">
                {{ stage }}
              </option>
            </select>
          </div>
        </div>
        <label>更新說明</label
        ><textarea
          v-model="editRequest.note"
          placeholder="記錄客戶配合、官方回覆或下一步安排"
        ></textarea
        ><button class="button primary" @click="saveRequest">儲存進度</button>
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
            <p>客戶可看到與其案件相關的進度</p>
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
            <p>案件與現有兩地牌分開管理</p>
          </div>
        </div>
        <button
          v-if="selected.plateAsset"
          class="button outline full"
          @click="openPlate(selected.plateAsset)"
        >
          查看批文卡 {{ selected.plateAsset.card_number }} →</button
        ><template v-else-if="selected.service_code === 'new_application'"
          ><p class="description">取得正式批文卡後，從此案件建立兩地牌檔案。</p>
          <button class="button primary full" @click="openPlateFromRequest">
            批文卡已取得 · 建立檔案
          </button></template
        >
        <p v-else class="description">此案件尚未關聯兩地牌檔案。</p>
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
import { useAdminStore } from "../store";
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
</script>
