<script setup lang="ts">
import { computed } from 'vue'
import { useWorkshopStore } from '../stores/workshop'
import { formatConflictValue } from '../sync/merge'

const store = useWorkshopStore()
const open = computed({
  get: () => store.conflictResolverOpen,
  set: (value: boolean) => {
    store.conflictResolverOpen = value
  },
})
</script>

<template>
  <el-dialog v-model="open" title="合并冲突裁决" width="760px" class="resolver-dialog">
    <p class="resolver-tip">
      同一走位或留言在断网期间被两边改过，两版都已保留。逐条裁决后结果会随下次同步推送云端；<strong>未裁完不能锁定演出基线</strong>。
    </p>

    <el-empty v-if="store.pendingConflicts.length === 0" description="没有待裁决的冲突" :image-size="64" />

    <div v-for="conflict in store.pendingConflicts" :key="conflict.id" class="conflict-item">
      <div class="conflict-head">
        <strong>{{ conflict.cueId }} · {{ conflict.cueTitle }}</strong>
        <el-tag size="small" type="warning" effect="plain">{{ conflict.fieldLabel }}</el-tag>
      </div>
      <div class="version-grid">
        <div class="version-card local">
          <div class="version-head">
            <span>本地离线版 · 舞台监督</span>
            <el-button size="small" type="primary" plain @click="store.resolveConflict(conflict.id, 'local')">保留本地</el-button>
          </div>
          <p>{{ formatConflictValue(conflict.field, conflict.localValue) }}</p>
        </div>
        <div class="version-card remote">
          <div class="version-head">
            <span>云端协作版 · 制作人</span>
            <el-button size="small" type="warning" plain @click="store.resolveConflict(conflict.id, 'remote')">采用云端</el-button>
          </div>
          <p>{{ formatConflictValue(conflict.field, conflict.remoteValue) }}</p>
        </div>
      </div>
    </div>

    <template #footer>
      <span class="footer-count">剩余 {{ store.pendingConflicts.length }} 项待裁决</span>
      <el-button @click="open = false">稍后处理</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.resolver-tip {
  margin: 0 0 14px;
  color: #5d6b78;
  font-size: 12px;
  line-height: 1.6;
}

.conflict-item {
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid #e3d9c8;
  border-radius: 8px;
  background: #fdfaf4;
}

.conflict-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  font-size: 13px;
}

.version-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.version-card {
  padding: 10px;
  border: 1px solid #e0e6e9;
  border-radius: 6px;
  background: #fff;
}

.version-card.local {
  border-left: 3px solid #2f8580;
}

.version-card.remote {
  border-left: 3px solid #d8912d;
}

.version-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.version-head span {
  color: #6b7883;
  font-size: 11px;
}

.version-card p {
  margin: 8px 0 0;
  color: #37444e;
  font-size: 12px;
  line-height: 1.55;
  word-break: break-all;
}

.footer-count {
  margin-right: 12px;
  color: #8a959d;
  font-size: 12px;
}

@media (max-width: 640px) {
  .version-grid {
    grid-template-columns: 1fr;
  }
}
</style>
