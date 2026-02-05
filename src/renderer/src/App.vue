<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { SunIcon, MoonIcon } from 'lucide-vue-next'
import GraphView from './views/GraphView.vue'
import SkillSidebar from './components/SkillSidebar.vue'
import Button from './components/ui/button.vue'
import { storageService, fileService } from './services'
import { isElectron } from './lib/env'
import type { SkillFolderItem } from './types/sidebar'
import type { AliasCache } from './types/aliases'

const THEME_KEY = 'app-theme'
const FOLDERS_CACHE_KEY = 'app-folders-cache'
const ALIAS_CACHE_KEY = 'app-alias-cache'
type Theme = 'light' | 'dark'

function isSkillFolderItem(x: unknown): x is SkillFolderItem {
  return (
    typeof x === 'object' &&
    x !== null &&
    'path' in x &&
    typeof (x as SkillFolderItem).path === 'string' &&
    'skills' in x &&
    Array.isArray((x as SkillFolderItem).skills)
  )
}

function loadFoldersFromCache(): SkillFolderItem[] {
  try {
    const parsed = storageService.getItem<unknown>(FOLDERS_CACHE_KEY)
    if (parsed == null || !Array.isArray(parsed)) return []
    if (!Array.isArray(parsed)) return []
    const result: SkillFolderItem[] = []
    for (const item of parsed) {
      if (!isSkillFolderItem(item)) continue
      const skills = (item.skills || []).filter(
        (s: unknown): s is { name: string; description: string } =>
          typeof s === 'object' &&
          s !== null &&
          'name' in s &&
          typeof (s as { name: string }).name === 'string' &&
          'description' in s &&
          typeof (s as { description: string }).description === 'string'
      )
      result.push({ path: item.path, skills })
    }
    return result
  } catch {
    return []
  }
}

function saveFoldersToCache(folders: SkillFolderItem[]) {
  storageService.setItem(FOLDERS_CACHE_KEY, folders)
}

function loadAliasCache(): AliasCache {
  try {
    const parsed = storageService.getItem<unknown>(ALIAS_CACHE_KEY)
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return { directories: {}, skills: {} }
    if (typeof parsed !== 'object' || parsed === null) return { directories: {}, skills: {} }
    const p = parsed as { directories?: unknown; skills?: unknown }
    const dir = p.directories
    const sk = p.skills
    return {
      directories: typeof dir === 'object' && dir !== null ? (dir as Record<string, string>) : {},
      skills: typeof sk === 'object' && sk !== null ? (sk as Record<string, string>) : {}
    }
  } catch {
    return { directories: {}, skills: {} }
  }
}

function saveAliasCache(cache: AliasCache) {
  storageService.setItem(ALIAS_CACHE_KEY, cache)
}

const theme = ref<Theme>('dark')
const sidebarOpen = ref(false)
const fabHidden = ref(false)
/** 与侧栏、图谱共用：一级目录项 → 二级技能列表；启动时从本地缓存恢复 */
const folders = ref<SkillFolderItem[]>(loadFoldersFromCache())
/** 显示命名缓存：目录 path → 显示名，技能 path::name → 显示名；不修改原文件，仅展示用 */
const aliases = ref<AliasCache>(loadAliasCache())

function updateAlias(id: string, displayName: string | null) {
  const next = {
    ...aliases.value,
    directories: { ...aliases.value.directories },
    skills: { ...aliases.value.skills }
  }
  if (id.includes('::')) {
    if (displayName == null || displayName === '') delete next.skills[id]
    else next.skills[id] = displayName
  } else {
    if (displayName == null || displayName === '') delete next.directories[id]
    else next.directories[id] = displayName
  }
  aliases.value = next
  saveAliasCache(next)
}

/** 删除文件夹时清理该文件夹及其下技能的命名缓存，避免重新添加时残留 */
watch(
  folders,
  (val) => {
    const paths = new Set(val.map((f) => f.path))
    let changed = false
    const next: AliasCache = { directories: {}, skills: {} }
    for (const [k, v] of Object.entries(aliases.value.directories)) {
      if (paths.has(k)) {
        next.directories[k] = v
      } else changed = true
    }
    for (const [k, v] of Object.entries(aliases.value.skills)) {
      const path = k.slice(0, k.indexOf('::'))
      if (paths.has(path)) next.skills[k] = v
      else changed = true
    }
    if (changed) {
      aliases.value = next
      saveAliasCache(next)
    }
  },
  { deep: true, immediate: true }
)

