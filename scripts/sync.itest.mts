import { setupServer } from 'msw/node'
import axios from 'axios'
import { handlers } from '../src/api/handlers'
import { seedCues, type Cue } from '../src/stores/workshop'
import type { OutboxBatch, SyncResponse } from '../src/sync/protocol'

// Node 环境没有 location，MSW 相对路径处理器需要一个源来归一化
;(globalThis as Record<string, unknown>).location = new URL('http://test.local/')

const server = setupServer(...handlers)
server.listen({ onUnhandledRequest: 'error' })

let passed = 0
let failed = 0
function check(name: string, condition: boolean) {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}`)
  }
}

let batchSeq = 0
function makeBatch(baseRev: number, cues: Cue[], batchId?: string): OutboxBatch {
  batchSeq += 1
  return {
    batchId: batchId ?? `B-test-${batchSeq}`,
    baseRev,
    cues: structuredClone(cues),
    createdAt: new Date().toISOString(),
    attempts: 1,
  }
}

async function sync(batch: OutboxBatch, headers: Record<string, string> = {}) {
  try {
    const { data } = await axios.post<SyncResponse>('http://test.local/api/sync', batch, { headers })
    return { ok: true as const, data }
  } catch (error) {
    const response = axios.isAxiosError(error) ? error.response : undefined
    return { ok: false as const, status: response?.status, data: response?.data }
  }
}

async function main() {
  // 场景一：舞台监督离线改 C-01 说明（批次 A），制作人同时改 C-02 时间码（批次 B）
  const cuesA = structuredClone(seedCues)
  cuesA[0].note = '舞台监督离线改：提前 2 秒入场'
  const resA = await sync(makeBatch(1, cuesA))
  check('批次 A 同步成功', resA.ok && resA.data.serverRev === 2)
  check('批次 A 无冲突', resA.ok && resA.data.conflicts.length === 0)

  const cuesB = structuredClone(seedCues)
  cuesB[1].time = '00:07:07'
  const resB = await sync(makeBatch(1, cuesB))
  check('批次 B 基于旧基线仍合并成功', resB.ok && resB.data.serverRev === 3)
  const mergedB = resB.ok ? resB.data.cues : []
  check(
    '两边的改动都并入（不互相覆盖）',
    mergedB.find((c) => c.id === 'C-01')?.note === '舞台监督离线改：提前 2 秒入场' &&
      mergedB.find((c) => c.id === 'C-02')?.time === '00:07:07',
  )
  check('不撞车无冲突', resB.ok && resB.data.conflicts.length === 0)

  // 场景二：同一说明两边都改 → 冲突，两版都保留
  const cuesC = structuredClone(seedCues)
  cuesC[0].note = '另一端的冲突改法'
  const resC = await sync(makeBatch(1, cuesC))
  check('同字段双改产生冲突', resC.ok && resC.data.conflicts.some((c) => c.field === 'note' && c.cueId === 'C-01'))
  const noteConflict = resC.ok ? resC.data.conflicts.find((c) => c.field === 'note') : undefined
  check(
    '冲突两版都保留',
    noteConflict?.localValue === '另一端的冲突改法' && noteConflict?.remoteValue === '舞台监督离线改：提前 2 秒入场',
  )

  // 场景三：同号重传 → 去重，不生成第二个版本
  const revBefore = resC.ok ? resC.data.serverRev : -1
  const resC2 = await sync(makeBatch(1, cuesC, resC.ok ? resC.data.batchId : undefined))
  check('同号重传返回去重标记', resC2.ok && resC2.data.deduplicated === true)
  check('同号重传不生成新版本', resC2.ok && resC2.data.serverRev === revBefore)

  // 场景四：已提交但响应丢失 → 重试命中去重，只产生一个版本
  const cuesD = resC2.ok ? structuredClone(resC2.data.cues) : []
  cuesD[2].note = '断网时补的机械备注'
  const batchD = makeBatch(revBefore, cuesD)
  const resD1 = await sync(batchD, { 'x-simulate-fail': 'after-commit' })
  check('已提交丢响应返回失败', !resD1.ok && resD1.status === 503)
  const resD2 = await sync(batchD)
  check('重试命中去重', resD2.ok && resD2.data.deduplicated === true)
  check('丢响应重试只产生一个版本', resD2.ok && resD2.data.serverRev === revBefore + 1)
  check('丢响应的改动已生效', resD2.ok && resD2.data.cues.find((c) => c.id === 'C-03')?.note === '断网时补的机械备注')

  // 场景五：未提交失败 → 服务器无痕迹，重试正常提交
  const cuesE = structuredClone(resD2.ok ? resD2.data.cues : [])
  cuesE[3].duration = 30
  const batchE = makeBatch(resD2.ok ? resD2.data.serverRev : 0, cuesE)
  const resE1 = await sync(batchE, { 'x-simulate-fail': '1' })
  check('未提交失败返回 503', !resE1.ok && resE1.status === 503)
  const resE2 = await sync(batchE)
  check('未提交失败重试后正常提交（非去重）', resE2.ok && !resE2.data.deduplicated)
  check('重试后改动生效', resE2.ok && resE2.data.cues.find((c) => c.id === 'C-04')?.duration === 30)

  // 场景六：无实际改动的批次不生成新版本
  const revNow = resE2.ok ? resE2.data.serverRev : -1
  const resF = await sync(makeBatch(revNow, resE2.ok ? resE2.data.cues : []))
  check('无改动批次不产生新版本', resF.ok && resF.data.serverRev === revNow)

  // 场景七：未知基线 → 409，客户端可重新对齐
  const resG = await sync(makeBatch(99, seedCues))
  check('未知基线返回 409', !resG.ok && resG.status === 409)

  // 场景八：状态查询端点可用（客户端重新对齐用）
  const { data: state } = await axios.get<{ serverRev: number; cues: Cue[] }>('http://test.local/api/sync/state')
  check('状态端点返回当前版本', state.serverRev === revNow && state.cues.length === seedCues.length)

  console.log(`\n${passed} 通过, ${failed} 失败`)
  server.close()
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  server.close()
  process.exit(1)
})
