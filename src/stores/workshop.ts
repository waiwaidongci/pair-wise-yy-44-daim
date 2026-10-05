import { computed, ref, watch } from 'vue'
import axios from 'axios'
import { defineStore } from 'pinia'
import { deepEqual, mergeCues, printFingerprint, type MergeConflict } from '../sync/merge'
import type { OutboxBatch, SyncResponse, SyncStateResponse } from '../sync/protocol'

export type Department = '舞台' | '灯光' | '音响' | '道具'
export type Point = { x: number; y: number }

export type Comment = {
  id: string
  author: string
  content: string
  createdAt: string
  resolved: boolean
  /** 基线 / 确认状态 / 时间码变化后被重新打开，等待人工重新核对 */
  recheck?: boolean
}

export type Cue = {
  id: string
  act: string
  scene: string
  time: string
  title: string
  department: Department
  owner: string
  duration: number
  entry: Point
  exit: Point
  route: Point[]
  note: string
  status: '草稿' | '待确认' | '已确认'
  comments: Comment[]
}

export type PrintJob = {
  id: string
  label: string
  revision: string
  createdAt: string
  cueCount: number
  /** 生成时的数据指纹；与当前指纹不一致即视为已失效 */
  fingerprint: string
}

export type FailMode = 'none' | 'before' | 'after-commit'

export const seedProject = {
  name: '潮汐来信',
  venue: '上海大剧院 · 大剧场',
  rehearsalDate: '2026-10-08',
  company: '远岸剧团',
}

export const seedMovers = [
  { id: 'M-01', alias: '林默', role: '父亲', group: '主要演员', color: '#d96b45' },
  { id: 'M-02', alias: '周予', role: '女儿', group: '主要演员', color: '#2f8d88' },
  { id: 'M-03', alias: '顾川', role: '灯塔守望者', group: '主要演员', color: '#4f6fb0' },
  { id: 'M-04', alias: '群演甲组', role: '旅客', group: '群演', color: '#ba8c2f' },
  { id: 'M-05', alias: '群演乙组', role: '码头工人', group: '群演', color: '#735ca8' },
]

export const seedCues: Cue[] = [
  {
    id: 'C-01',
    act: '第一幕',
    scene: '启航前夜',
    time: '00:04:20',
    title: '林默从左侧门入场',
    department: '舞台',
    owner: '林默 / 周予',
    duration: 95,
    entry: { x: 10, y: 70 },
    exit: { x: 64, y: 38 },
    route: [{ x: 10, y: 70 }, { x: 35, y: 60 }, { x: 64, y: 38 }],
    note: '灯位切换后 2 秒入场，停在码头箱前。',
    status: '已确认',
    comments: [
      { id: 'c1', author: '王灯控', content: '面光需要延长 4 秒，保证转身动作可见。', createdAt: '2026-09-27 14:20', resolved: false },
    ],
  },
  {
    id: 'C-02',
    act: '第一幕',
    scene: '启航前夜',
    time: '00:06:10',
    title: '信件道具交接',
    department: '道具',
    owner: '周予 / 道具组',
    duration: 40,
    entry: { x: 28, y: 30 },
    exit: { x: 55, y: 47 },
    route: [{ x: 28, y: 30 }, { x: 44, y: 40 }, { x: 55, y: 47 }],
    note: '使用 B 版信封，背台侧完成交接。',
    status: '待确认',
    comments: [],
  },
  {
    id: 'C-03',
    act: '第二幕',
    scene: '风暴',
    time: '00:21:35',
    title: '升降台上升 / 码头位移',
    department: '舞台',
    owner: '舞台机械',
    duration: 120,
    entry: { x: 72, y: 82 },
    exit: { x: 42, y: 50 },
    route: [{ x: 72, y: 82 }, { x: 60, y: 70 }, { x: 42, y: 50 }],
    note: '先确认演员离开危险半径，再启动升降台。',
    status: '草稿',
    comments: [],
  },
  {
    id: 'C-04',
    act: '第二幕',
    scene: '风暴',
    time: '00:23:05',
    title: '爆闪与低频重音',
    department: '灯光',
    owner: '王灯控 / 声场',
    duration: 18,
    entry: { x: 50, y: 12 },
    exit: { x: 50, y: 12 },
    route: [{ x: 50, y: 12 }],
    note: '与机械动作互锁，机械未到位禁止触发。',
    status: '待确认',
    comments: [],
  },
  {
    id: 'C-05',
    act: '第三幕',
    scene: '守望',
    time: '00:37:42',
    title: '三人灯塔调度',
    department: '舞台',
    owner: '主要演员组',
    duration: 70,
    entry: { x: 18, y: 82 },
    exit: { x: 82, y: 18 },
    route: [{ x: 18, y: 82 }, { x: 45, y: 66 }, { x: 68, y: 35 }, { x: 82, y: 18 }],
    note: '群演保持第二条对角线，不遮挡主视线。',
    status: '草稿',
    comments: [],
  },
  {
    id: 'C-06',
    act: '第三幕',
    scene: '守望',
    time: '00:39:10',
    title: '救生艇推入',
    department: '道具',
    owner: '道具组 / 群演乙组',
    duration: 50,
    entry: { x: 88, y: 64 },
    exit: { x: 70, y: 44 },
    route: [{ x: 88, y: 64 }, { x: 80, y: 54 }, { x: 70, y: 44 }],
    note: '与演员横穿路线冲突，需调整优先权。',
    status: '待确认',
    comments: [],
  },
]