/** 当前选中的节点 id：目录为 path，技能为 path::name，与图谱/侧栏联动 */
const selectedNodeId = ref<string | null>(null)
/** 技能介绍弹窗位置（点击位置、节点位置或拖动后的位置） */
const popoverPosition = ref({ x: 100, y: 100 })
/** 列表点击时先不显示弹框，等平移动画结束后再显示，避免定位错位 */
const showPopover = ref(true)
/** 技能介绍弹窗尺寸，可拖动边缘调整 */
const popoverSize = ref({ width: 320, height: 360 })
const POPOVER_MIN_WIDTH = 240
const POPOVER_MIN_HEIGHT = 200
const POPOVER_MAX_WIDTH = 600
const POPOVER_MAX_HEIGHT = () => Math.min(500, window.innerHeight * 0.8)

function openSidebar() {
  fabHidden.value = true
  setTimeout(() => {
    sidebarOpen.value = true
  }, 250)
}

function closeSidebar() {
  sidebarOpen.value = false
  setTimeout(() => {
    fabHidden.value = false
  }, 300)
}

function initTheme() {
  const stored = storageService.getItem<Theme | null>(THEME_KEY)
  if (stored === 'light' || stored === 'dark') theme.value = stored
  applyTheme(theme.value)
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
}

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  applyTheme(theme.value)
  storageService.setItem(THEME_KEY, theme.value)
}

watch(theme, applyTheme)

/** 目录数据变化时写入本地缓存，下次打开时自动恢复 */
watch(folders, (val) => saveFoldersToCache(val), { deep: true })

/** 搜索关键词（与侧栏输入双向绑定），节流后的值用于筛选 */
const searchQuery = ref('')
const throttledSearchQuery = ref('')
const SEARCH_THROTTLE_MS = 300
let searchThrottleTimer: ReturnType<typeof setTimeout> | null = null

watch(
  searchQuery,
  (q) => {
    if (searchThrottleTimer != null) clearTimeout(searchThrottleTimer)
    searchThrottleTimer = setTimeout(() => {
      throttledSearchQuery.value = q
      searchThrottleTimer = null
    }, SEARCH_THROTTLE_MS)
  },
  { immediate: true }
)

onMounted(() => {
  initTheme()
  if (!isElectron() && fileService.restoreHandles) {
    const webPaths = folders.value.filter((f) => f.path.startsWith('__web__')).map((f) => f.path)
    if (webPaths.length) fileService.restoreHandles(webPaths)
  }
})

/** 按关键词筛选：名称或描述包含关键词的技能，同步列表与图谱 */
const filteredFolders = computed(() => {
  const q = throttledSearchQuery.value.trim().toLowerCase()
  if (!q) return folders.value
  return folders.value
    .map((folder) => ({
      ...folder,
      skills: folder.skills.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.description && s.description.toLowerCase().includes(q))
      )
    }))
    .filter((folder) => folder.skills.length > 0 || folder.path.toLowerCase().includes(q))
})

// （预留）图谱与目录共用的数据结构，用于右侧面板展示；目前未使用，避免未读变量的类型告警先注释掉
// const dataPreview = computed(() => JSON.stringify(folders.value, null, 2))

/** 当前选中的技能信息（仅当选中节点为技能时）：用于右上角技能介绍弹窗；displayName 与列表/节点同步 */
const selectedSkillInfo = computed(() => {
  const id = selectedNodeId.value
  if (!id || !id.includes('::')) return null
  const idx = id.indexOf('::')
  const path = id.slice(0, idx)
  const name = id.slice(idx + 2)
  const folder = folders.value.find((f) => f.path === path)
  const skill = folder?.skills.find((s) => s.name === name)
  if (!skill) return null
  const displayName = aliases.value.skills[id] ?? name
  return { name: skill.name, description: skill.description || '', displayName }
})

function closeSkillPopover() {
  selectedNodeId.value = null
}

const graphViewRef = ref<InstanceType<typeof GraphView> | null>(null)

