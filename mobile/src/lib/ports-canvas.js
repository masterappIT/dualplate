// 口岸網絡畫布：節點緩慢呼吸，牌照黃脈衝沿連線往返；登入成功時由中心擴散。減少動態效果時只畫靜態一幀。
// H5、App 在畫面層（renderjs）用原生畫布畫；小程序在邏輯層取畫布節點來畫。三端共用這份程式，畫出來一致。
// 繪圖一律用 CSS 像素座標，呼叫方負責按像素比設定畫布大小和縮放。

// 外圈五角：深圳灣、沙頭角、拱北、橫琴、皇崗；蓮塘、文錦渡、港珠澳大橋在圈內。位置拉開，名字互不重疊。
// 第四欄是名字位置：預設寫在節點右上（靠右的寫左上）；above 寫在節點正上方，below 寫在正下方，right 寫在正右方（與節點同高），避開連線和脈衝
const PORTS = [['深圳灣', .08, .48, 'above'], ['蓮塘', .3, .26, 'above'], ['皇崗', .24, .96], ['沙頭角', .54, .04], ['港珠澳大橋', .52, .74, 'below'], ['拱北', .9, .32], ['橫琴', .8, .96], ['文錦渡', .6, .42, 'right']]
const LINKS = [[0, 1], [0, 2], [1, 3], [1, 7], [7, 4], [2, 4], [4, 5], [4, 6], [5, 6], [3, 5], [0, 4]]
// 只在主要的 8 條連線上跑脈衝，黃點少一些、不搶眼（略去 深圳灣—皇崗、蓮塘—文錦渡、拱北—橫琴）
const PULSE_LINKS = [0, 2, 4, 5, 6, 7, 9, 10]
// 脈衝折返時離節點中心至少這麼遠，不會疊在節點光暈上
const PULSE_GAP = 18

// top：口岸網絡可用範圍的頂邊（車牌示例下方）；bottom：登入卡片頂邊（手機蓋住畫布底部 48px，桌面 80px）。
// 節點和名字只排在兩者之間，不壓文字、不被卡片蓋住；量不到時按手機版預留
export function startPorts(ctx, width, height, { reduced = false, raf, caf, top = height * .44, bottom = height - 48 }) {
  let frame = 0, burstAt = 0, handle = null
  const bandBottom = Math.min(bottom, height) - 22, bandTop = Math.min(Math.max(top + 40, height * .3), bandBottom - 80), bandHeight = bandBottom - bandTop
  const pulses = PULSE_LINKS.map((index, i) => ({ link: LINKS[index], t: .2 + (i * 0.17) % .6, speed: 0.0025 + (i % 3) * 0.0012, dir: i % 2 ? 1 : -1 }))
  function draw() {
    frame++
    ctx.clearRect(0, 0, width, height)
    const pos = PORTS.map(([, x, y], i) => [x * width, bandTop + y * bandHeight + Math.sin(frame / 90 + i) * (reduced ? 0 : 3)])
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(227,239,234,.16)'
    for (const [a, b] of LINKS) { ctx.beginPath(); ctx.moveTo(...pos[a]); ctx.lineTo(...pos[b]); ctx.stroke() }
    if (!reduced) for (const p of pulses) {
      const [a, b] = p.link, dx = pos[b][0] - pos[a][0], dy = pos[b][1] - pos[a][1], gap = Math.min(.45, PULSE_GAP / Math.hypot(dx, dy))
      p.t += p.speed * p.dir; if (p.t > 1 - gap || p.t < gap) { p.dir *= -1; p.t = Math.min(1 - gap, Math.max(gap, p.t)) }
      const x = pos[a][0] + dx * p.t, y = pos[a][1] + dy * p.t
      ctx.fillStyle = 'rgba(242,194,48,.22)'; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#F2C230'; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill()
    }
    ctx.font = '12px -apple-system, "PingFang TC", sans-serif'
    PORTS.forEach(([name, , , place], i) => {
      const [x, y] = pos[i], breathe = reduced ? 0 : Math.sin(frame / 60 + i * 1.3) * 1.5
      ctx.fillStyle = 'rgba(227,239,234,.12)'; ctx.beginPath(); ctx.arc(x, y, 11 + breathe, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#E3EFEA'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill()
      // 靠右邊的口岸把名字寫在節點左邊，免得貼邊被切
      const left = x > width * .7
      ctx.fillStyle = 'rgba(227,239,234,.62)'
      if (place === 'right') { ctx.textAlign = 'left'; ctx.fillText(name, x + 16, y + 4) }
      else if (place) { ctx.textAlign = 'center'; ctx.fillText(name, Math.max(x, ctx.measureText(name).width / 2 + 4), place === 'above' ? y - 16 : y + 26) }
      else { ctx.textAlign = left ? 'right' : 'left'; ctx.fillText(name, left ? x - 14 : x + 14, y - 10) }
    })
    if (burstAt) {
      const k = Math.min(1, (frame - burstAt) / 40), cx = width / 2, cy = height * .7
      ctx.strokeStyle = `rgba(242,194,48,${1 - k})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, k * Math.max(width, height), 0, Math.PI * 2); ctx.stroke()
      if (k >= 1) burstAt = 0
    }
    if (!reduced) handle = raf(draw)
  }
  draw()
  return { burst() { burstAt = frame || 1 }, stop() { if (handle) caf(handle) } }
}
