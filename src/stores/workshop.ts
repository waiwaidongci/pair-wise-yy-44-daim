import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'

export type Department = '舞台' | '灯光' | '音响' | '道具'
export type Point = { x: number; y: number }

export type Comment = {
  id: string
  author: string
  content: string
  createdAt: string
  resolved: boolean
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

export type CueConflict = {
  id: string
  kind: 'cue'
  cueId: string
  local: Cue | null
  remote: Cue | null
  fields: string[]
  resolved?: 'local' | 'remote'
}

export type CommentConflict = {
  id: string
  kind: 'comment'
  cueId: string
  commentId: string
  local: Comment
  remote: Comment
  field: string
  resolved?: 'local' | 'remote'
}

export type SyncConflict = CueConflict | CommentConflict

export type SyncBatch = {
  id: string
  createdAt: string
  status: 'pending' | 'synced' | 'failed'
  cueCount: number
  revision?: number
  syncedAt?: string
  error?: string
  idempotent?: boolean
}

export type ReviewState = {
  state: 'valid' | 'stale'
  checkedAt: string | null
  reason: string
  affectedIds: string[]
}

export const FIELD_LABELS: Record<string, string> = {
  act: '幕次',
  scene: '场景',
  time: '时间码',
  title: '标题',
  department: '执行部门',
  owner: '责任角色',
  duration: '时长',
  entry: '入场点',
  exit: '退场点',
  route: '路线节点',
  note: '执行说明',
  status: '确认状态',
}

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

type PersistedState = {
  cues?: Cue[]
  lastSynced?: Cue[]
  revision?: number
  conflicts?: SyncConflict[]
  pendingBatches?: SyncBatch[]
  printReview?: ReviewState
  todoReview?: ReviewState
  locked?: boolean
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as PersistedState) : {}
  } catch {
    return {}
  }
}

function nowStamp() {
  return new Date().toISOString()
}

