// 批文卡對準框的畫面部分（鏡頭預覽、相片拖動縮放、截取框內卡面），只用瀏覽器 DOM。
// 網頁版由 CardCapture.vue 直接使用；App 版的邏輯層沒有 DOM，由 CardCapture.vue 的 renderjs 在視圖層（WebView）使用。
// 只上傳框內卡面連框外一圈（每邊 6%，固定 2274×1445 JPEG），伺服器再找卡的真正邊界（api/src/card-face.js）。
export const OUT_W = 2030, OUT_H = 1290, MARGIN = 0.06, FULL_W = Math.round(OUT_W * (1 + 2 * MARGIN)), FULL_H = Math.round(OUT_H * (1 + 2 * MARGIN))

// host：鋪滿畫面的容器；getFrame()：回傳畫面座標的框 { left, top, width, height }
export function createCardStage(host, getFrame) {
  let stream = null, video = null, img = null, view = { x: 0, y: 0, s: 1, min: 0.1 }, pointers = new Map(), pinch = null, generation = 0

  function clear() { host.innerHTML = ''; video = null; img = null; pointers.clear(); pinch = null }
  function stopCamera() { generation++; stream?.getTracks().forEach(track => track.stop()); stream = null }
  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera')
    const mine = ++generation
    const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } } })
    // 鏡頭開得太慢、期間已關閉或改用相片：關掉這次的鏡頭，不動畫面
    if (mine !== generation) { media.getTracks().forEach(track => track.stop()); throw new Error('cancelled') }
    stream = media
    clear()
    video = Object.assign(document.createElement('video'), { autoplay: true, muted: true, playsInline: true, srcObject: stream })
    video.setAttribute('playsinline', '')
    Object.assign(video.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' })
    host.appendChild(video)
    await video.play()
  }
  // 畫面座標的框（每邊外擴 6%）→ 原圖座標，畫到固定尺寸的截圖上（超出原圖的部分填白色）
  function crop(source, sx, sy, sw, sh) {
    const mx = sw * MARGIN, my = sh * MARGIN
    sx -= mx; sy -= my; sw += mx * 2; sh += my * 2
    const canvas = Object.assign(document.createElement('canvas'), { width: FULL_W, height: FULL_H }), ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, FULL_W, FULL_H)
    // 只畫和原圖重疊的部分（部分瀏覽器遇到超出原圖的來源範圍會整張不畫）
    const width = source.videoWidth || source.naturalWidth, height = source.videoHeight || source.naturalHeight
    const x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(width, sx + sw), y1 = Math.min(height, sy + sh), kx = FULL_W / sw, ky = FULL_H / sh
    if (x1 > x0 && y1 > y0) ctx.drawImage(source, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * kx, (y0 - sy) * ky, (x1 - x0) * kx, (y1 - y0) * ky)
    const data = canvas.toDataURL('image/jpeg', 0.9)
    return { data, path: data }
  }
  // 鏡頭還沒有畫面時回傳 null
  function shoot() {
    if (!video?.videoWidth) return null
    const box = host.getBoundingClientRect(), vw = video.videoWidth, vh = video.videoHeight
    const scale = Math.max(box.width / vw, box.height / vh), ox = (box.width - vw * scale) / 2, oy = (box.height - vh * scale) / 2
    const f = getFrame()
    return crop(video, (f.left - ox) / scale, (f.top - oy) / scale, f.width / scale, f.height / scale)
  }
  // 載入相片並放進框內；讀不了時 reject（這時鏡頭照常開着）
  function showImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => { stopCamera(); clear(); img = image; placeImage(); resolve() }
      image.onerror = () => reject(new Error('unreadable'))
      image.src = src
    })
  }
  // 相片先放大到剛好蓋滿框，之後可拖動、雙指縮放（電腦用滾輪）
  function placeImage() {
    const f = getFrame(), s = Math.max(f.width / img.naturalWidth, f.height / img.naturalHeight)
    view = { s, min: s * 0.5, x: f.left + (f.width - img.naturalWidth * s) / 2, y: f.top + (f.height - img.naturalHeight * s) / 2 }
    Object.assign(img.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', maxWidth: 'none', userSelect: 'none', pointerEvents: 'none' })
    host.appendChild(img); host.style.touchAction = 'none'
    host.onpointerdown = down; host.onpointermove = move; host.onpointerup = host.onpointercancel = up; host.onwheel = wheel
    paint()
  }
  function paint() { if (img) img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})` }
  function zoomAt(cx, cy, s) { s = Math.min(Math.max(s, view.min), view.min * 12); view.x = cx - (cx - view.x) * s / view.s; view.y = cy - (cy - view.y) * s / view.s; view.s = s; paint() }
  function down(event) { pointers.set(event.pointerId, [event.clientX, event.clientY]); host.setPointerCapture?.(event.pointerId) }
  function move(event) {
    if (!pointers.has(event.pointerId)) return
    const [px, py] = pointers.get(event.pointerId); pointers.set(event.pointerId, [event.clientX, event.clientY])
    if (pointers.size === 1) { view.x += event.clientX - px; view.y += event.clientY - py; return paint() }
    const [a, b] = [...pointers.values()], gap = Math.hypot(a[0] - b[0], a[1] - b[1]), cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2
    if (pinch) { view.x += cx - pinch.cx; view.y += cy - pinch.cy; zoomAt(cx, cy, view.s * gap / pinch.gap) }
    pinch = { gap, cx, cy }
  }
  function up(event) { pointers.delete(event.pointerId); if (pointers.size < 2) pinch = null }
  function wheel(event) { event.preventDefault(); zoomAt(event.clientX, event.clientY, view.s * (event.deltaY < 0 ? 1.08 : 1 / 1.08)) }
  // 截取框內相片；還沒有相片時回傳 null
  function confirm() {
    if (!img) return null
    const f = getFrame()
    return crop(img, (f.left - view.x) / view.s, (f.top - view.y) / view.s, f.width / view.s, f.height / view.s)
  }
  return { startCamera, stopCamera, clear, shoot, showImage, confirm, hasImage: () => !!img }
}
