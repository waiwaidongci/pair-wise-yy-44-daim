import type { Comment, Cue } from '../stores/workshop'

/**
 * 三方合并引擎：以 base（上次同步的共同基线）为参照，
 * 把本地离线批次 local 与云端当前版本 remote 合并。
 *
 * 规则：
 * - 只有一边改过的字段直接并入；
 * - 两边改成一样的字段直接并入；
 * - 同一字段两边都改成不同值 → 生成冲突，两版都保留，等待人工裁决；
 * - 合并结果中冲突字段先落本地版，裁决后再随下次同步推送。
 */

export const FIELD_LABELS: Record<string, string> = {
  cue: '整条提示',
  act: '幕次',
  scene: '场景',
  time: '时间码',
  title: '提示标题',
  department: '执行部门',
  owner: '责任角色',
  duration: '时长',
  entry: '入场点',
  exit: '退场点',
  route: '走位路线',
  note: '执行说明',
  status: '确认状态',
  comments: '部门留言',
}

const SCALAR_FIELDS = ['act', 'scene', 'time', 'title', 'department', 'owner', 'duration', 'entry', 'exit', 'route', 'note', 'status'] as const

export type MergeConflict = {
  id: string
  cueId: string
  cueTitle: string
  /** 冲突字段：SCALAR_FIELDS 之一，或 'comments'（单条留言）/ 'cue'（整条提示增删） */
  field: string
  fieldLabel: string
  /** field 为 'comments' 时，冲突留言的 id */
  commentId?: string
  /** 本地离线批次版本；为 null 表示本地删除了它 */
  localValue: unknown
  /** 云端协作版本；为 null 表示云端删除了它 */
  remoteValue: unknown
}

export type MergeResult = {
  merged: Cue[]
  conflicts: MergeConflict[]
  /** 自动并入（未撞车）的字段数，用于同步结果提示 */
  autoMergedFields: number
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== typeof b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, (b as unknown[])[index]))
  }
  if (typeof a === 'object') {
    const aRecord = a as Record<string, unknown>
    const bRecord = b as Record<string, unknown>
    const aKeys = Object.keys(aRecord)
    if (aKeys.length !== Object.keys(bRecord).length) return false
    return aKeys.every((key) => deepEqual(aRecord[key], bRecord[key]))
  }
  return false
}

function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map((item) => [item.id, item]))
}

/** 保持 base 顺序，其后依次是本地新增、云端新增，保证合并结果稳定可预期 */
function unionIds<T extends { id: string }>(base: T[], local: T[], remote: T[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const list of [base, local, remote]) {
    for (const item of list) {
      if (!seen.has(item.id)) {
        seen.add(item.id)
        ids.push(item.id)
      }
    }
  }
  return ids
}

type MergeContext = { cueId: string; cueTitle: string }

function mergeComments(
  base: Comment[],
  local: Comment[],
  remote: Comment[],
  context: MergeContext,
  conflicts: MergeConflict[],
  counter: { auto: number },
): Comment[] {
  const baseMap = byId(base)
  const localMap = byId(local)
  const remoteMap = byId(remote)
  const result: Comment[] = []

  const pushConflict = (localValue: unknown, remoteValue: unknown, commentId: string) => {
    conflicts.push({
      id: `cf-${context.cueId}-comments-${commentId}`,
      cueId: context.cueId,
      cueTitle: context.cueTitle,
      field: 'comments',
      fieldLabel: FIELD_LABELS.comments,
      commentId,
      localValue,
      remoteValue,
    })
  }

  for (const id of unionIds(base, local, remote)) {
    const b = baseMap.get(id)
    const l = localMap.get(id)
    const r = remoteMap.get(id)

    if (b && !l && !r) continue // 两边都删了
    if (b && !l && r) {
      // 本地删除；云端没动 → 删除生效；云端也改了 → 冲突，两版保留
      if (deepEqual(b, r)) continue
      pushConflict(null, structuredClone(r), id)
      result.push(structuredClone(r))
      continue
    }
    if (b && l && !r) {
      if (deepEqual(b, l)) continue
      pushConflict(structuredClone(l), null, id)
      result.push(structuredClone(l))
      continue
    }
    if (!b && l && !r) {
      result.push(structuredClone(l))
      counter.auto += 1
      continue
    }
    if (!b && !l && r) {
      result.push(structuredClone(r))
      counter.auto += 1
      continue
    }
    // 两边都在（b 可能不存在：两边各自新增了同 id 留言）
    const localComment = l as Comment
    const remoteComment = r as Comment
    if (deepEqual(localComment, remoteComment)) {
      result.push(structuredClone(localComment))
    } else if (b && deepEqual(b, localComment)) {
      result.push(structuredClone(remoteComment))
      counter.auto += 1
    } else if (b && deepEqual(b, remoteComment)) {
      result.push(structuredClone(localComment))
      counter.auto += 1
    } else {
      pushConflict(structuredClone(localComment), structuredClone(remoteComment), id)
      result.push(structuredClone(localComment))
    }
  }
  return result
}