/** 处理选中节点更新：支持 payload 为 string（列表点击，弹窗定位到节点）或 { id, clientX?, clientY? }（图谱点击，弹窗定位到指针） */
function onSelectedNodeIdUpdate(
  payload: string | null | { id: string; clientX?: number; clientY?: number }
) {
  if (payload === null) {
    selectedNodeId.value = null
    return
  }
  if (typeof payload === 'object' && payload !== null && 'id' in payload) {
    selectedNodeId.value = payload.id
    showPopover.value = true
    if (typeof payload.clientX === 'number' && typeof payload.clientY === 'number') {
      popoverPosition.value = { x: payload.clientX, y: payload.clientY }
    }
  } else {
    const nodeId: string = payload
    selectedNodeId.value = nodeId
    showPopover.value = false
    function onListSelectNode() {
      const done = () => {
        const pos = graphViewRef.value?.getNodeScreenPosition(nodeId)
        if (pos) popoverPosition.value = pos
        else {
          requestAnimationFrame(() => {
            const pos2 = graphViewRef.value?.getNodeScreenPosition(nodeId)
            if (pos2) popoverPosition.value = pos2
          })
        }
        showPopover.value = true
      }
      const started = graphViewRef.value?.centerNodeInView(nodeId, done)
      if (!started) done()
    }
    nextTick(onListSelectNode)
  }
}

/** 弹窗拖动 */
let popoverDragStart = { x: 0, y: 0, posX: 0, posY: 0 }
function onPopoverHeadPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  if ((e.target as HTMLElement).closest('.app-skill-popover__close')) return
  const head = e.currentTarget as HTMLElement
  head.setPointerCapture(e.pointerId)
  popoverDragStart = {
    x: e.clientX,
    y: e.clientY,
    posX: popoverPosition.value.x,
    posY: popoverPosition.value.y
  }
  const move = (e2: PointerEvent) => {
    popoverPosition.value = {
      x: popoverDragStart.posX + (e2.clientX - popoverDragStart.x),
      y: popoverDragStart.posY + (e2.clientY - popoverDragStart.y)
    }
  }
  const up = (eUp: PointerEvent) => {
    head.releasePointerCapture(eUp.pointerId)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/** 弹窗边缘调整大小 */
let resizeStart = { x: 0, y: 0, w: 0, h: 0 }
function onPopoverResizePointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  resizeStart = {
    x: e.clientX,
    y: e.clientY,
    w: popoverSize.value.width,
    h: popoverSize.value.height
  }
  const move = (e2: PointerEvent) => {
    const maxH = POPOVER_MAX_HEIGHT()
    const dw = e2.clientX - resizeStart.x
    const dh = e2.clientY - resizeStart.y
    popoverSize.value = {
      width: Math.max(POPOVER_MIN_WIDTH, Math.min(POPOVER_MAX_WIDTH, resizeStart.w + dw)),
      height: Math.max(POPOVER_MIN_HEIGHT, Math.min(maxH, resizeStart.h + dh))
    }
  }
  const up = (eUp: PointerEvent) => {
    handle.releasePointerCapture(eUp.pointerId)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1 class="app-title">技能关系图谱</h1>
      <button
        type="button"
        class="app-theme-btn"
        :title="theme === 'dark' ? '切换为亮色主题' : '切换为暗色主题'"
        aria-label="切换亮色/暗色主题"
        @click="toggleTheme"
      >
        <span class="app-theme-btn__icons">
          <SunIcon
            :class="['app-theme-btn__icon', { 'app-theme-btn__icon--active': theme === 'light' }]"
            aria-hidden="true"
          />
          <MoonIcon
            :class="['app-theme-btn__icon', { 'app-theme-btn__icon--active': theme === 'dark' }]"
            aria-hidden="true"
          />
        </span>
      </button>
    </header>
    <main class="app-main">
      <GraphView
        ref="graphViewRef"
        :selected-node-id="selectedNodeId"
        :folders="filteredFolders"
        :aliases="aliases"
        @update:selected-node-id="onSelectedNodeIdUpdate"
        @update:alias="updateAlias"
      />
    </main>

    <!-- <aside class="app-data-panel" aria-label="当前数据结构">
      <pre class="app-data-panel__pre">{{ dataPreview }}</pre>
    </aside> -->

    <Button
      variant="default"
      size="icon-lg"
      :class="['app-fab', { 'app-fab--hidden': fabHidden }, 'cursor-pointer', 'flex-center']"
      aria-label="添加技能目录"
      title="添加技能目录"
      @click="openSidebar"
    >
      <span class="app-fab__icon" aria-hidden="true">+</span>
    </Button>

    <SkillSidebar
      v-model:folders="folders"
      v-model:search-query="searchQuery"
      :selected-node-id="selectedNodeId"
      :filtered-folders="filteredFolders"
      :aliases="aliases"
      :open="sidebarOpen"
      @close="closeSidebar"
      @update:selected-node-id="onSelectedNodeIdUpdate"
      @update:alias="updateAlias"
    />

    <!-- 技能介绍弹窗：列表点击时在节点位置，图谱点击时在指针位置；可拖动、边缘可调整大小 -->
    <Transition name="app-skill-popover">
      <aside
        v-if="selectedSkillInfo && showPopover"
        class="app-skill-popover"
        role="dialog"
        aria-labelledby="app-skill-popover-title"
        aria-modal="false"
        :style="{
          left: `${popoverPosition.x}px`,
          top: `${popoverPosition.y}px`,
          width: `${popoverSize.width}px`,
          height: `${popoverSize.height}px`
        }"
      >
        <div class="app-skill-popover__head" @pointerdown="onPopoverHeadPointerDown">
          <h2 id="app-skill-popover-title" class="app-skill-popover__title">
            {{ selectedSkillInfo.displayName }}
          </h2>
          <button
            type="button"
            class="app-skill-popover__close"
            aria-label="关闭"
            @click="closeSkillPopover"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="app-skill-popover__body">
          <div class="app-skill-popover__desc" tabindex="0">
            {{ selectedSkillInfo.description || '暂无简介' }}
          </div>
        </div>
        <div
          class="app-skill-popover__resize"
          aria-label="调整大小"
          title="拖动调整大小"
          @pointerdown="onPopoverResizePointerDown"
        />
      </aside>
    </Transition>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.app-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--background);
  border-bottom: 1px solid var(--border);
  color: var(--foreground);
  transition:
    background-color 0.25s ease,
    border-color 0.25s ease,
    color 0.25s ease;
}

