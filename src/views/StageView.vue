<script setup lang="ts">
import { computed, ref } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { useWorkshopStore, FIELD_LABELS, type Cue, type Department, type Point } from '../stores/workshop'

const store = useWorkshopStore()
const commentText = ref('')
const showRouteEditor = ref(true)
const departments: Array<'全部' | Department> = ['全部', '舞台', '灯光', '音响', '道具']
const acts = ['全部', '第一幕', '第二幕', '第三幕']

const cue = computed(() => store.selectedCue)
const routePoints = computed(() => cue.value?.route.map((point) => `${point.x},${point.y}`).join(' ') ?? '')
const conflictCues = computed(() => new Set(store.conflicts.map((item) => item.id)))

function selectCue(item: Cue) {
  store.selectedId = item.id
}

function addWaypoint(event: MouseEvent) {
  if (!showRouteEditor.value || store.locked) return
  const target = event.currentTarget as SVGElement
  const rect = target.getBoundingClientRect()
  const x = Math.round(((event.clientX - rect.left) / rect.width) * 100)
  const y = Math.round(((event.clientY - rect.top) / rect.height) * 100)
  store.addWaypoint({ x, y })
  ElMessage.success('已追加路线节点')
}

function saveCue() {
  localStorage.setItem('stage-scheduler-last-action', new Date().toISOString())
  ElMessage.success(store.isOffline ? '已保存到离线草稿' : `已同步 ${store.revision}`)
}

function submitComment() {
  if (!commentText.value.trim()) return
  store.addComment(commentText.value.trim(), '制作人 · 陈曦')
  commentText.value = ''
  ElMessage.success('留言已加入待办')
}

function updateCue(key: keyof Cue, value: unknown) {
  store.updateCue({ [key]: value } as Partial<Cue>)
}

async function remoteEdit() {
  try {
    const result = await store.remoteEdit()
    ElMessage.success(`同事在线修改了 ${result.cueId}：${result.description}，请同步合并`)
  } catch {
    ElMessage.warning('当前离线，无法模拟同事改稿')
  }
}

function formatField(field: string, target: Cue | null): string {
  if (!target) return '（已删除该节点）'
  const value = (target as Record<string, unknown>)[field]
  if (field === 'entry' || field === 'exit') {
    const point = value as Point
    return `(${point.x}, ${point.y})`
  }
  if (field === 'route') return `${(value as Point[]).length} 个节点`
  if (field === 'duration') return `${value} 秒`
  if (Array.isArray(value)) return `${value.length} 项`
  return String(value ?? '—')
}

function conflictTitle(conflict: { kind: string; cueId: string }): string {
  if (conflict.kind === 'comment') return `${conflict.cueId} · 部门留言冲突`
  return `${conflict.cueId} · 走位冲突`
}
</script>

