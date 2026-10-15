<template>
  <div class="page-heading dashboard-heading">
    <div>
      <div class="eyebrow">OPERATIONS / 工作台</div>
      <h1>案件工作台</h1>
      <p>先處理客戶要求，再跟進案件節點與牌證日期。</p>
    </div>
    <button class="button primary heading-cta" @click="view = 'new-request'">
      <FilePlus2 :size="17" /> 建立案件
    </button>
  </div>
  <div class="dashboard-intro">
    <div class="dashboard-intro-main">
      <span class="intro-kicker"
        ><span class="live-dot"></span> 今日工作焦點</span
      >
      <h2>{{ focusTitle }}</h2>
      <p>{{ focusDescription }}</p>
      <div class="intro-actions">
        <button class="button intro-primary" @click="view = 'requests'">
          查看案件 <ArrowUpRight :size="16" /></button
        ><button class="button intro-secondary" @click="view = 'vehicles'">
          車輛與牌證
        </button>
      </div>
    </div>
    <div class="dashboard-intro-side">
      <span class="side-caption">工作隊列</span>
      <div>
        <strong>{{ newCount }}</strong
        ><span>待受理要求</span>
      </div>
      <div>
        <strong>{{ activeCount }}</strong
        ><span>辦理中案件</span>
      </div>
      <div>
        <strong>{{ dueCredentials.length }}</strong
        ><span>120 天內到期牌證</span>
      </div>
    </div>
  </div>
  <div class="metrics">
    <button class="metric metric-action" @click="goFilteredRequests('新要求')">
      <span class="metric-top"
        ><span class="metric-label">待受理要求</span
        ><BellRing :size="18" /></span
      ><strong>{{ newCount }}</strong
      ><small>查看客戶新提交的需求 <ArrowUpRight :size="14" /></small></button
    ><button class="metric metric-action" @click="goFilteredRequests('')">
      <span class="metric-top"
        ><span class="metric-label">辦理中案件</span><Clock3 :size="18" /></span
      ><strong>{{ activeCount }}</strong
      ><small>按進度跟進辦理節點 <ArrowUpRight :size="14" /></small></button
    ><button class="metric metric-action" @click="view = 'customers'">
      <span class="metric-top"
        ><span class="metric-label">客戶檔案</span
        ><UsersRound :size="18" /></span
      ><strong>{{ customers.length }}</strong
      ><small>查看聯絡與名下案件 <ArrowUpRight :size="14" /></small></button
    ><button class="metric metric-action" @click="view = 'vehicles'">
      <span class="metric-top"
        ><span class="metric-label">管理車輛</span><CarFront :size="18" /></span
      ><strong>{{ vehicles.length }}</strong
      ><small>查看牌證及驗車紀錄 <ArrowUpRight :size="14" /></small>
    </button>
  </div>
  <div class="dashboard-columns">
    <section class="panel queue-panel">
      <div class="panel-head">
        <div>
          <span class="section-kicker">CASE QUEUE</span>
          <h2>案件工作隊列</h2>
          <p>依待受理與最新更新排序</p>
        </div>
        <button class="text-button" @click="view = 'requests'">
          全部案件 <ArrowUpRight :size="15" />
        </button>
      </div>
      <div class="queue-head">
        <span>案件 / 客戶</span><span>目前階段</span><span>狀態</span>
      </div>
      <div v-if="!priorityRequests.length" class="empty">目前沒有案件</div>
      <button
        v-for="r in priorityRequests"
        :key="r.id"
        class="queue-row"
        @click="openRequest(r)"
      >
        <span class="queue-identity"
          ><span class="service-icon"
            ><component
              :is="serviceIcon(r.service_code)"
              :size="18"
              :stroke-width="1.8" /></span
          ><span
            ><strong>{{ r.title }}</strong
            ><small
              >{{ r.customer_name }} · {{ r.route }} ·
              {{ r.plate || "未指定車輛" }}</small
            ></span
          ></span
        ><span class="queue-stage">{{ r.stage }}</span
        ><span class="badge" :class="statusTone(r.status)">{{ r.status }}</span>
      </button>
    </section>
    <div class="dashboard-aside">
      <section class="panel due-panel">
        <div class="panel-head">
          <div>
            <span class="section-kicker">REMINDERS</span>
            <h2>牌證日期提醒</h2>
            <p>依檔案記錄；實際日期須再核對證件</p>
          </div>
        </div>
        <div v-if="!dueCredentials.length" class="clear-state">
          <span class="clear-state-icon"><ShieldCheck :size="20" /></span
          ><strong>目前沒有臨期牌證</strong
          ><small>已核對且 120 天內到期的牌證會顯示於此。</small>
        </div>
        <button
          v-for="c in dueCredentials.slice(0, 4)"
          :key="c.id"
          class="due-row"
          @click="openVehicleById(c.vehicleId)"
        >
          <span class="due-icon"><FileText :size="17" /></span
          ><span
            ><strong>{{ c.name }}</strong
            ><small>{{ c.plate }} · {{ c.expires_on }}</small></span
          ><span class="badge amber">{{
            c.days < 0 ? "已到期" : `${c.days} 天`
          }}</span>
        </button>
      </section>
      <section class="panel source-note">
        <span class="source-note-icon"><BookOpenCheck :size="18" /></span>
        <div>
          <strong>官方依據索引</strong>
          <p>案件節點的適用條件由專員按主管部門原始資料核對。</p>
          <button class="text-button" @click="view = 'sources'">
            查看來源 <ArrowUpRight :size="14" />
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
<script setup>
import { useAdminStore } from "../store";
import {
  FilePlus2,
  ArrowUpRight,
  BellRing,
  Clock3,
  UsersRound,
  CarFront,
  ShieldCheck,
  FileText,
} from "@lucide/vue";
const {
  view,
  focusTitle,
  focusDescription,
  newCount,
  activeCount,
  dueCredentials,
  goFilteredRequests,
  customers,
  vehicles,
  priorityRequests,
  serviceIcon,
  statusTone,
  openRequest,
  openVehicleById,
} = useAdminStore();
</script>