function mergeCue(b: Cue | undefined, l: Cue, r: Cue, conflicts: MergeConflict[], counter: { auto: number }): Cue {
  const out = structuredClone(l)
  const writable = out as unknown as Record<string, unknown>
  const localRecord = l as unknown as Record<string, unknown>
  const remoteRecord = r as unknown as Record<string, unknown>
  const baseRecord = b as unknown as Record<string, unknown> | undefined

  for (const field of SCALAR_FIELDS) {
    const localValue = localRecord[field]
    const remoteValue = remoteRecord[field]
    if (deepEqual(localValue, remoteValue)) {
      writable[field] = structuredClone(localValue)
    } else if (baseRecord && deepEqual(baseRecord[field], localValue)) {
      // 本地没动，云端改了 → 并入云端
      writable[field] = structuredClone(remoteValue)
      counter.auto += 1
    } else if (baseRecord && deepEqual(baseRecord[field], remoteValue)) {
      // 云端没动，本地改了 → 并入本地
      writable[field] = structuredClone(localValue)
      counter.auto += 1
    } else {
      // 两边都改成不同值 → 保留两版等裁决，工作副本先落本地版
      conflicts.push({
        id: `cf-${l.id}-${field}`,
        cueId: l.id,
        cueTitle: l.title || r.title,
        field,
        fieldLabel: FIELD_LABELS[field] ?? field,
        localValue: structuredClone(localValue),
        remoteValue: structuredClone(remoteValue),
      })
      writable[field] = structuredClone(localValue)
    }
  }

  out.comments = mergeComments(b?.comments ?? [], l.comments, r.comments, { cueId: l.id, cueTitle: l.title || r.title }, conflicts, counter)
  return out
}

export function mergeCues(base: Cue[], local: Cue[], remote: Cue[]): MergeResult {
  const conflicts: MergeConflict[] = []
  const counter = { auto: 0 }
  const baseMap = byId(base)
  const localMap = byId(local)
  const remoteMap = byId(remote)
  const merged: Cue[] = []

  for (const id of unionIds(base, local, remote)) {
    const b = baseMap.get(id)
    const l = localMap.get(id)
    const r = remoteMap.get(id)

    if (b && !l && !r) continue // 两边都删了
    if (b && !l && r) {
      // 本地删除；云端没动 → 删除生效；云端也改了 → 冲突，两版保留
      if (deepEqual(b, r)) continue
      conflicts.push({
        id: `cf-${id}-cue`,
        cueId: id,
        cueTitle: r.title,
        field: 'cue',
        fieldLabel: FIELD_LABELS.cue,
        localValue: null,
        remoteValue: structuredClone(r),
      })
      merged.push(structuredClone(r))
      continue
    }
    if (b && l && !r) {
      if (deepEqual(b, l)) continue
      conflicts.push({
        id: `cf-${id}-cue`,
        cueId: id,
        cueTitle: l.title,
        field: 'cue',
        fieldLabel: FIELD_LABELS.cue,
        localValue: structuredClone(l),
        remoteValue: null,
      })
      merged.push(structuredClone(l))
      continue
    }
    if (!b && l && !r) {
      merged.push(structuredClone(l))
      counter.auto += 1
      continue
    }
    if (!b && !l && r) {
      merged.push(structuredClone(r))
      counter.auto += 1
      continue
    }
    merged.push(mergeCue(b, l as Cue, r as Cue, conflicts, counter))
  }

  return { merged, conflicts, autoMergedFields: counter.auto }
}

/** 打印清单指纹：演出基线、确认状态、时间码任一变化都会改变指纹，使已生成清单立即失效 */
export function printFingerprint(cues: Cue[], locked: boolean): string {
  const rows = cues.map((cue) => `${cue.id}@${cue.time}#${cue.status}`).sort()
  return `${locked ? 'L' : 'D'}::${rows.join('|')}`
}

/** 冲突两侧版本的可读展示 */
export function formatConflictValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return '（已删除）'
  if (field === 'comments') {
    const comment = value as Comment
    return `${comment.author}：${comment.content}${comment.resolved ? '（已解决）' : '（待处理）'}`
  }
  if (field === 'cue') {
    const cue = value as Cue
    return `${cue.time} ${cue.title} · ${cue.department} · ${cue.status}`
  }
  if (Array.isArray(value)) {
    return value.map((point) => `(${(point as { x: number; y: number }).x}, ${(point as { x: number; y: number }).y})`).join(' → ')
  }
  if (typeof value === 'object' && 'x' in (value as Record<string, unknown>)) {
    const point = value as { x: number; y: number }
    return `(${point.x}, ${point.y})`
  }
  if (field === 'duration') return `${String(value)} 秒`
  return String(value)
}
