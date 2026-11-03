#!/usr/bin/env node
// 用 App Store Connect API 建立發佈證書和 App Store 描述檔，供 GitHub Actions 簽名（兩者都是一年到期，到期重跑）
// 用法：ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=… node ios/create-signing.mjs <倉庫以外的輸出資料夾>
// 只建立新的，不會撤銷任何現有證書。輸出 dist.p12、dist.p12.password、profile.mobileprovision，不印出內容
import { createPrivateKey, randomBytes, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BUNDLE_ID = 'com.masterappinc.dualplate', PROFILE_NAME = 'dualplate-appstore-ci'
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = process.env
const out = process.argv[2]
if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_PATH || !out) { console.error('缺少 ASC_KEY_ID、ASC_ISSUER_ID、ASC_KEY_PATH 或輸出資料夾'); process.exit(1) }
mkdirSync(out, { recursive: true, mode: 0o700 })

const b64url = value => Buffer.from(value).toString('base64url')
function token() {
  const now = Math.floor(Date.now() / 1000)
  const body = `${b64url(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }))}`
  const signature = sign('sha256', Buffer.from(body), { key: createPrivateKey(readFileSync(ASC_KEY_PATH)), dsaEncoding: 'ieee-p1363' })
  return `${body}.${signature.toString('base64url')}`
}
async function api(path, payload) {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, { method: payload ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined })
  const result = await response.json()
  if (!response.ok) throw new Error(`${path} ${response.status}: ${result.errors?.map(error => error.detail || error.title).join('; ')}`)
  return result
}
// macOS 自帶的 openssl（LibreSSL）產生的 p12，security import 才讀得到
const openssl = (...args) => execFileSync('/usr/bin/openssl', args, { stdio: ['ignore', 'ignore', 'inherit'] })

const key = join(out, 'dist.key'), csr = join(out, 'dist.csr'), cer = join(out, 'dist.cer'), pem = join(out, 'dist.pem')
openssl('genrsa', '-out', key, '2048')
openssl('req', '-new', '-key', key, '-out', csr, '-subj', '/CN=dualplate CI/O=YU6GT6HQJ8')

const certificate = (await api('/v1/certificates', { data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent: readFileSync(csr, 'utf8') } } })).data
writeFileSync(cer, Buffer.from(certificate.attributes.certificateContent, 'base64'))
openssl('x509', '-inform', 'DER', '-in', cer, '-out', pem)
const password = randomBytes(24).toString('hex')
writeFileSync(join(out, 'dist.p12.password'), password, { mode: 0o600 })
openssl('pkcs12', '-export', '-inkey', key, '-in', pem, '-out', join(out, 'dist.p12'), '-passout', `file:${join(out, 'dist.p12.password')}`)

const bundle = (await api(`/v1/bundleIds?filter[identifier]=${BUNDLE_ID}&filter[platform]=IOS`)).data.find(item => item.attributes.identifier === BUNDLE_ID)
if (!bundle) throw new Error(`找不到 App ID ${BUNDLE_ID}`)
const profile = (await api('/v1/profiles', { data: { type: 'profiles', attributes: { name: PROFILE_NAME, profileType: 'IOS_APP_STORE' }, relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } }, certificates: { data: [{ type: 'certificates', id: certificate.id }] } } } })).data
writeFileSync(join(out, 'profile.mobileprovision'), Buffer.from(profile.attributes.profileContent, 'base64'))
console.log(`已建立發佈證書（${certificate.attributes.expirationDate} 到期）和描述檔 ${PROFILE_NAME}（${profile.attributes.expirationDate} 到期）`)