export const useWorkshopStore = defineStore('workshop', () => {
  const restored = loadState()
  const cues = ref<Cue[]>(restored.cues?.length ? restored.cues : structuredClone(seedCues))
  // 上次成功同步的快照，作为三路合并的基线
  const lastSynced = ref<Cue[]>(
    restored.lastSynced?.length ? restored.lastSynced : structuredClone(seedCues),
  )
  const syncConflicts = ref<SyncConflict[]>(restored.conflicts ?? [])
  const pendingBatches = ref<SyncBatch[]>(restored.pendingBatches ?? [])
  const printReview = ref<ReviewState>(
    restored.printReview ?? { state: 'valid', checkedAt: null, reason: '', affectedIds: [] },
  )
  const todoReview = ref<ReviewState>(
    restored.todoReview ?? { state: 'valid', checkedAt: null, reason: '', affectedIds: [] },
  )
  const selectedId = ref('C-01')
  const zoom = ref(100)
  const actFilter = ref('全部')
  const departmentFilter = ref('全部')
  const rev = ref(restored.revision ?? 12)
  const revision = computed(() => `R${rev.value}`)
  const lastSaved = ref('刚刚自动保存')
  const isOffline = ref(false)
  const locked = ref(restored.locked ?? false)
  // 存在未裁决冲突时，基线即使本地锁定也暂缓生效
  const baselineSuspended = ref(false)
  const syncing = ref(false)
  // 演示开关：模拟服务器已收到并应用、但响应在回网途中丢失
  const simulateResponseLoss = ref(false)
  const undoStack = ref<Cue[][]>([])
  const redoStack = ref<Cue[][]>([])

  // 持久化：冲突未裁决时基线不能生效
  if (locked.value && syncConflicts.value.some((c) => !c.resolved)) {
    locked.value = false
    baselineSuspended.value = true
  }

  const selectedCue = computed(() => cues.value.find((cue) => cue.id === selectedId.value) ?? cues.value[0])
  const filteredCues = computed(() =>
    cues.value.filter(
      (cue) =>
        (actFilter.value === '全部' || cue.act === actFilter.value) &&
        (departmentFilter.value === '全部' || cue.department === departmentFilter.value),
    ),
  )
  const conflicts = computed(() =>
    cues.value.filter((cue, index) =>
      cues.value.some((other, otherIndex) => otherIndex !== index && other.time === cue.time && other.scene === cue.scene),
    ),
  )

  // ---- 同步冲突 ----
  const unresolvedConflicts = computed(() => syncConflicts.value.filter((c) => !c.resolved))
  const hasUnresolvedConflicts = computed(() => unresolvedConflicts.value.length > 0)
  const conflictCueIds = computed(
    () => new Set(unresolvedConflicts.value.filter((c) => c.kind === 'cue').map((c) => c.cueId)),
  )
  const failedBatches = computed(() => pendingBatches.value.filter((b) => b.status === 'failed'))

  // ---- 失效核对 ----
  function invalidate(reason: string, affectedIds: string[]) {
    const stamp = nowStamp()
    printReview.value = { state: 'stale', checkedAt: stamp, reason, affectedIds }
    todoReview.value = { state: 'stale', checkedAt: stamp, reason, affectedIds }
  }

  let suppressInvalidation = false
  watch(
    cues,
    (next, prev) => {
      if (suppressInvalidation || !prev) return
      const affected: string[] = []
      const reasons = new Set<string>()
      const prevMap = new Map(prev.map((c) => [c.id, c]))
      const nextMap = new Map(next.map((c) => [c.id, c]))
      for (const [id, nc] of nextMap) {
        const oc = prevMap.get(id)
        if (!oc) {
          affected.push(id)
          reasons.add('节点增删')
        } else {
          if (oc.time !== nc.time) {
            affected.push(id)
            reasons.add('时间码变更')
          }
          if (oc.status !== nc.status) {
            affected.push(id)
            reasons.add('确认状态变更')
          }
        }
      }
      for (const [id] of prevMap) {
        if (!nextMap.has(id)) {
          affected.push(id)
          reasons.add('节点增删')
        }
      }
      if (affected.length) invalidate([...reasons].join('、'), [...new Set(affected)])
    },
    { deep: true },
  )

  watch(locked, (next, prev) => {
    if (suppressInvalidation || next === prev) return
    invalidate(next ? '演出基线锁定' : '演出基线解锁', cues.value.map((c) => c.id))
  })

  function recheckPrint() {
    printReview.value = { state: 'valid', checkedAt: nowStamp(), reason: '', affectedIds: [] }
  }

  function recheckTodo() {
    todoReview.value = { state: 'valid', checkedAt: nowStamp(), reason: '', affectedIds: [] }
  }

  // ---- 持久化 ----
  watch(
    [cues, rev, lastSynced, conflicts, pendingBatches, printReview, todoReview, locked, isOffline],
    () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          cues: cues.value,
          lastSynced: lastSynced.value,
          revision: rev.value,
          conflicts: syncConflicts.value,
          pendingBatches: pendingBatches.value,
          printReview: printReview.value,
          todoReview: todoReview.value,
          locked: locked.value,
        }),
      )
      lastSaved.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    },
    { deep: true },
  )

  // ---- 基础编辑 ----
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
    if (comment) comment.resolved = !comment.resolved
  }

  function lockBaseline() {
    if (hasUnresolvedConflicts.value) return
    suppressInvalidation = true
    locked.value = true
    cues.value.forEach((cue) => {
      cue.status = '已确认'
    })
    suppressInvalidation = false
    invalidate('演出基线锁定', cues.value.map((c) => c.id))
    rev.value += 1
  }

  function unlockBaseline() {
    suppressInvalidation = true
    locked.value = false
    suppressInvalidation = false
    invalidate('演出基线解锁', cues.value.map((c) => c.id))
    rev.value += 1
  }

  function toggleOffline() {
    isOffline.value = !isOffline.value
  }

  // ---- 同步 ----
  function newBatch(): SyncBatch {
    return {
      id: `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: nowStamp(),
      status: 'pending',
      cueCount: cues.value.length,
    }
  }

  function applySync(
    data: {
      merged: Cue[]
      conflicts: SyncConflict[]
      revision: number
      syncedAt: string
      idempotent?: boolean
    },
    batch: SyncBatch,
  ) {
    cues.value = structuredClone(data.merged)
    lastSynced.value = structuredClone(data.merged)
    // 已裁决的历史保留，未裁决冲突以服务器返回为准
    const resolvedHistory = syncConflicts.value.filter((c) => c.resolved)
    syncConflicts.value = [...resolvedHistory, ...structuredClone(data.conflicts)]
    batch.status = 'synced'
    batch.syncedAt = data.syncedAt
    batch.revision = data.revision
    batch.idempotent = !!data.idempotent
    rev.value = Math.max(rev.value, data.revision)
    if (hasUnresolvedConflicts.value && locked.value) {
      // 冲突未裁完，基线暂缓生效
      suppressInvalidation = true
      locked.value = false
      suppressInvalidation = false
      baselineSuspended.value = true
    } else if (!hasUnresolvedConflicts.value) {
      baselineSuspended.value = false
    }
  }

  async function postSync(batch: SyncBatch) {
    if (isOffline.value) throw new Error('离线：无法连接协作服务，本地批次已保留待重试')
    const { data } = await axios.post('/api/sync', {
      batchId: batch.id,
      base: lastSynced.value,
      local: cues.value,
    })
    if (simulateResponseLoss.value) {
      throw new Error('模拟：服务器已收到并应用，但响应在回网途中丢失')
    }
    applySync(data, batch)
  }

  async function syncNow() {
    if (syncing.value) return
    syncing.value = true
    const batch = newBatch()
    pendingBatches.value.unshift(batch)
    try {
      await postSync(batch)
    } catch (error) {
      batch.status = 'failed'
      batch.error = error instanceof Error ? error.message : '同步失败'
    } finally {
      syncing.value = false
    }
  }

  async function retryBatch(batchId: string) {
    const batch = pendingBatches.value.find((b) => b.id === batchId)
    if (!batch || syncing.value) return
    syncing.value = true
    batch.status = 'pending'
    batch.error = undefined
    try {
      await postSync(batch)
    } catch (error) {
      batch.status = 'failed'
      batch.error = error instanceof Error ? error.message : '同步失败'
    } finally {
      syncing.value = false
    }
  }

  // 重发已同步批次：服务器按批次号去重，不生成新版本
  async function resendBatch(batchId: string) {
    const batch = pendingBatches.value.find((b) => b.id === batchId)
    if (!batch || syncing.value) return
    syncing.value = true
    try {
      await postSync(batch)
    } catch (error) {
      batch.status = 'failed'
      batch.error = error instanceof Error ? error.message : '同步失败'
    } finally {
      syncing.value = false
    }
  }

  // 回网后自动重试最近一个失败批次
  watch(isOffline, (offline) => {
    if (offline || syncing.value) return
    const failed = failedBatches.value[0]
    if (failed) retryBatch(failed.id)
    else syncNow()
  })

  // 演示：模拟在线同事改稿
  async function remoteEdit(): Promise<{ cueId: string; description: string }> {
    const { data } = await axios.post('/api/remote-edit')
    return data
  }

  // ---- 冲突裁决 ----
  function adjudicateConflict(conflictId: string, verdict: 'local' | 'remote') {
    const conflict = syncConflicts.value.find((c) => c.id === conflictId)
    if (!conflict || conflict.resolved) return
    if (conflict.kind === 'cue') {
      const index = cues.value.findIndex((c) => c.id === conflict.cueId)
      if (verdict === 'local') {
        if (conflict.local) {
          if (index >= 0) {
            conflict.fields.forEach((field) => {
              ;(cues.value[index] as Record<string, unknown>)[field] = structuredClone(
                (conflict.local as Record<string, unknown>)[field],
              )
            })
          }
        } else if (index >= 0) {
          // 本地删除、远端改过 → 裁决保留本地删除
          cues.value.splice(index, 1)
        }
      } else {
        if (conflict.remote) {
          if (index >= 0) {
            conflict.fields.forEach((field) => {
              ;(cues.value[index] as Record<string, unknown>)[field] = structuredClone(
                (conflict.remote as Record<string, unknown>)[field],
              )
            })
          } else {
            cues.value.push(structuredClone(conflict.remote))
          }
        } else if (index >= 0) {
          // 远端删除、本地改过 → 裁决接受远端删除
          cues.value.splice(index, 1)
        }
      }
    } else {
      const cue = cues.value.find((c) => c.id === conflict.cueId)
      if (cue) {
        const index = cue.comments.findIndex((cm) => cm.id === conflict.commentId)
        const chosen = verdict === 'local' ? conflict.local : conflict.remote
        if (index >= 0) cue.comments[index] = structuredClone(chosen)
        else cue.comments.push(structuredClone(chosen))
      }
    }
    conflict.resolved = verdict
    rev.value += 1
    if (!hasUnresolvedConflicts.value) baselineSuspended.value = false
  }

  return {
    cues,
    selectedId,
    selectedCue,
    filteredCues,
    conflicts,
    zoom,
    actFilter,
    departmentFilter,
    revision,
    lastSaved,
    isOffline,
    locked,
    baselineSuspended,
    syncing,
    simulateResponseLoss,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    lastSynced,
    syncConflicts,
    unresolvedConflicts,
    hasUnresolvedConflicts,
    conflictCueIds,
    pendingBatches,
    failedBatches,
    printReview,
    todoReview,
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
    retryBatch,
    resendBatch,
    remoteEdit,
    adjudicateConflict,
    recheckPrint,
    recheckTodo,
  }
})