.app-theme-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-left: auto;
  border: none;
  border-radius: 8px;
  background: var(--secondary);
  color: var(--foreground);
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.app-theme-btn:hover {
  background: var(--accent);
  color: var(--accent-foreground);
}

.app-theme-btn__icons {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}

.app-theme-btn__icon {
  position: absolute;
  width: 20px;
  height: 20px;
  opacity: 0;
  transform: rotate(-90deg);
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}

.app-theme-btn__icon--active {
  opacity: 1;
  transform: rotate(0deg);
}

.app-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--foreground);
  transition: color 0.25s ease;
}

.app-main {
  flex: 1;
  min-height: 0;
}

.app-data-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 25;
  width: 320px;
  padding: 12px;
  overflow: auto;
  background: var(--graph-toolbar-bg);
  border-left: 1px solid var(--graph-toolbar-border);
  font-size: 11px;
  line-height: 1.4;
  color: var(--foreground);
  transition:
    background-color 0.25s ease,
    border-color 0.25s ease,
    color 0.25s ease;
}

.app-data-panel__pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: ui-monospace, monospace;
}

.app-fab {
  position: fixed;
  left: 20px;
  bottom: 20px;
  z-index: 30;
  background: var(--app-fab-bg) !important;
  color: var(--app-fab-fg) !important;
  border: none !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  transition:
    transform 0.25s ease,
    opacity 0.25s ease,
    filter 0.2s ease;
}

.app-fab:hover {
  filter: brightness(1.15);
}

.app-fab--hidden {
  transform: translateX(-80px) scale(0);
  opacity: 0;
  pointer-events: none;
}

.app-fab__icon {
  font-size: 1.5rem;
  font-weight: 400;
}

/* 技能介绍弹窗：可拖动、边缘可调整大小 */
.app-skill-popover {
  position: fixed;
  z-index: 50;
  transform: translate(8px, 8px);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: var(--background);
  border: 1px solid var(--border);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  transition:
    background-color 0.25s ease,
    border-color 0.25s ease;
}

.app-skill-popover__resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, var(--border) 50%);
  border-radius: 0 0 12px 0;
}

.app-skill-popover__resize:hover {
  background: linear-gradient(135deg, transparent 50%, var(--muted-foreground) 50%);
}

.app-skill-popover__head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  cursor: move;
  user-select: none;
}

.app-skill-popover__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--foreground);
  line-height: 1.3;
  word-break: break-word;
}

.app-skill-popover__close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.app-skill-popover__close:hover {
  background: var(--accent);
  color: var(--accent-foreground);
}

.app-skill-popover__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.app-skill-popover__desc {
  padding: 12px 14px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--foreground);
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.app-skill-popover-enter-active,
.app-skill-popover-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.app-skill-popover-enter-from,
.app-skill-popover-leave-to {
  opacity: 0;
  transform: translateX(8px);
}

.app-skill-popover-enter-to,
.app-skill-popover-leave-from {
  opacity: 1;
  transform: translateX(0);
}
</style>
