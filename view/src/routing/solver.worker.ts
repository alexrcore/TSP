import { runSolver } from './compare'
import type { SolverId } from './catalog'
import type { RoutingRequest } from './problem'

self.onmessage = ({ data }: MessageEvent<{ solver: SolverId; request: RoutingRequest }>) => {
  runSolver(data.solver, data.request).then(result => self.postMessage(result)).catch(() => self.postMessage({ status: 'error' }))
}
