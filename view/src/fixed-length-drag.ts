import type { Layout, Point } from './layout'

type Distance = { from: number; to: number; length: number }
const tolerance = 0.00005

function project(points: Point[], constraints: Distance[], anchor: number, handle: number, target: Point, fixedHandle: boolean) {
  const result = points.map((point) => ({ ...point }))
  result[handle] = { ...target }
  const mass = (index: number) => index === anchor ? 0 : index === handle ? (fixedHandle ? 0 : 0.25) : 1
  const links = constraints.map((edge) => ({ ...edge, a: mass(edge.from), b: mass(edge.to) }))
  const limit = Math.max(12, Math.min(260, Math.floor(26000 / links.length)))

  // Project each pair back to its original distance, keeping the anchor fixed.
  for (let step = 0; step < limit; step++) {
    let error = 0
    for (const { from, to, length, a, b } of links) {
      const p = result[from], q = result[to]
      const dx = q.x - p.x, dy = q.y - p.y
      const distance = Math.hypot(dx, dy)
      const residual = distance - length
      error = Math.max(error, Math.abs(residual))
      if (!distance || !residual || a + b === 0) continue
      const fraction = residual / (distance * (a + b))
      p.x += dx * fraction * a
      p.y += dy * fraction * a
      q.x -= dx * fraction * b
      q.y -= dy * fraction * b
    }
    if (error < tolerance / 2) break
  }
  const exactEnough = constraints.every(({ from, to, length }) =>
    Math.abs(Math.hypot(result[from].x - result[to].x, result[from].y - result[to].y) - length) < tolerance)
  return exactEnough ? result : null
}

export function fixedLengthDrag(layout: Layout, reference: Layout, handle: number) {
  let points = layout.nodes.map(({ x, y }) => ({ x, y }))
  const adjacent = layout.nodes.map(() => [] as number[])
  const links: Distance[] = []
  const pairs = new Set<string>()
  for (const { from, to } of layout.edges) {
    if (from === to || pairs.has(`${from},${to}`)) continue
    pairs.add(`${from},${to}`)
    adjacent[from].push(to)
    adjacent[to].push(from)
    const a = reference.nodes[from], b = reference.nodes[to]
    links.push({ from, to, length: Math.hypot(a.x - b.x, a.y - b.y) })
  }
  const component = [handle]
  const connected = new Set(component)
  for (const index of component) {
    for (const next of adjacent[index]) {
      if (connected.has(next)) continue
      connected.add(next)
      component.push(next)
    }
  }
  const constraints = links.filter(({ from }) => connected.has(from))
  const anchor = component.find((index) => index !== handle && layout.nodes[index].isStart) ?? component.at(-1)!

  return (target: Point) => {
    const current = points[handle]
    if (Math.hypot(current.x - target.x, current.y - target.y) < tolerance) return points
    if (!constraints.length) {
      points = points.map((point, index) => index === handle ? target : point)
      return points
    }

    const dx = target.x - current.x, dy = target.y - current.y
    const step = Math.min(1, 32 / Math.hypot(dx, dy))
    const goal = { x: current.x + dx * step, y: current.y + dy * step }
    const flexed = project(points, constraints, anchor, handle, goal, true)
      ?? project(points, constraints, anchor, handle, goal, false)
    if (flexed) {
      points = flexed
      return points
    }

    // A rigid component can still turn around its anchor without stretching.
    const center = points[anchor]
    const angle = Math.atan2(goal.y - center.y, goal.x - center.x)
      - Math.atan2(current.y - center.y, current.x - center.x)
    const cos = Math.cos(angle), sin = Math.sin(angle)
    points = points.map((point, index) => {
      if (!connected.has(index) || index === anchor) return point
      const x = point.x - center.x, y = point.y - center.y
      return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos }
    })
    return points
  }
}