<template>
  <section class="page stage-page">
    <div class="page-head">
      <div>
        <p class="eyebrow">STAGING / 走位编排</p>
        <h1>舞台平面与执行提示</h1>
        <p class="muted">选择走位后可直接在平面图追加节点；确认锁定时编辑自动停用。</p>
      </div>
      <div class="actions">
        <el-button :disabled="!store.canUndo || store.locked" @click="store.undo()">撤销</el-button>
        <el-button :disabled="!store.canRedo || store.locked" @click="store.redo()">重做</el-button>
        <el-button type="primary" @click="saveCue">{{ store.isOffline ? '保存草稿' : '同步版本' }}</el-button>
      </div>
    </div>

    <el-alert
      v-if="store.conflicts.length"
      class="conflict-alert"
      type="warning"
      show-icon
      :closable="false"
      :title="`发现 ${store.conflicts.length} 个同时触发节点`"
      description="系统已高亮冲突提示，请在右侧检查触发时间与部门优先级。"
    />

    <div class="toolbar panel">
      <div class="filter-group">
        <span>幕次</span>
        <el-select v-model="store.actFilter" size="small" style="width: 112px">
          <el-option v-for="act in acts" :key="act" :label="act" :value="act" />
        </el-select>
        <span>部门</span>
        <el-select v-model="store.departmentFilter" size="small" style="width: 112px">
          <el-option v-for="department in departments" :key="department" :label="department" :value="department" />
        </el-select>
      </div>
      <div class="zoom-control">
        <span>缩放 {{ store.zoom }}%</span>
        <el-slider v-model="store.zoom" :min="70" :max="150" :step="5" style="width: 150px" />
      </div>
      <el-switch v-model="showRouteEditor" active-text="路线编辑" />
      <el-button @click="store.addCue" :disabled="store.locked">新增提示</el-button>
      <el-tag :type="store.locked ? 'success' : 'info'" effect="plain">{{ store.locked ? '基线已锁定' : '草稿编辑中' }}</el-tag>
    </div>

    <el-alert
      v-if="store.hasUnresolvedConflicts"
      class="conflict-alert"
      type="error"
      show-icon
      :closable="false"
      :title="`${store.unresolvedConflicts.length} 项同步冲突待裁决`"
      description="离线期间同一走位或留言两边都做了修改，已保留两版。裁决前相关节点不能确认，演出基线不能锁定。"
    />

    <section v-if="store.unresolvedConflicts.length" class="panel conflict-panel">
      <div class="panel-head">
        <h3>同步冲突 · 待裁决</h3>
        <span class="muted">未裁完不能进入演出基线</span>
      </div>
      <div class="conflict-list">
        <div v-for="conflict in store.unresolvedConflicts" :key="conflict.id" class="conflict-item">
          <div class="conflict-head">
            <strong>{{ conflictTitle(conflict) }}</strong>
            <span class="muted">本地与服务器都修改了同一对象</span>
          </div>
          <div class="conflict-diff">
            <template v-if="conflict.kind === 'cue'">
              <div v-for="field in conflict.fields" :key="field" class="diff-row">
                <span class="diff-field">{{ FIELD_LABELS[field] ?? field }}</span>
                <span class="diff-local">本地：{{ formatField(field, conflict.local) }}</span>
                <span class="diff-remote">服务器：{{ formatField(field, conflict.remote) }}</span>
              </div>
            </template>
            <template v-else>
              <div class="diff-row">
                <span class="diff-field">留言内容</span>
                <span class="diff-local">本地：{{ conflict.local.content }}</span>
                <span class="diff-remote">服务器：{{ conflict.remote.content }}</span>
              </div>
              <div class="diff-row">
                <span class="diff-field">状态</span>
                <span class="diff-local">本地：{{ conflict.local.resolved ? '已解决' : '待处理' }}</span>
                <span class="diff-remote">服务器：{{ conflict.remote.resolved ? '已解决' : '待处理' }}</span>
              </div>
            </template>
          </div>
          <div class="conflict-actions">
            <el-button size="small" @click="store.adjudicateConflict(conflict.id, 'local')">采用本地版</el-button>
            <el-button size="small" type="primary" @click="store.adjudicateConflict(conflict.id, 'remote')">
              采用服务器版
            </el-button>
          </div>
        </div>
      </div>
    </section>

    <section class="panel sync-panel">
      <div class="panel-head">
        <h3>离线同步批次</h3>
        <div class="sync-controls">
          <el-checkbox v-model="store.simulateResponseLoss">模拟响应丢失</el-checkbox>
          <el-button size="small" :loading="store.syncing" @click="store.syncNow">
            {{ store.isOffline ? '保存离线批次' : '立即同步' }}
          </el-button>
          <el-button size="small" :disabled="store.isOffline" @click="remoteEdit">模拟同事改稿</el-button>
        </div>
      </div>
      <div v-if="!store.pendingBatches.length" class="muted empty-batches">暂无同步批次</div>
      <div v-for="batch in store.pendingBatches" :key="batch.id" class="batch-row" :class="batch.status">
        <div class="batch-info">
          <strong>{{ batch.id }}</strong>
          <span class="muted">{{ batch.createdAt }} · {{ batch.cueCount }} 个节点</span>
        </div>
        <div class="batch-status">
          <el-tag v-if="batch.status === 'synced'" type="success" effect="plain" size="small">
            {{ batch.idempotent ? '已去重' : '已同步' }}
            <template v-if="batch.revision"> · R{{ batch.revision }}</template>
          </el-tag>
          <el-tag v-else-if="batch.status === 'failed'" type="danger" effect="plain" size="small">同步失败</el-tag>
          <el-tag v-else type="info" effect="plain" size="small">待同步</el-tag>
          <span v-if="batch.error" class="batch-error">{{ batch.error }}</span>
        </div>
        <div class="batch-actions">
          <el-button v-if="batch.status === 'failed'" size="small" type="primary" @click="store.retryBatch(batch.id)">
            重试
          </el-button>
          <el-button v-if="batch.status === 'synced'" size="small" @click="store.resendBatch(batch.id)">重发</el-button>
        </div>
      </div>
    </section>

    <div class="work-grid">
      <section class="panel stage-panel">
        <div class="panel-head">
          <h3>舞台平面图 · 主视图</h3>
          <span class="muted">点击地面追加路线节点</span>
        </div>
        <div class="stage-scroll">
          <div class="stage-canvas" :style="{ transform: `scale(${store.zoom / 100})` }">
            <div class="stage-label">观众席</div>
            <div class="led-strip">LED 背景幕</div>
            <svg class="stage-svg" viewBox="0 0 100 100" preserveAspectRatio="none" @click="addWaypoint">
              <defs>
                <pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse">
                  <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#cbd6da" stroke-width="0.15" />
                </pattern>
                <marker id="arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
                  <path d="M0,0 L5,2.5 L0,5 z" fill="#287d7c" />
                </marker>
              </defs>
              <rect width="100" height="100" fill="url(#grid)" />
              <rect x="3" y="2" width="94" height="12" rx="1" class="backstage" />
              <rect x="5" y="88" width="90" height="9" rx="1" class="apron" />
              <line x1="50" y1="14" x2="50" y2="88" class="center-line" />
              <template v-for="item in store.filteredCues" :key="item.id">
                <polyline
                  v-if="item.route.length > 1"
                  :points="item.route.map((point) => `${point.x},${point.y}`).join(' ')"
                  :class="['route', { selected: item.id === store.selectedId, conflict: conflictCues.has(item.id) }]"
                  marker-end="url(#arrow)"
                />
                <g class="cue-point" :class="{ selected: item.id === store.selectedId }" @click.stop="selectCue(item)">
                  <circle :cx="item.entry.x" :cy="item.entry.y" r="2.8" />
                  <text :x="item.entry.x + 3.2" :y="item.entry.y + 1">{{ item.id }}</text>
                </g>
              </template>
              <template v-if="cue">
                <circle v-for="(point, index) in cue.route.slice(1, -1)" :key="index" :cx="point.x" :cy="point.y" r="1.5" class="waypoint" />
                <circle :cx="cue.exit.x" :cy="cue.exit.y" r="2.5" class="exit-point" />
              </template>
            </svg>
            <div class="stage-legend">
              <span><i class="entry" />入场</span>
              <span><i class="way" />路线</span>
              <span><i class="exit" />退场</span>
            </div>
          </div>
        </div>
      </section>

      <aside class="panel editor-panel">
        <div v-if="cue" class="editor">
          <div class="editor-title">
            <div>
              <span>{{ cue.id }} · {{ cue.act }}</span>
              <h3>{{ cue.title }}</h3>
            </div>
            <el-tag :type="cue.status === '已确认' ? 'success' : 'warning'" effect="plain">{{ cue.status }}</el-tag>
          </div>

          <el-form label-position="top" size="small" :disabled="store.locked">
            <div class="form-grid">
              <el-form-item label="场景">
                <el-input :model-value="cue.scene" @update:model-value="updateCue('scene', $event)" />
              </el-form-item>
              <el-form-item label="时间码">
                <el-input :model-value="cue.time" @update:model-value="updateCue('time', $event)" />
              </el-form-item>
              <el-form-item label="执行部门">
                <el-select :model-value="cue.department" @update:model-value="updateCue('department', $event)">
                  <el-option v-for="department in departments.slice(1)" :key="department" :label="department" :value="department" />
                </el-select>
              </el-form-item>
              <el-form-item label="责任角色">
                <el-input :model-value="cue.owner" @update:model-value="updateCue('owner', $event)" />
              </el-form-item>
            </div>
            <el-form-item label="执行说明">
              <el-input type="textarea" :rows="3" :model-value="cue.note" @update:model-value="updateCue('note', $event)" />
            </el-form-item>
            <el-form-item label="路线节点 / 触发时机">
              <div class="route-summary">
                <span v-for="(point, index) in cue.route" :key="index">{{ index === 0 ? '入' : index === cue.route.length - 1 ? '出' : index }} ({{ point.x }},{{ point.y }})</span>
              </div>
            </el-form-item>
          </el-form>

          <div class="comment-block">
            <div class="comment-head">
              <strong>部门留言 · {{ cue.comments.filter((item) => !item.resolved).length }} 待处理</strong>
            </div>
            <el-alert
              v-if="store.todoReview.state === 'stale'"
              class="review-alert"
              type="warning"
              show-icon
              :closable="false"
              :title="`留言待办已失效：${store.todoReview.reason}`"
              description="相关节点的基线、确认状态或时间码已变更，待办需重新核对后再执行。"
            >
              <div class="review-actions">
                <el-button size="small" type="primary" @click="store.recheckTodo">重新核对</el-button>
                <span class="muted">涉及 {{ store.todoReview.affectedIds.join('、') || '全部节点' }}</span>
              </div>
            </el-alert>
            <div class="comment-list">
              <div v-for="comment in cue.comments" :key="comment.id" class="comment" :class="{ resolved: comment.resolved }">
                <div>
                  <strong>{{ comment.author }}</strong>
                  <time>{{ comment.createdAt }}</time>
                </div>
                <p>{{ comment.content }}</p>
                <el-button link type="primary" @click="store.toggleComment(comment.id)">
                  {{ comment.resolved ? '重新打开' : '标记解决' }}
                </el-button>
              </div>
              <el-empty v-if="cue.comments.length === 0" description="暂无留言" :image-size="46" />
            </div>
            <div class="comment-input">
              <el-input v-model="commentText" placeholder="输入需其他部门处理的意见" @keyup.enter="submitComment" />
              <el-button type="primary" @click="submitComment">发送</el-button>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <section class="panel cue-strip">
      <div class="panel-head">
        <h3>脚本节点（{{ store.filteredCues.length }}）</h3>
        <span class="muted">按执行时间排序</span>
      </div>
      <div class="cue-cards">
        <button
          v-for="item in [...store.filteredCues].sort((a, b) => a.time.localeCompare(b.time))"
          :key="item.id"
          class="cue-card"
          :class="{ active: item.id === store.selectedId, conflict: conflictCues.has(item.id) }"
          @click="selectCue(item)"
        >
          <span>{{ item.id }} · {{ item.department }}</span>
          <strong>{{ item.title }}</strong>
          <small>{{ item.time }} · {{ item.duration }} 秒</small>
          <el-tag
            v-if="store.conflictCueIds.has(item.id)"
            class="card-conflict-tag"
            type="danger"
            size="small"
            effect="plain"
          >
            冲突待裁决
          </el-tag>
        </button>
      </div>
    </section>
  </section>
