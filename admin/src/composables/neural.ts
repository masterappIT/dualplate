export interface NetworkPalette {
  line: string
  node: string
  pulse: string
  label: string
}

export function readNetworkPalette(element: Element): NetworkPalette {
  const styles = getComputedStyle(element)
  const value = (name: string) => styles.getPropertyValue(name).trim()
  return {
    line: value('--canvas-line'),
    node: value('--canvas-secondary'),
    pulse: value('--canvas-tick'),
    label: value('--canvas-ink'),
  }
}

export function paintNetworkNode(context: CanvasRenderingContext2D, x: number, y: number, radius: number, name: string, palette: NetworkPalette, seal = false) {
  if (seal) {
    context.strokeStyle = palette.node
    context.lineWidth = 1
    context.beginPath()
    context.arc(x, y, radius + 4, 0, Math.PI * 2)
    context.stroke()
  }
  context.fillStyle = palette.node
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()
  context.font = '12px -apple-system, PingFang TC, sans-serif'
  context.textAlign = 'center'
  context.fillStyle = palette.label
  context.fillText(name, x, y + 20)
}
