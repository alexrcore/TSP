export interface GraphNode {
  id: string
  weight: number
  label?: string
}

export interface GraphEdge {
  source: string
  target: string
  weight: number
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  start?: string
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
}

export function parseGraph(text: string): GraphData {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This file isn’t valid JSON.')
  }
  if (!record(data) || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error('The JSON needs a nodes array and an edges array.')
  }

  const ids = new Set<string>()
  const nodes = data.nodes.map((node: unknown, index): GraphNode => {
    const id = record(node) ? readId(node.id) : undefined
    if (!id || !record(node)) throw new Error(`Node ${index + 1} needs an ID.`)
    if (ids.has(id)) throw new Error(`Node ID ${id} appears more than once.`)
    const weight = node.weight === undefined ? 1 : node.weight
    if (typeof weight !== 'number' || !Number.isFinite(weight)) {
      throw new Error(`Node ${id} needs a numeric weight.`)
    }
    ids.add(id)
    return { id, weight, label: typeof node.label === 'string' && node.label.trim() ? node.label : undefined }
  })

  const edges = data.edges.map((edge: unknown, index): GraphEdge => {
    if (!record(edge)) throw new Error(`Edge ${index + 1} needs a source and target.`)
    const source = readId(edge.source)
    const target = readId(edge.target)
    if (!source || !target || !ids.has(source) || !ids.has(target)) {
      throw new Error(`Edge ${index + 1} must connect existing node IDs.`)
    }
    const weight = edge.weight === undefined ? 1 : edge.weight
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      throw new Error(`Edge ${index + 1} needs a nonnegative weight.`)
    }
    return { source, target, weight }
  })

  const start = data.start === undefined ? nodes[0]?.id : readId(data.start)
  if (data.start !== undefined && (!start || !ids.has(start))) {
    throw new Error('The start node must be an existing node ID.')
  }
  return { nodes, edges, start }
}