</template>

<style scoped>
.stage-page {
  background: #eef2f4;
}

.conflict-alert {
  margin-bottom: 12px;
}

.conflict-panel {
  margin-bottom: 12px;
}

.conflict-list {
  display: grid;
  gap: 10px;
  padding: 12px;
}

.conflict-item {
  padding: 12px;
  border: 1px solid #f0d4c8;
  border-radius: 8px;
  background: #fdf6f2;
}

.conflict-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.conflict-diff {
  display: grid;
  gap: 4px;
  margin-bottom: 10px;
}

.diff-row {
  display: grid;
  grid-template-columns: 90px 1fr 1fr;
  gap: 8px;
  font-size: 12px;
}

.diff-field {
  color: #7a6a62;
  font-weight: 700;
}

.diff-local {
  color: #b05a2b;
}

.diff-remote {
  color: #2f6fb0;
}

.conflict-actions {
  display: flex;
  gap: 8px;
}

.sync-panel {
  margin-bottom: 12px;
}

.sync-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.empty-batches {
  padding: 16px;
  text-align: center;
  font-size: 12px;
}

.batch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-top: 1px solid #eef2f4;
}

.batch-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.batch-info strong {
  font-size: 12px;
  font-family: ui-monospace, monospace;
}

.batch-info span {
  font-size: 11px;
}

