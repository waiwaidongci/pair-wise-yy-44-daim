import type { Comment, Cue, SyncConflict } from '../stores/workshop'

// 需要逐字段合并的走位字段
export const CUE_FIELDS = [
  'act',
  'scene',
  'time',
  'title',
  'department',
  'owner',
  'duration',
  'entry',
  'exit',
  'route',
  'note',
  'status',
] as const

export function isEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

type IdFactory = () => string

// 留言合并：新增留言两边都保留；同一条留言两边都改过且不一致 → 冲突
function mergeComments(
  base: Comment[],
  local: Comment[],
  remote: Comment[],
  cueId: string,
  nextId: IdFactory,
): { comments: Comment[]; conflicts: SyncConflict[] } {
  const conflicts: SyncConflict[] = []
  const baseMap = new Map(base.map((c) => [c.id, c]))
  const localMap = new Map(local.map((c) => [c.id, c]))
  const remoteMap = new Map(remote.map((c) => [c.id, c]))
  const orderedIds = [
    ...base.map((c) => c.id),
    ...local.filter((c) => !baseMap.has(c.id)).map((c) => c.id),
    ...remote.filter((c) => !baseMap.has(c.id) && !localMap.has(c.id)).map((c) => c.id),
  ]
  const merged: Comment[] = []
  for (const id of orderedIds) {
    const b = baseMap.get(id)
    const l = localMap.get(id)
    const r = remoteMap.get(id)
    if (!l && !r) continue
    if (l && r && !b) {
      // 两边各自新增了同一条留言（id 碰撞）
      if (isEqual(l, r)) {
        merged.push(l)
      } else {
        conflicts.push({ id: nextId(), kind: 'comment', cueId, commentId: id, local: l, remote: r, field: 'both' })
        merged.push(l)
      }
      continue
    }
    if (!l) {
      if (r) merged.push(r)
      continue
    }
    if (!r) {
      merged.push(l)
      continue
    }
    const lChanged = !isEqual(l, b)
    const rChanged = !isEqual(r, b)
    if (lChanged && rChanged && !isEqual(l, r)) {
      const lContent = !isEqual(l.content, b!.content)
      const rContent = !isEqual(r.content, b!.content)
      const lResolved = !isEqual(l.resolved, b!.resolved)
      const rResolved = !isEqual(r.resolved, b!.resolved)
      const field =
        lContent && rContent ? (lResolved && rResolved ? 'both' : 'content') : 'resolved'
      conflicts.push({ id: nextId(), kind: 'comment', cueId, commentId: id, local: l, remote: r, field })
      merged.push(l)
    } else if (rChanged) {
      merged.push(r)
    } else {
      merged.push(l)
    }
  }
  return { comments: merged, conflicts }
}

// 三路合并：base = 上次同步快照，local = 本地草稿，remote = 服务器状态
export function threeWayMerge(
  base: Cue[],
  local: Cue[],
  remote: Cue[],
): { merged: Cue[]; conflicts: SyncConflict[] } {
  const conflicts: SyncConflict[] = []
  const baseMap = new Map(base.map((c) => [c.id, c]))
  const localMap = new Map(local.map((c) => [c.id, c]))
  const remoteMap = new Map(remote.map((c) => [c.id, c]))
  const orderedIds = [
    ...base.map((c) => c.id),
    ...local.filter((c) => !baseMap.has(c.id)).map((c) => c.id),
    ...remote.filter((c) => !baseMap.has(c.id) && !localMap.has(c.id)).map((c) => c.id),
  ]
  let seq = 0
  const nextId: IdFactory = () => `sync-conflict-${Date.now()}-${seq++}`

  const merged: Cue[] = []
  for (const id of orderedIds) {
    const b = baseMap.get(id)
    const l = localMap.get(id)
    const r = remoteMap.get(id)

    if (l && r && !b) {
      // 两边各自新增了同一条走位（id 碰撞）
      if (isEqual(l, r)) {
        merged.push(structuredClone(l))
      } else {
        conflicts.push({
          id: nextId(),
          kind: 'cue',
          cueId: id,
          local: structuredClone(l),
          remote: structuredClone(r),
          fields: CUE_FIELDS.filter((f) => !isEqual(l[f], r[f])),
        })
        merged.push(structuredClone(l))
      }
      continue
    }

    if (!l) {
      // 本地删除了该走位
      if (r && b && !isEqual(r, b)) {
        conflicts.push({
          id: nextId(),
          kind: 'cue',
          cueId: id,
          local: null,
          remote: structuredClone(r),
          fields: CUE_FIELDS.filter((f) => !isEqual(r[f], b[f])),
        })
        merged.push(structuredClone(r))
      }
      continue
    }

    if (!r) {
      // 远端删除了该走位
      if (b && !isEqual(l, b)) {
        conflicts.push({
          id: nextId(),
          kind: 'cue',
          cueId: id,
          local: structuredClone(l),
          remote: null,
          fields: CUE_FIELDS.filter((f) => !isEqual(l[f], b[f])),
        })
        merged.push(structuredClone(l))
      }
      continue
    }

    // 三方都存在：逐字段合并
    const cueConflicts: string[] = []
    const result: Record<string, unknown> = { ...l }
    for (const field of CUE_FIELDS) {
      const bv = b![field]
      const lv = l[field]
      const rv = r[field]
      const lChanged = !isEqual(lv, bv)
      const rChanged = !isEqual(rv, bv)
      if (lChanged && rChanged && !isEqual(lv, rv)) {
        // 两边都改了同一字段且不一致 → 保留本地版，等裁决
        cueConflicts.push(field)
        result[field] = structuredClone(lv)
      } else if (rChanged) {
        result[field] = structuredClone(rv)
      } else {
        result[field] = structuredClone(lv)
      }
    }
    const { comments, conflicts: commentConflicts } = mergeComments(
      b!.comments ?? [],
      l.comments ?? [],
      r.comments ?? [],
      id,
      nextId,
    )
    result.comments = comments
    merged.push(result as Cue)
    if (cueConflicts.length) {
      conflicts.push({
        id: nextId(),
        kind: 'cue',
        cueId: id,
        local: structuredClone(l),
        remote: structuredClone(r),
        fields: cueConflicts,
      })
    }
    conflicts.push(...commentConflicts)
  }

  return { merged, conflicts }
}
