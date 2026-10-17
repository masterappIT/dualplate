import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// 管理者查看客戶密碼（docs/requirements.md 5.6.2，2026-10-18 管理者決定）：登入仍用不可還原的密碼校驗；另存一份加密副本供管理者查看。
// 金鑰放在伺服器密鑰 PASSWORD_VIEW_KEY（32 bytes，base64），不在資料庫：資料庫或備份單獨外洩也看不到密碼。
// 正式環境沒有設定金鑰時不保存副本（查看時說明原因）；本機和測試用固定的開發金鑰。
function key() {
  const raw = process.env.PASSWORD_VIEW_KEY
  if (raw) {
    const buffer = Buffer.from(raw, 'base64')
    return buffer.length === 32 ? buffer : null
  }
  return process.env.NODE_ENV === 'production' ? null : createHash('sha256').update('dualplate-local-password-view').digest()
}

export const vaultReady = () => Boolean(key())

// 回傳可存進 users.password_enc 的字串；沒有金鑰時回傳 null
export function seal(password) {
  const secret = key()
  if (!secret || typeof password !== 'string') return null
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, iv)
  const data = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':')
}

// 解不開（沒有金鑰、金鑰已更換或內容損壞）時回傳 null
export function unseal(sealed) {
  const secret = key()
  if (!secret || typeof sealed !== 'string') return null
  const [version, iv, tag, data] = sealed.split(':')
  if (version !== 'v1' || !iv || !tag || !data) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
  } catch { return null }
}