.batch-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.batch-error {
  color: #bd4b3f;
  font-size: 11px;
}

.batch-actions {
  display: flex;
  gap: 6px;
}

.review-alert {
  margin-bottom: 10px;
}

.review-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

.card-conflict-tag {
  margin-top: 6px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 12px;
  padding: 10px 14px;
}

.filter-group,
.zoom-control {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #5d6b78;
  font-size: 12px;
}

.toolbar > :nth-last-child(2) {
  margin-left: auto;
}

.work-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(300px, 0.75fr);
  gap: 12px;
}

.stage-panel {
  min-width: 0;
}

.stage-scroll {
  overflow: auto;
  padding: 18px;
  background: #182633;
}

.stage-canvas {
  position: relative;
  width: 100%;
  min-width: 540px;
  aspect-ratio: 16 / 9;
  transform-origin: left top;
  background: #eef1eb;
  box-shadow: 0 12px 30px rgb(0 0 0 / 24%);
}

.stage-label,
.led-strip {
  position: absolute;
  z-index: 2;
  left: 50%;
  transform: translateX(-50%);
  color: #67727a;
  font-size: 10px;
  letter-spacing: 0.2em;
}

.stage-label {
  bottom: 1.6%;
}

.led-strip {
  top: 2.7%;
}

.stage-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

