import { http, HttpResponse } from 'msw'
import { seedCues, seedMovers, seedProject, type Cue } from '../stores/workshop'
import { deepEqual, mergeCues } from '../sync/merge'
import type { OutboxBatch, SyncResponse } from '../sync/protocol'

/**
 * 模拟协作服务器：
 * - 保存每一次同步产生的版本历史，用客户端带来的 baseRev 做三方合并；
 * - 已处理的批次号留档，同号重传直接返回上次结果，不生成第二个版本；
 * - 支持 x-simulate-fail 头演练两类故障：未提交失败 / 已提交但响应丢失。
 */

let serverCues = structuredClone(seedCues)
let serverRev = 1
const revisionHistory = new Map<number, Cue[]>([[1, structuredClone(seedCues)]])
const processedBatches = new Map<string, SyncResponse>()

function commitBatch(body: OutboxBatch): SyncResponse | { status: number; message: string } {
  const base = revisionHistory.get(body.baseRev)
  if (!base) {
    return { status: 409, message: `服务器找不到基线版本 R${body.baseRev}，需要重新对齐` }
  }
  const { merged, conflicts } = mergeCues(base, body.cues, serverCues)
  if (!deepEqual(merged, serverCues)) {
    serverRev += 1
    serverCues = structuredClone(merged)
    revisionHistory.set(serverRev, structuredClone(merged))
  }
  const response: SyncResponse = {
    batchId: body.batchId,
    serverRev,
    syncedAt: new Date().toISOString(),
    cues: structuredClone(serverCues),
    conflicts,
  }
  processedBatches.set(body.batchId, response)
  return response
}

export const handlers = [
  http.get('/api/project', () => HttpResponse.json(seedProject)),
  http.get('/api/cues', () =>
    HttpResponse.json(
      serverCues.map((cue) => ({
        ...cue,
        conflict: cue.id === 'C-06' ? '此提示与道具运输时间重叠 4 分钟' : '',
      })),
    ),
  ),
  http.get('/api/sync/state', () => HttpResponse.json({ serverRev, cues: serverCues })),
  http.post('/api/cues/:id/comments', async ({ params, request }) => {
    const body = (await request.json()) as { author: string; content: string }
    const cue = serverCues.find((item) => item.id === params.id)
    if (!cue) return new HttpResponse(null, { status: 404 })
    cue.comments.push({
      id: `comment-${Date.now()}`,
      author: body.author,
      content: body.content,
      createdAt: new Date().toISOString(),
      resolved: false,
    })
    return HttpResponse.json(cue, { status: 201 })
  }),
  http.post('/api/sync', async ({ request }) => {
    const body = (await request.json()) as OutboxBatch
    const failMode = request.headers.get('x-simulate-fail')

    // 故障演练一：批次根本没到达/未提交，客户端保留批次重试
    if (failMode === '1') {
      return HttpResponse.json({ message: '模拟故障：批次未提交' }, { status: 503 })
    }

    // 同号重传：直接返回已处理结果，不生成第二个版本
    const cached = processedBatches.get(body.batchId)
    if (cached) {
      return HttpResponse.json({ ...structuredClone(cached), deduplicated: true })
    }

    const result = commitBatch(body)
    if ('status' in result) {
      return HttpResponse.json({ message: result.message }, { status: result.status })
    }

    // 故障演练二：批次已提交但响应丢失；客户端带同一 batchId 重试时会命中上面的去重分支
    if (failMode === 'after-commit') {
      return HttpResponse.json({ message: '模拟故障：响应丢失（批次已提交）' }, { status: 503 })
    }

    return HttpResponse.json(result)
  }),
]

export { seedMovers }
