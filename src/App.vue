<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useWorkshopStore } from './stores/workshop'
import ConflictResolver from './components/ConflictResolver.vue'

const route = useRoute()
const store = useWorkshopStore()
const mobileOpen = ref(false)
const title = computed(() => String(route.meta.title ?? '巡演舞台'))

const nav = [
  { to: '/', label: '巡演总览', icon: '总' },
  { to: '/stage', label: '舞台走位', icon: '图' },
  { to: '/script', label: '排练脚本', icon: '序' },
  { to: '/print', label: '打印中心', icon: '印' },
]

const syncStatusText = computed(() => {
  if (store.isOffline) return '离线中 · 编辑进入本地批次'
  if (store.syncing) return '正在同步…'
  if (store.outbox) return '有批次等待重试'
  return '协作服务正常'
})

async function syncNow() {
  const ok = await store.syncNow()
  if (!ok) {
    ElMessage.warning(store.lastSyncError || '同步失败，批次已保留')
    return
  }
  if (store.lastSyncDedup) ElMessage.info('同号批次已去重，未生成重复版本')
  if (store.pendingConflicts.length) {
    ElMessage.warning(`已合并，${store.pendingConflicts.length} 项冲突待裁决`)
    store.conflictResolverOpen = true
  } else {
    ElMessage.success(`已同步至云端 R${store.syncedRev}`)
  }
}

onMounted(() => {
  // 刷新/重开页面时，若还有未同步的离线批次或本地改动，回网后立即合并
  if (!store.isOffline && (store.outbox || store.dirty)) void store.syncNow()
})
</script>

<template>
  <div class="shell">
    <header class="mobile-bar">
      <button class="menu-button" aria-label="切换导航" @click="mobileOpen = !mobileOpen">菜单</button>
      <strong>{{ title }}</strong>
      <span class="mobile-status">{{ store.isOffline ? '离线' : '在线' }}</span>
    </header>

    <aside class="sidebar" :class="{ open: mobileOpen }">
      <div class="brand">
        <div class="brand-mark">巡演</div>
        <div>
          <strong>舞台执行中心</strong>
          <small>《潮汐来信》2026 巡演</small>
        </div>
      </div>

      <nav class="nav-list">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          @click="mobileOpen = false"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="side-card">
        <div class="side-card-title">
          <span class="status-dot" :style="{ background: store.isOffline ? '#d99a2b' : store.outbox ? '#d96b45' : '#45a878' }" />
          {{ syncStatusText }}
        </div>
        <p>本地 {{ store.revision }} · 云端 R{{ store.syncedRev }}<template v-if="store.lastSyncAt"> · 同步于 {{ store.lastSyncAt }}</template></p>
        <p v-if="store.outbox" class="outbox-line">离线批次 {{ store.outbox.batchId }} · 已尝试 {{ store.outbox.attempts }} 次</p>
        <p v-if="store.lastSyncError" class="error-line">{{ store.lastSyncError }}</p>
        <div class="side-actions">
          <button class="ghost-button" @click="store.toggleOffline()">
            {{ store.isOffline ? '恢复连接' : '模拟离线' }}
          </button>
          <button class="ghost-button" :disabled="store.isOffline || store.syncing || (!store.dirty && !store.outbox)" @click="syncNow">
            {{ store.syncing ? '同步中…' : store.outbox ? '重试同步' : '立即同步' }}
          </button>
        </div>
        <label class="fail-sim">
          <span>故障演练</span>
          <select v-model="store.simulateFailMode">
            <option value="none">正常</option>
            <option value="before">下次失败（未提交）</option>
            <option value="after-commit">下次失败（已提交丢响应）</option>
          </select>
        </label>
        <button v-if="store.pendingConflicts.length" class="conflict-button" @click="store.conflictResolverOpen = true">
          {{ store.pendingConflicts.length }} 项合并冲突待裁决
        </button>
      </div>
    </aside>

    <main class="content">
      <RouterView />
    </main>

    <ConflictResolver />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
  background: #eef2f4;
}

.sidebar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  width: 246px;
  height: 100vh;
  flex: 0 0 246px;
  flex-direction: column;
  padding: 20px 14px;
  color: #dfeaf0;
  background: #102231;
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 0 8px 20px;
  border-bottom: 1px solid rgb(255 255 255 / 10%);
}

.brand-mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid #58aeb4;
  border-radius: 9px;
  color: #a9e5df;
  font-size: 13px;
  font-weight: 800;
}

.brand strong,
.brand small {
  display: block;
}

.brand small {
  margin-top: 4px;
  color: #8fa5b5;
  font-size: 11px;
}

.nav-list {
  display: grid;
  gap: 5px;
  padding: 18px 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 7px;
  color: #b9c9d3;
  text-decoration: none;
}

.nav-item.router-link-active {
  color: #fff;
  background: #1d3c4b;
  box-shadow: inset 3px 0 #54b6b4;
}

.nav-icon {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 6px;
  font-size: 11px;
}

.side-card {
  margin-top: auto;
  padding: 13px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 9px;
  background: rgb(255 255 255 / 4%);
}

.side-card-title {
  font-size: 12px;
  font-weight: 700;
}

.side-card p {
  margin: 8px 0 0;
  color: #9eb0bc;
  font-size: 11px;
}

.outbox-line {
  color: #e8b563 !important;
}

.error-line {
  color: #e88f7a !important;
}

.side-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
  margin-top: 11px;
}

.ghost-button {
  width: 100%;
  padding: 8px;
  border: 1px solid #426172;
  border-radius: 6px;
  color: #d9e4e9;
  background: transparent;
  cursor: pointer;
}

.ghost-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.fail-sim {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  color: #8fa5b5;
  font-size: 11px;
}

.fail-sim select {
  max-width: 150px;
  padding: 4px 6px;
  border: 1px solid #426172;
  border-radius: 5px;
  color: #d9e4e9;
  background: #102231;
  font-size: 11px;
}

.conflict-button {
  width: 100%;
  margin-top: 10px;
  padding: 8px;
  border: 1px solid #d8912d;
  border-radius: 6px;
  color: #f4c877;
  background: rgb(216 145 45 / 12%);
  cursor: pointer;
}

.content {
  min-width: 0;
  flex: 1;
}

.mobile-bar {
  display: none;
}

@media (max-width: 860px) {
  .shell {
    display: block;
  }

  .mobile-bar {
    position: sticky;
    top: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 52px;
    padding: 8px 12px;
    color: #fff;
    background: #102231;
  }

  .menu-button {
    padding: 6px 10px;
    border: 1px solid #426172;
    border-radius: 6px;
    color: #fff;
    background: transparent;
  }

  .mobile-status {
    color: #9fd3ce;
    font-size: 12px;
  }

  .sidebar {
    position: fixed;
    top: 52px;
    bottom: 0;
    left: -270px;
    height: auto;
    transition: left 180ms ease;
  }

  .sidebar.open {
    left: 0;
  }
}
</style>