.backstage {
  fill: #d8ddd6;
  opacity: 0.75;
}

.apron {
  fill: #dfe5df;
  opacity: 0.65;
}

.center-line {
  stroke: #9aa6a2;
  stroke-width: 0.2;
  stroke-dasharray: 1 1;
}

.route {
  fill: none;
  stroke: #4a8e8b;
  stroke-width: 0.75;
  stroke-linejoin: round;
}

.route.selected {
  stroke: #c36e23;
  stroke-width: 1.1;
}

.route.conflict {
  stroke: #cc4f42;
  stroke-dasharray: 2 1.2;
}

.cue-point circle {
  fill: #fff;
  stroke: #247d7b;
  stroke-width: 0.7;
}

.cue-point text {
  fill: #213d46;
  font-size: 2.2px;
  font-weight: 800;
  cursor: pointer;
}

.cue-point.selected circle {
  fill: #f7b54b;
  stroke: #9f4a17;
  stroke-width: 1;
}

.waypoint {
  fill: #f2a43c;
  stroke: #8a4d12;
  stroke-width: 0.4;
}

.exit-point {
  fill: #bb4d3e;
  stroke: #fff;
  stroke-width: 0.5;
}

.stage-legend {
  position: absolute;
  right: 2%;
  bottom: 3%;
  z-index: 3;
  display: flex;
  gap: 10px;
  padding: 6px 8px;
  color: #44515b;
  background: rgb(255 255 255 / 88%);
  font-size: 10px;
}

.stage-legend i {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 4px;
  border-radius: 50%;
}

.stage-legend .entry {
  background: #247d7b;
}

.stage-legend .way {
  background: #f2a43c;
}

.stage-legend .exit {
  background: #bb4d3e;
}

.editor-panel {
  max-height: 730px;
  overflow: auto;
}

.editor {
  padding: 16px;
}

.editor-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 14px;
}

.editor-title span {
  color: #6b7883;
  font-size: 11px;
}

.editor-title h3 {
  margin: 4px 0 0;
  font-size: 18px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.route-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.route-summary span {
  padding: 3px 6px;
  border: 1px solid #dbe2e5;
  border-radius: 4px;
  color: #53606c;
  background: #f6f8f8;
  font-size: 11px;
}

.comment-block {
  padding-top: 12px;
  border-top: 1px solid #e4e9eb;
}

.comment-head {
  margin-bottom: 8px;
  font-size: 13px;
}

.comment-list {
  display: grid;
  gap: 8px;
  max-height: 190px;
  overflow: auto;
}

.comment {
  padding: 9px;
  border: 1px solid #e5eaec;
  border-radius: 6px;
  background: #f9fafa;
}

.comment.resolved {
  opacity: 0.65;
}

.comment div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}

.comment time {
  color: #87929b;
}

.comment p {
  margin: 6px 0 3px;
  font-size: 12px;
  line-height: 1.5;
}

.comment-input {
  display: flex;
  gap: 7px;
  margin-top: 10px;
}

.cue-strip {
  margin-top: 12px;
}

.cue-cards {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 12px;
}

.cue-card {
  min-width: 190px;
  padding: 11px;
  border: 1px solid #dce3e7;
  border-radius: 7px;
  text-align: left;
  background: #fff;
  cursor: pointer;
}

.cue-card.active {
  border-color: #2f8580;
  box-shadow: 0 0 0 2px rgb(47 133 128 / 14%);
}

.cue-card.conflict {
  border-left: 4px solid #cf5b3f;
}

.cue-card span,
.cue-card small {
  display: block;
  color: #76838e;
  font-size: 10px;
}

.cue-card strong {
  display: block;
  margin: 6px 0;
  font-size: 13px;
}

@media (max-width: 1080px) {
  .work-grid {
    grid-template-columns: 1fr;
  }

  .editor-panel {
    max-height: none;
  }
}

@media (max-width: 760px) {
  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .toolbar > :nth-last-child(2) {
    margin-left: 0;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
