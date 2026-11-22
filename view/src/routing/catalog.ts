import type { Solution } from './solver'

export type SolverId = 'cp-sat' | 'highs' | 'guided' | 'custom' | 'held-karp' | 'savings'
export type RunResult = (Solution | { status: 'unsupported' | 'error' }) & { startingPlan?: boolean }
export type RunState = Partial<Record<SolverId, RunResult | 'running'>>
export const labels: Record<SolverId, string> = {
  'cp-sat': 'OR-Tools CP-SAT', highs: 'HiGHS MIP', guided: 'Guided local search', custom: 'Custom search',
  'held-karp': 'Held–Karp', savings: 'Clarke–Wright savings',
}
export function solversFor(fleet: boolean): SolverId[] {
  return ['cp-sat', 'highs', fleet ? 'savings' : 'held-karp', 'guided', 'custom']
}
