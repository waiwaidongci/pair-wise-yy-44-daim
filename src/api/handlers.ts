import { http, HttpResponse } from 'msw'
import { seedCues, seedMovers, seedProject } from '../stores/workshop'
import type { Cue, SyncConflict } from '../stores/workshop'
import { threeWayMerge } from './merge'

let cues: Cue[] = structuredClone(seedCues)
let serverRevision = 100

// 已应用的同步批次：同号重传直接回放结果，不生成新版本
const appliedBatches = new Map<
  string,
  { revision: number; syncedAt: string; merged: Cue[]; conflicts: SyncConflict[] }
>()

// 模拟一位始终在线的协作同事，在服务器侧制造远端差异
const remoteEdits: Array<() => { cueId: string; description: string }> = [
  () => {
    const cue = cues.find((c) => c.id === 'C-01')!
    cue.note = `${cue.note}（远端同事补充：面光延长后，入场节奏需提前 2 秒）`
    return { cueId: 'C-01', description: '远端修改了执行说明' }
  },
  () => {
    const cue = cues.find((c) => c.id === 'C-01')!
    cue.time = '00:04:05'
    return { cueId: 'C-01', description: '远端调整了时间码' }
  },
  () => {
    const cue = cues.find((c) => c.id === 'C-02')!
    cue.status = '已确认'
    return { cueId: 'C-02', description: '远端确认了节点状态' }
  },
  () => {
    const cue = cues.find((c) => c.id === 'C-03')!
    cue.comments.push({
      id: `comment-remote-${Date.now()}`,
      author: '远端 · 王灯控',
      content: '远端留言：升降台启动前必须确认互锁信号。',
      createdAt: new Date().toISOString(),
      resolved: false,
    })
    return { cueId: 'C-03', description: '远端添加了一条部门留言' }
  },
  () => {
    const cue = cues.find((c) => c.id === 'C-04')!
    cue.duration = 26
    return { cueId: 'C-04', description: '远端修改了时长' }
  },
  () => {
    const cue = cues.find((c) => c.id === 'C-06')!
    cue.note = '远端更新：救生艇推入时间需与码头灯光避让。'
    return { cueId: 'C-06', description: '远端修改了执行说明' }
  },
]
let remoteEditIndex = 0

export const handlers = [
  http.get('/api/project', () => HttpResponse.json(seedProject)),
  http.get('/api/cues', () =>
    HttpResponse.json(
      cues.map((cue) => ({
        ...cue,
        conflict: cue.id === 'C-06' ? '此提示与道具运输时间重叠 4 分钟' : '',
      })),
    ),
  ),
  http.post('/api/cues/:id/comments', async ({ params, request }) => {
    const body = (await request.json()) as { author: string; content: string }
    const cue = cues.find((item) => item.id === params.id)
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
  // 演示接口：模拟在线同事在服务器侧改了一稿
  http.post('/api/remote-edit', () => {
    const result = remoteEdits[remoteEditIndex % remoteEdits.length]()
    remoteEditIndex += 1
    return HttpResponse.json(result, { status: 201 })
  }),
  http.post('/api/sync', async ({ request }) => {
    const body = (await request.json()) as { batchId: string; base: Cue[]; local: Cue[] }
    const record = appliedBatches.get(body.batchId)
    if (record) {
      // 同号重传：回放已应用的结果，不生成新版本
      return HttpResponse.json({ ...record, idempotent: true }, { status: 200 })
    }
    const { merged, conflicts } = threeWayMerge(body.base ?? [], body.local ?? [], cues)
    cues = merged
    serverRevision += 1
    const syncedAt = new Date().toISOString()
    const stored = {
      revision: serverRevision,
      syncedAt,
      merged: structuredClone(merged),
      conflicts: structuredClone(conflicts),
    }
    appliedBatches.set(body.batchId, stored)
    return HttpResponse.json({ ...stored, idempotent: false }, { status: 201 })
  }),
]

export { seedMovers }