const STORAGE_KEY = 'stage-scheduler-draft-v2'
const LEGACY_STORAGE_KEY = 'stage-scheduler-draft-v1'

type PersistedState = {
  cues?: Cue[]
  revision?: number
  locked?: boolean
  syncedRev?: number
  lastSyncedCues?: Cue[]
  outbox?: OutboxBatch | null
  pendingConflicts?: MergeConflict[]
  printJobs?: PrintJob[]
}

function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as PersistedState
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy) as { cues?: Cue[]; revision?: number }
      return { cues: parsed.cues, revision: parsed.revision }
    }
  } catch {
    // 本地草稿损坏时从种子数据重新开始
  }
  return {}
}

export const useWorkshopStore = defineStore('workshop', () => {
  const persisted = loadPersisted()
  const cues = ref<Cue[]>(persisted.cues?.length ? persisted.cues : structuredClone(seedCues))
  const selectedId = ref('C-01')
  const zoom = ref(100)
  const actFilter = ref('全部')
  const departmentFilter = ref('全部')
  const rev = ref(persisted.revision ?? 12)
  const revision = computed(() => `R${rev.value}`)
  const lastSaved = ref('刚刚自动保存')
  const isOffline = ref(false)
  const locked = ref(persisted.locked ?? false)
  const undoStack = ref<Cue[][]>([])
  const redoStack = ref<Cue[][]>([])

  // —— 离线同步：批次、冲突裁决、云端版本 ——
  const syncedRev = ref(persisted.syncedRev ?? 1)
  const lastSyncedCues = ref<Cue[]>(persisted.lastSyncedCues?.length ? persisted.lastSyncedCues : structuredClone(seedCues))
  const outbox = ref<OutboxBatch | null>(persisted.outbox ?? null)
  const pendingConflicts = ref<MergeConflict[]>(persisted.pendingConflicts ?? [])
  const syncing = ref(false)
  const lastSyncError = ref('')
  const lastSyncAt = ref('')
  const lastSyncDedup = ref(false)
  const simulateFailMode = ref<FailMode>('none')
  const conflictResolverOpen = ref(false)

  // —— 打印清单 ——
  const printJobs = ref<PrintJob[]>(persisted.printJobs ?? [])
  const currentFingerprint = computed(() => printFingerprint(cues.value, locked.value))
  const stalePrintJobs = computed(() => printJobs.value.filter((job) => job.fingerprint !== currentFingerprint.value))

  const dirty = computed(() => !deepEqual(cues.value, lastSyncedCues.value))
  const hasPendingConflicts = computed(() => pendingConflicts.value.length > 0)
  const recheckCommentCount = computed(
    () => cues.value.reduce((total, cue) => total + cue.comments.filter((item) => item.recheck && !item.resolved).length, 0),
  )

  const selectedCue = computed(() => cues.value.find((cue) => cue.id === selectedId.value) ?? cues.value[0])
  const filteredCues = computed(() =>
    cues.value.filter(
      (cue) =>
        (actFilter.value === '全部' || cue.act === actFilter.value) &&
        (departmentFilter.value === '全部' || cue.department === departmentFilter.value),
    ),
  )
  /** 同一时间码撞车的提示（编排层面的潜在冲突，与合并冲突无关） */
  const timingConflicts = computed(() =>
    cues.value.filter((cue, index) =>
      cues.value.some((other, otherIndex) => otherIndex !== index && other.time === cue.time && other.scene === cue.scene),
    ),
  )

  watch(
    [cues, rev, locked, syncedRev, lastSyncedCues, outbox, pendingConflicts, printJobs],
    () => {
      const state: PersistedState = {
        cues: cues.value,
        revision: rev.value,
        locked: locked.value,
        syncedRev: syncedRev.value,
        lastSyncedCues: lastSyncedCues.value,
        outbox: outbox.value,
        pendingConflicts: pendingConflicts.value,
        printJobs: printJobs.value,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      lastSaved.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    },
    { deep: true },
  )

  // 演出基线、确认状态或时间码一变，受影响提示下已解决的留言待办立即失效，等待重新核对
  const cueSignatures = new Map<string, string>()
  const signatureOf = (cue: Cue) => `${cue.time}|${cue.status}|${locked.value ? 'L' : 'D'}`
  cues.value.forEach((cue) => cueSignatures.set(cue.id, signatureOf(cue)))
  watch(
    [cues, locked],
    () => {
      const alive = new Set<string>()
      for (const cue of cues.value) {
        const signature = signatureOf(cue)
        const previous = cueSignatures.get(cue.id)
        if (previous !== undefined && previous !== signature) {
          for (const comment of cue.comments) {
            if (comment.resolved) {
              comment.resolved = false
              comment.recheck = true
            }
          }
        }
        cueSignatures.set(cue.id, signature)
        alive.add(cue.id)
      }
      for (const id of [...cueSignatures.keys()]) {
        if (!alive.has(id)) cueSignatures.delete(id)
      }
    },
    { deep: true },
  )

  function snapshot() {
    undoStack.value.push(structuredClone(cues.value))
    if (undoStack.value.length > 20) undoStack.value.shift()
    redoStack.value = []
  }

  function updateCue(patch: Partial<Cue>, addRevision = true) {
    if (locked.value) return
    snapshot()
    const index = cues.value.findIndex((cue) => cue.id === selectedId.value)
    if (index < 0) return
    cues.value[index] = { ...cues.value[index], ...patch }
    if (addRevision) rev.value += 1
  }

  function addWaypoint(point: { x: number; y: number }) {
    const cue = selectedCue.value
    if (!cue) return
    updateCue({ route: [...cue.route, point] })
  }

  function addCue() {
    if (locked.value) return
    snapshot()
    const next = cues.value.length + 1
    const cue: Cue = {
      id: `C-${String(next).padStart(2, '0')}`,
      act: '第一幕',
      scene: '新场景',
      time: '00:00:00',
      title: '新执行提示',
      department: '舞台',
      owner: '待指派',
      duration: 30,
      entry: { x: 10, y: 50 },
      exit: { x: 90, y: 50 },
      route: [{ x: 10, y: 50 }, { x: 90, y: 50 }],
      note: '',
      status: '草稿',
      comments: [],
    }
    cues.value.push(cue)
    selectedId.value = cue.id
    rev.value += 1
  }

  function undo() {
    const previous = undoStack.value.pop()
    if (!previous) return
    redoStack.value.push(structuredClone(cues.value))
    cues.value = previous
    rev.value += 1
  }

  function redo() {
    const next = redoStack.value.pop()
    if (!next) return
    undoStack.value.push(structuredClone(cues.value))
    cues.value = next
    rev.value += 1
  }

  function addComment(content: string, author = '当前用户') {
    const cue = selectedCue.value
    if (!cue) return
    snapshot()
    cue.comments.push({
      id: `local-${Date.now()}`,
      author,
      content,
      createdAt: new Date().toLocaleString('zh-CN'),
      resolved: false,
    })
    rev.value += 1
  }

  function toggleComment(commentId: string) {
    const comment = selectedCue.value?.comments.find((item) => item.id === commentId)
    if (!comment) return
    comment.resolved = !comment.resolved
    if (comment.resolved) comment.recheck = false
    rev.value += 1
  }

  /** 未裁完合并冲突不能进演出基线 */
  function lockBaseline(): boolean {
    if (hasPendingConflicts.value) return false
    locked.value = true
    cues.value.forEach((cue) => {
      cue.status = '已确认'
    })
    rev.value += 1
    return true
  }

  function unlockBaseline() {
    locked.value = false
    rev.value += 1
  }

  function toggleOffline() {
    isOffline.value = !isOffline.value
    if (!isOffline.value) void syncNow() // 回网后自动合并离线批次
  }

  function applySyncResult(batch: OutboxBatch, data: SyncResponse) {
    // 以批次快照为基，把同步期间本地的继续编辑重放到服务器合并结果上
    const rebase = mergeCues(batch.cues, cues.value, data.cues)
    cues.value = rebase.merged
    const seen = new Set<string>()
    const queue: MergeConflict[] = []
    for (const conflict of [...data.conflicts, ...rebase.conflicts]) {
      const key = `${conflict.cueId}|${conflict.field}|${conflict.commentId ?? ''}`
      if (!seen.has(key)) {
        seen.add(key)
        queue.push(conflict)
      }
    }
    pendingConflicts.value = queue
    syncedRev.value = data.serverRev
    lastSyncedCues.value = structuredClone(data.cues)
    outbox.value = null
    lastSyncError.value = ''
    lastSyncAt.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    lastSyncDedup.value = Boolean(data.deduplicated)
    rev.value += 1
  }

  /** 服务器状态被重置（如服务重启）时，以远端当前版本为共同基线重新对齐本地差异 */
  async function recoverFromServer() {
    const { data } = await axios.get<SyncStateResponse>('/api/sync/state')
    const rebase = mergeCues(data.cues, cues.value, data.cues)
    cues.value = rebase.merged
    syncedRev.value = data.serverRev
    lastSyncedCues.value = structuredClone(data.cues)
    outbox.value = null
  }

  async function syncNow(recovered = false): Promise<boolean> {
    if (isOffline.value || syncing.value) return false
    if (!outbox.value) {
      if (!dirty.value) return true
      outbox.value = {
        batchId: `B-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        baseRev: syncedRev.value,
        cues: structuredClone(cues.value),
        createdAt: new Date().toISOString(),
        attempts: 0,
      }
    }
    const batch = outbox.value
    batch.attempts += 1
    syncing.value = true
    lastSyncError.value = ''
    try {
      const headers: Record<string, string> = {}
      if (simulateFailMode.value !== 'none') {
        headers['x-simulate-fail'] = simulateFailMode.value === 'before' ? '1' : 'after-commit'
        simulateFailMode.value = 'none'
      }
      const { data } = await axios.post<SyncResponse>('/api/sync', batch, { headers })
      applySyncResult(batch, data)
      return true
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409 && !recovered) {
        await recoverFromServer()
        syncing.value = false
        return syncNow(true)
      }
      // 同步失败：批次保留在 outbox，重试时带同一 batchId 重传
      batch.lastError = '同步失败，批次已保留'
      lastSyncError.value = '同步失败：离线批次已保留在本地，可重试'
      return false
    } finally {
      syncing.value = false
    }
  }

  /** 裁决冲突：选定一版落到工作副本，全部裁完后自动推送云端 */
  function resolveConflict(conflictId: string, choice: 'local' | 'remote') {
    const index = pendingConflicts.value.findIndex((item) => item.id === conflictId)
    if (index < 0) return
    const conflict = pendingConflicts.value[index]
    const chosen = structuredClone(choice === 'local' ? conflict.localValue : conflict.remoteValue) as unknown

    if (conflict.field === 'cue') {
      if (chosen === null) {
        cues.value = cues.value.filter((cue) => cue.id !== conflict.cueId)
      } else {
        const cueIndex = cues.value.findIndex((cue) => cue.id === conflict.cueId)
        if (cueIndex >= 0) cues.value[cueIndex] = chosen as Cue
        else cues.value.push(chosen as Cue)
      }
    } else if (conflict.field === 'comments' && conflict.commentId) {
      const cue = cues.value.find((item) => item.id === conflict.cueId)
      if (cue) {
        const commentIndex = cue.comments.findIndex((item) => item.id === conflict.commentId)
        if (chosen === null) {
          if (commentIndex >= 0) cue.comments.splice(commentIndex, 1)
        } else if (commentIndex >= 0) {
          cue.comments[commentIndex] = chosen as Comment
        } else {
          cue.comments.push(chosen as Comment)
        }
      }
    } else {
      const cue = cues.value.find((item) => item.id === conflict.cueId)
      if (cue) (cue as unknown as Record<string, unknown>)[conflict.field] = chosen
    }

    pendingConflicts.value.splice(index, 1)
    rev.value += 1
    if (pendingConflicts.value.length === 0 && !isOffline.value) void syncNow()
  }

  function generatePrintJob(options: { notes: boolean; routes: boolean; comments: boolean }) {
    const parts = ['执行清单']
    if (options.notes) parts.push('含执行说明')
    if (options.routes) parts.push('含路线坐标')
    if (options.comments) parts.push('含未解决留言')
    const job: PrintJob = {
      id: `P-${String(printJobs.value.length + 1).padStart(2, '0')}`,
      label: parts.join(' · '),
      revision: revision.value,
      createdAt: new Date().toLocaleString('zh-CN'),
      cueCount: cues.value.length,
      fingerprint: currentFingerprint.value,
    }
    printJobs.value.unshift(job)
    return job
  }

  /** 重新核对：按当前基线 / 确认状态 / 时间码刷新指纹，清单恢复有效 */
  function recheckPrintJob(jobId: string) {
    const job = printJobs.value.find((item) => item.id === jobId)
    if (!job) return
    job.fingerprint = currentFingerprint.value
    job.revision = revision.value
    job.cueCount = cues.value.length
  }

  function isPrintJobStale(job: PrintJob) {
    return job.fingerprint !== currentFingerprint.value
  }

  return {
    cues,
    selectedId,
    selectedCue,
    filteredCues,
    timingConflicts,
    zoom,
    actFilter,
    departmentFilter,
    revision,
    lastSaved,
    isOffline,
    locked,
    syncedRev,
    outbox,
    pendingConflicts,
    hasPendingConflicts,
    syncing,
    lastSyncError,
    lastSyncAt,
    lastSyncDedup,
    simulateFailMode,
    conflictResolverOpen,
    dirty,
    printJobs,
    stalePrintJobs,
    recheckCommentCount,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    updateCue,
    addWaypoint,
    addCue,
    undo,
    redo,
    addComment,
    toggleComment,
    lockBaseline,
    unlockBaseline,
    toggleOffline,
    syncNow,
    resolveConflict,
    generatePrintJob,
    recheckPrintJob,
    isPrintJobStale,
  }
})
