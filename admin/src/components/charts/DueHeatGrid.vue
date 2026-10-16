<script setup lang="ts">
import { computed, ref } from 'vue'
const props = defineProps<{ deadlines: any[] }>()
const emit = defineEmits<{ (event: 'date', date: string): void; (event: 'overdue'): void }>()
const hover = ref<number | null>(null)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
const overdue = computed(() => props.deadlines.filter(item => item.handler !== 'client' && item.dueOn?.slice(0, 10) < today).length)
const start = new Date(`${today}T12:00:00Z`)
start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7)
// 7 天內到期用琥珀，更遠的用綠色；沒有事項的日子不上色
const week = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10)
const days = computed(() => Array.from({ length: 84 }, (_, index) => { const date = new Date(start); date.setUTCDate(date.getUTCDate() + index); const key = date.toISOString().slice(0, 10); const entries = props.deadlines.filter(item => item.handler !== 'client' && item.dueOn?.slice(0, 10) === key && key >= today); return { date: key, count: entries.length, today: key === today, past: key < today, tone: !entries.length ? 'none' : entries.some(item => item.level === 'overdue') ? 'overdue' : key <= week ? 'due' : 'ok' } }))
</script>
<template><div class="due-heat"><div class="heat-head"><span>未來 12 週 · 到期日曆</span><span>{{ hover == null ? '點擊日期篩選列表' : `${days[hover].date} · ${days[hover].count} 項` }}</span></div><button v-if="overdue" class="heat-overdue" @click="emit('overdue')">已逾期 {{ overdue }} 項 →</button><div class="heat-grid"><span class="heat-week-spacer" aria-hidden="true" /><span v-for="(weekday, index) in ['一', '二', '三', '四', '五', '六', '日']" :key="weekday" class="heat-weekday" :style="{ gridColumn: index + 2 }">{{ weekday }}</span><template v-for="(day, index) in days" :key="day.date"><span v-if="index % 7 === 0" class="heat-week-start">{{ day.date.slice(5) }}</span><button :class="['heat-day-cell', `tone-${day.tone}`, { 'is-cross': hover != null && (Math.floor(hover / 7) === Math.floor(index / 7) || hover % 7 === index % 7), 'is-today': day.today, 'is-past': day.past }]" :aria-label="`${day.date}${day.today ? '，今天' : ''}，${day.count} 項到期`" :title="`${day.date} · ${day.count} 項`" :disabled="day.past" @pointerenter="hover = index" @focus="hover = index" @click="emit('date', day.date)">{{ day.today ? '今' : day.date.slice(8) }}<small v-if="day.count" class="heat-count">{{ day.count }}<span class="heat-unit"> 項</span></small></button></template></div><p v-if="!deadlines.some(item => item.dueOn)" class="empty">目前沒有已設定日期的到期事項。</p></div></template>
