import type { Cue } from '../stores/workshop'
import type { MergeConflict } from './merge'

/** 离线批次：同步失败后完整保留在本地，重试时带同一 batchId 重传 */
export type OutboxBatch = {
  /** 批次号：同一批次重传时不变，服务器据此幂等去重 */
  batchId: string
  /** 批次基于的云端版本号 */
  baseRev: number
  /** 发起同步时的本地快照（冻结后不再改动） */
  cues: Cue[]
  createdAt: string
  attempts: number
  lastError?: string
}

export type SyncResponse = {
  batchId: string
  serverRev: number
  syncedAt: string
  cues: Cue[]
  conflicts: MergeConflict[]
  /** true 表示该批次号已处理过，本次为去重返回，未生成新版本 */
  deduplicated?: boolean
}

export type SyncStateResponse = {
  serverRev: number
  cues: Cue[]
}
