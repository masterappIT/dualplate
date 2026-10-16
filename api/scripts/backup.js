// 每日備份（docs/tasks/production-brief.md 第 1 節）：用 SQLite 線上備份輸出到 BACKUP_DIR，保留 30 天。
// 用法：npm run backup（排程：每日由 cron 或 systemd timer 執行一次，見 docs/deploy.md）
import { DatabaseSync, backup } from 'node:sqlite'
import { mkdirSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

export async function runBackup({ source = process.env.DB_PATH || resolve(import.meta.dirname, '../data/app.sqlite'), dir = process.env.BACKUP_DIR, keepDays = Number(process.env.BACKUP_KEEP_DAYS || 30) } = {}) {
  if (!dir) throw new Error('請設定 BACKUP_DIR（備份資料夾）')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(dir, `app-${stamp}.sqlite`)
  const db = new DatabaseSync(source, { readOnly: true })
  try { await backup(db, target) } finally { db.close() }
  // 確認備份可開啟且完整
  const check = new DatabaseSync(target, { readOnly: true })
  try { if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('備份檔完整性檢查失敗') } finally { check.close() }
  const cutoff = Date.now() - keepDays * 86400000
  const removed = []
  for (const name of readdirSync(dir)) if (/^app-.*\.sqlite$/.test(name) && statSync(join(dir, name)).mtimeMs < cutoff) { rmSync(join(dir, name)); removed.push(name) }
  return { file: target, removed }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBackup().then(result => console.log(`備份完成：${result.file}${result.removed.length ? `；已刪除 ${result.removed.length} 份超過保留期的備份` : ''}`)).catch(error => { console.error(`備份失敗：${error.message}`); process.exit(1) })
}
