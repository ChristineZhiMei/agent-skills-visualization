<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { abbreviatePath } from '../data/mockSidebar'
import { fileService } from '../services'
import { isElectron } from '../lib/env'
import type { SkillFolderItem } from '../types/sidebar'
import type { AliasCache } from '../types/aliases'
import Button from './ui/button.vue'
import Input from './ui/input.vue'
import { ScrollArea } from './ui/scroll-area'
import { Plus, Minus, Check, X, RefreshCw } from 'lucide-vue-next'

const SIDE_INSET = 16
const TOP_INSET = 72
const BOTTOM_GAP = 16
const MIN_WIDTH = 280
const DEFAULT_WIDTH = 360

const props = defineProps<{
  open: boolean
  folders: SkillFolderItem[]
  /** 搜索筛选后的目录（与图谱同步，由父组件节流计算） */
  filteredFolders: SkillFolderItem[]
  /** 搜索关键词（与父组件双向绑定，用于输入框展示） */
  searchQuery: string
  /** 当前选中的节点 id：目录为 path，技能为 path::name，与图谱联动 */
  selectedNodeId: string | null
  /** 显示命名缓存，与图谱同步 */
  aliases: AliasCache
}>()

const emit = defineEmits<{
  close: []
  'update:folders': [value: SkillFolderItem[]]
  'update:searchQuery': [value: string]
  'update:selectedNodeId': [value: string | null | { id: string; clientX: number; clientY: number }]
  'update:alias': [id: string, displayName: string | null]
}>()
const panelWidth = ref(DEFAULT_WIDTH)
const isDragging = ref(false)
let lastClientX = 0

/** 删除模式：加号变对勾、减号变叉，一层列表项右侧显示多选 */
const isDeleteMode = ref(false)
const selectedToDelete = ref<Set<string>>(new Set())
const addFolderLoading = ref(false)
/** 刷新：根据已选一层目录重新读取 SKILL.md */
const refreshLoading = ref(false)
/** 添加文件夹对话框：支持手动填写路径与选择文件夹 */
const addDialogOpen = ref(false)
const addDialogPath = ref('')

/** 最大宽度：屏幕宽度的 2/3 */
const maxWidthPx = computed(() => Math.floor(window.innerWidth * (2 / 3)))

function startDrag(e: MouseEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  isDragging.value = true
  lastClientX = e.clientX
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'ew-resize'
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return
  const delta = e.clientX - lastClientX
  lastClientX = e.clientX
  const next = Math.min(maxWidthPx.value, Math.max(MIN_WIDTH, panelWidth.value + delta))
  panelWidth.value = next
}

function stopDrag() {
  if (isDragging.value) {
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }
  isDragging.value = false
}

onMounted(() => {
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
})

const expandedPaths = ref<Set<string>>(new Set(props.folders.map((f) => f.path)))

/** 选中技能时展开其所在目录，便于在列表中看到 */
function getSkillNodeId(folderPath: string, skillName: string): string {
  return `${folderPath}::${skillName}`
}
function isFolderSelected(path: string): boolean {
  return props.selectedNodeId === path
}
function isSkillSelected(folderPath: string, skillName: string): boolean {
  return props.selectedNodeId === getSkillNodeId(folderPath, skillName)
}

watch(
  () => props.selectedNodeId,
  (id) => {
    if (id && id.includes('::')) {
      const folderPath = id.slice(0, id.indexOf('::'))
      expandedPaths.value = new Set([...expandedPaths.value, folderPath])
    }
  },
  { immediate: true }
)

function toggleFolder(path: string) {
  const next = new Set(expandedPaths.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expandedPaths.value = next
}

function isExpanded(path: string) {
  return expandedPaths.value.has(path)
}

const supportsLocalFolder = fileService.supportsLocalFolder()
const isElectronEnv = isElectron()

/** 加号：打开添加文件夹对话框（支持手动填写路径与选择文件夹） */
function onAddFolder() {
  if (isDeleteMode.value) return
  addDialogPath.value = ''
  addDialogOpen.value = true
}

/** 对话框中「选择文件夹」：唤起系统选择并扫描，成功后直接添加并关闭 */
async function onAddDialogPickFolder() {
  addFolderLoading.value = true
  try {
    const result = await fileService.openFolder()
    if (!result) return
    const { path: resolvedPath, skills } = result
    const existing = props.folders.find((f) => f.path === resolvedPath)
    if (existing) {
      emit(
        'update:folders',
        props.folders.map((f) => (f.path === resolvedPath ? { path: resolvedPath, skills } : f))
      )
    } else {
      emit('update:folders', [...props.folders, { path: resolvedPath, skills }])
      expandedPaths.value = new Set([...expandedPaths.value, resolvedPath])
    }
    addDialogOpen.value = false
    addDialogPath.value = ''
  } catch (e) {
    console.error('选择文件夹失败:', e)
    alert((e instanceof Error ? e.message : String(e)) || '选择文件夹失败')
  } finally {
    addFolderLoading.value = false
  }
}

/** 对话框中「确定」：根据手动填写的路径扫描并加入列表（仅 Electron 支持） */
async function onAddDialogConfirm() {
  const path = addDialogPath.value.trim()
  if (!path) return
  addFolderLoading.value = true
  try {
    const result = await fileService.refreshFolder(path)
    if (!result) return
    const { path: resolvedPath, skills } = result
    const existing = props.folders.find((f) => f.path === resolvedPath)
    if (existing) {
      emit(
        'update:folders',
        props.folders.map((f) => (f.path === resolvedPath ? { path: resolvedPath, skills } : f))
      )
    } else {
      emit('update:folders', [...props.folders, { path: resolvedPath, skills }])
      expandedPaths.value = new Set([...expandedPaths.value, resolvedPath])
    }
    addDialogOpen.value = false
    addDialogPath.value = ''
  } catch (e) {
    console.error('添加文件夹失败:', e)
    alert((e instanceof Error ? e.message : String(e)) || '扫描目录失败，请检查路径是否正确')
  } finally {
    addFolderLoading.value = false
  }
}

function onAddDialogCancel() {
  addDialogOpen.value = false
  addDialogPath.value = ''
}

/** 减号：进入删除模式（加号→对勾，减号→叉）；再次点减号取消删除模式 */
function onMinusOrCancel() {
  if (isDeleteMode.value) {
    isDeleteMode.value = false
    selectedToDelete.value = new Set()
  } else {
    isDeleteMode.value = true
    selectedToDelete.value = new Set()
  }
}

/** 对勾：确认删除选中的记录（仅删存储，不删磁盘文件夹） */
function onConfirmDelete() {
  const toRemove = selectedToDelete.value
  toRemove.forEach((path) => fileService.removeHandle?.(path))
  emit(
    'update:folders',
    props.folders.filter((f) => !toRemove.has(f.path))
  )
  expandedPaths.value = new Set([...expandedPaths.value].filter((p) => !toRemove.has(p)))
  isDeleteMode.value = false
  selectedToDelete.value = new Set()
}

function toggleSelectPath(path: string) {
  const next = new Set(selectedToDelete.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  selectedToDelete.value = next
}

function isSelectedToDelete(path: string) {
  return selectedToDelete.value.has(path)
}

/** 刷新：根据当前一层目录重新读取各目录下 SKILL.md，更新二级技能列表 */
async function onRefresh() {
  if (refreshLoading.value || props.folders.length === 0 || !supportsLocalFolder) return
  refreshLoading.value = true
  try {
    const next = await Promise.all(
      props.folders.map(async (f) => {
        try {
          const res = await fileService.refreshFolder(f.path)
          return res ? { path: res.path, skills: res.skills } : f
        } catch {
          return f
        }
      })
    )
    emit('update:folders', next)
  } finally {
    refreshLoading.value = false
  }
}

/** 列表项命名编辑：当前编辑的 id（path 或 path::name） */
const editingListId = ref<string | null>(null)
const editingListValue = ref('')
const editingListInputEl = ref<HTMLInputElement | null>(null)

function getFolderDisplayName(path: string): string {
  return props.aliases.directories[path] ?? abbreviatePath(path)
}

function getSkillDisplayName(folderPath: string, skillName: string): string {
  const id = getSkillNodeId(folderPath, skillName)
  return props.aliases.skills[id] ?? skillName
}

function startEditFolder(path: string) {
  editingListId.value = path
  editingListValue.value = getFolderDisplayName(path)
  nextTick(() => {
    editingListInputEl.value?.focus()
    editingListInputEl.value?.select()
  })
}

function startEditSkill(folderPath: string, skillName: string) {
  const id = getSkillNodeId(folderPath, skillName)
  editingListId.value = id
  editingListValue.value = getSkillDisplayName(folderPath, skillName)
  nextTick(() => {
    editingListInputEl.value?.focus()
    editingListInputEl.value?.select()
  })
}

function getListOriginalDisplay(id: string): string {
  if (id.includes('::')) return id.slice(id.indexOf('::') + 2)
  return abbreviatePath(id)
}

function commitEditList() {
  const id = editingListId.value
  if (id == null) return
  const original = getListOriginalDisplay(id)
  const val = editingListValue.value.trim()
  if (val === '' || val === original) {
    emit('update:alias', id, null)
  } else {
    emit('update:alias', id, val)
  }
  editingListId.value = null
  editingListInputEl.value = null
}

function onListInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitEditList()
  }
  if (e.key === 'Escape') {
    editingListId.value = null
  }
}

function resetFolderAlias(path: string) {
  emit('update:alias', path, null)
  editingListId.value = null
  editingListInputEl.value = null
}

function resetSkillAlias(folderPath: string, skillName: string) {
  emit('update:alias', getSkillNodeId(folderPath, skillName), null)
  editingListId.value = null
  editingListInputEl.value = null
}
</script>

<template>
  <Teleport to="body">
    <div class="skill-panel-wrap" aria-hidden="true">
      <Transition name="skill-panel">
        <aside
          v-show="open"
          class="skill-panel"
          :style="{
            left: `${SIDE_INSET}px`,
            top: `${TOP_INSET}px`,
            width: `${Math.min(panelWidth, maxWidthPx)}px`,
            height: `calc(100vh - ${TOP_INSET + BOTTOM_GAP}px)`
          }"
          role="dialog"
          aria-label="技能目录"
        >
          <div class="skill-panel__inner flex flex-col border border-border shadow-lg">
            <div
              class="flex shrink-0 items-center justify-between border-b border-border px-4 py-3"
            >
              <h2 class="text-sm font-semibold text-foreground">已添加的 skill 文件夹</h2>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                aria-label="关闭"
                @click="emit('close')"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </Button>
            </div>

            <div
              class="skill-panel__tool-row flex shrink-0 items-center gap-2 border-b border-border px-3 py-2"
            >
              <Input
                :model-value="props.searchQuery"
                type="text"
                placeholder="搜索（名称或描述）…"
                class="min-w-0 flex-1"
                @update:model-value="
                  emit(
                    'update:searchQuery',
                    typeof $event === 'string' ? $event : String($event ?? '')
                  )
                "
              />
              <div class="flex shrink-0 gap-1">
                <Button
                  v-if="!isDeleteMode && supportsLocalFolder"
                  variant="default"
                  size="icon"
                  class="skill-panel__btn-square skill-panel__btn-add h-9 w-9"
                  aria-label="添加文件夹"
                  @click="onAddFolder"
                >
                  <Plus class="size-4" />
                </Button>
                <Button
                  v-else
                  variant="default"
                  size="icon"
                  class="skill-panel__btn-square skill-panel__btn-add h-9 w-9"
                  aria-label="确认删除"
                  @click="onConfirmDelete"
                >
                  <Check class="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  class="skill-panel__btn-square h-9 w-9"
                  :aria-label="isDeleteMode ? '取消删除' : '删除记录'"
                  @click="onMinusOrCancel"
                >
                  <Minus v-if="!isDeleteMode" class="size-4" />
                  <X v-else class="size-4" />
                </Button>
                <Button
                  v-if="supportsLocalFolder"
                  variant="outline"
                  size="icon"
                  class="skill-panel__btn-square h-9 w-9"
                  aria-label="刷新"
                  title="根据已选目录重新读取 SKILL.md"
                  :disabled="refreshLoading || props.folders.length === 0"
                  @click="onRefresh"
                >
                  <RefreshCw :class="['size-4', { 'animate-spin': refreshLoading }]" />
                </Button>
              </div>
            </div>

            <div
              class="skill-panel__list-wrap relative flex-1 min-h-0 overflow-hidden flex flex-col"
            >
              <ScrollArea class="flex-1 min-h-0 px-2 py-2">
                <ul class="space-y-0.5">
                  <li v-for="folder in filteredFolders" :key="folder.path" class="rounded-md">
                    <div
                      class="skill-panel__folder-row flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium"
                      :class="[
                        isDeleteMode ? 'cursor-default' : '',
                        {
                          'skill-panel__row--selected':
                            !isDeleteMode && isFolderSelected(folder.path)
                        }
                      ]"
                      @click="
                        !isDeleteMode &&
                        (toggleFolder(folder.path), emit('update:selectedNodeId', folder.path))
                      "
                      @dblclick.stop="!isDeleteMode && startEditFolder(folder.path)"
                    >
                      <button
                        v-if="!isDeleteMode"
                        type="button"
                        class="shrink-0 rounded p-0.5 hover:bg-accent"
                        aria-label="展开/收起"
                        @click.stop="toggleFolder(folder.path)"
                      >
                        <span
                          class="inline-block transition-transform"
                          :class="isExpanded(folder.path) ? 'rotate-90' : ''"
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
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                        </span>
                      </button>
                      <span v-else class="w-5 shrink-0" />
                      <template v-if="editingListId === folder.path">
                        <input
                          :ref="
                            (el) => {
                              if (editingListId === folder.path)
                                editingListInputEl = (el as HTMLInputElement | null) ?? null
                            }
                          "
                          v-model="editingListValue"
                          type="text"
                          class="skill-panel__row-input min-w-0 flex-1 truncate bg-transparent px-0 py-0 text-inherit outline-none"
                          :title="folder.path"
                          @keydown="onListInputKeydown"
                          @blur="commitEditList"
                          @click.stop
                        />
                      </template>
                      <span
                        v-else
                        class="min-w-0 flex-1 truncate"
                        :class="{
                          'skill-panel__text-deleting':
                            isDeleteMode && isSelectedToDelete(folder.path)
                        }"
                        :title="folder.path"
                      >
                        {{ getFolderDisplayName(folder.path) }}
                      </span>
                      <template v-if="isDeleteMode">
                        <Button
                          variant="outline"
                          size="sm"
                          class="skill-panel__row-action h-7 shrink-0 px-2 text-xs"
                          :aria-label="isSelectedToDelete(folder.path) ? '取消删除' : '标记删除'"
                          @click.stop="toggleSelectPath(folder.path)"
                        >
                          {{ isSelectedToDelete(folder.path) ? '取消' : '删除' }}
                        </Button>
                      </template>
                      <template v-else-if="editingListId === folder.path">
                        <Button
                          variant="outline"
                          size="sm"
                          class="skill-panel__row-action h-7 shrink-0 px-2 text-xs"
                          aria-label="重置显示名"
                          @mousedown.prevent.stop="resetFolderAlias(folder.path)"
                        >
                          重置
                        </Button>
                      </template>
                    </div>
                    <ul
                      v-show="isExpanded(folder.path)"
                      class="ml-6 mt-0.5 space-y-0.5 border-l border-border pl-3"
                    >
                      <li
                        v-for="skill in folder.skills"
                        :key="skill.name"
                        class="skill-panel__skill-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer"
                        :class="[
                          {
                            'skill-panel__text-deleting':
                              isDeleteMode && isSelectedToDelete(folder.path)
                          },
                          {
                            'skill-panel__row--selected':
                              !isDeleteMode && isSkillSelected(folder.path, skill.name)
                          }
                        ]"
                        :title="skill.description"
                        @click.stop="
                          !isDeleteMode &&
                          emit('update:selectedNodeId', getSkillNodeId(folder.path, skill.name))
                        "
                        @dblclick.stop="!isDeleteMode && startEditSkill(folder.path, skill.name)"
                      >
                        <template v-if="editingListId === getSkillNodeId(folder.path, skill.name)">
                          <input
                            :ref="
                              (el) => {
                                if (editingListId === getSkillNodeId(folder.path, skill.name))
                                  editingListInputEl = (el as HTMLInputElement | null) ?? null
                              }
                            "
                            v-model="editingListValue"
                            type="text"
                            class="skill-panel__row-input min-w-0 flex-1 truncate bg-transparent px-0 py-0 text-inherit outline-none"
                            @keydown="onListInputKeydown"
                            @blur="commitEditList"
                            @click.stop
                          />
                        </template>
                        <span v-else class="min-w-0 flex-1 truncate">{{
                          getSkillDisplayName(folder.path, skill.name)
                        }}</span>
                        <Button
                          v-if="
                            editingListId === getSkillNodeId(folder.path, skill.name) &&
                            !isDeleteMode
                          "
                          variant="outline"
                          size="sm"
                          class="skill-panel__row-action h-6 shrink-0 px-1.5 text-xs cursor-pointer"
                          aria-label="重置显示名"
                          @mousedown.prevent.stop="resetSkillAlias(folder.path, skill.name)"
                        >
                          重置
                        </Button>
                      </li>
                    </ul>
                  </li>
                </ul>
                <p
                  v-if="filteredFolders.length === 0"
                  class="px-3 py-4 text-center text-sm text-muted-foreground"
                >
                  暂无匹配的文件夹或技能
                </p>
              </ScrollArea>
              <Transition name="skill-panel-fade">
                <div
                  v-if="refreshLoading"
                  class="skill-panel__loading absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-b-xl bg-background/80 text-sm text-muted-foreground"
                  aria-live="polite"
                >
                  <RefreshCw class="size-8 animate-spin text-primary" aria-hidden="true" />
                  <span>刷新中…</span>
                </div>
              </Transition>
            </div>
          </div>
          <div class="skill-panel__resize" aria-hidden="true" @mousedown.prevent="startDrag" />
        </aside>
      </Transition>

      <!-- 添加文件夹对话框：支持手动填写路径与选择文件夹 -->
      <Transition name="skill-panel-fade">
        <div
          v-if="addDialogOpen"
          class="skill-add-dialog"
          role="dialog"
          aria-labelledby="skill-add-dialog-title"
          aria-modal="true"
          @click.self="onAddDialogCancel"
        >
          <div class="skill-add-dialog__box">
            <h3 id="skill-add-dialog-title" class="skill-add-dialog__title">添加 skill 文件夹</h3>
            <p class="skill-add-dialog__hint">
              {{ isElectronEnv ? '填写文件夹路径，或点击「选择文件夹」从系统选择。' : '点击「选择文件夹」选择本地目录。' }}
            </p>
            <div v-if="isElectronEnv" class="skill-add-dialog__row">
              <Input
                v-model="addDialogPath"
                type="text"
                placeholder="例如：/Users/me/.cursor/skills 或 ~/.cursor/skills"
                class="skill-add-dialog__input"
                @keydown.enter="onAddDialogConfirm"
              />
              <Button
                variant="default"
                class="skill-add-dialog__pick skill-add-dialog__confirm"
                @click="onAddDialogPickFolder"
              >
                选择文件夹
              </Button>
            </div>
            <template v-else>
              <div class="skill-add-dialog__row">
                <Button
                  variant="default"
                  class="skill-add-dialog__pick skill-add-dialog__confirm w-full"
                  :disabled="addFolderLoading"
                  @click="onAddDialogPickFolder"
                >
                  {{ addFolderLoading ? '扫描中…' : '选择文件夹' }}
                </Button>
              </div>
            </template>
            <div class="skill-add-dialog__actions">
              <Button variant="outline" @click="onAddDialogCancel">取消</Button>
              <Button
                v-if="isElectronEnv"
                variant="default"
                class="skill-add-dialog__confirm"
                :disabled="addFolderLoading || !addDialogPath.trim()"
                @click="onAddDialogConfirm"
              >
                {{ addFolderLoading ? '扫描中…' : '确定' }}
              </Button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
/* 弹出层不遮罩：仅面板可点击，其他区域透传 */
.skill-panel-wrap {
  position: fixed;
  inset: 0;
  z-index: 40;
  pointer-events: none;
}

.skill-panel {
  position: fixed;
  z-index: 50;
  min-width: 280px;
  max-width: 66.666%;
  border-radius: 12px;
  pointer-events: auto;
  overflow: visible;
}

.skill-panel-enter-active,
.skill-panel-leave-active {
  transition:
    opacity 0.2s ease-out,
    transform 0.2s ease-out;
}

.skill-panel-enter-from,
.skill-panel-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(-8px);
}

.skill-panel-enter-to,
.skill-panel-leave-from {
  opacity: 1;
  transform: scale(1) translateY(0);
}

.skill-panel__btn-square {
  border-radius: 8px;
}

.skill-panel__tool-row {
  position: relative;
  z-index: 5;
  background: var(--graph-toolbar-bg);
}

.skill-panel__btn-add {
  background: var(--graph-zoom-btn-bg) !important;
  color: var(--graph-zoom-btn-fg) !important;
  border-color: transparent !important;
}

.skill-panel__btn-add:hover:not(:disabled) {
  filter: brightness(1.08);
}

.skill-panel-fade-enter-active,
.skill-panel-fade-leave-active {
  transition: opacity 0.2s ease;
}

.skill-panel-fade-enter-from,
.skill-panel-fade-leave-to {
  opacity: 0;
}

.skill-panel__folder-row {
  transition: background-color 0.15s ease;
}

.skill-panel__folder-row:hover {
  background-color: var(--accent);
}

.skill-panel__skill-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.skill-panel__row-input {
  font: inherit;
  border: none;
  border-radius: 2px;
}

/* 列表项选中状态：与图谱节点联动 */
.skill-panel__row--selected {
  background-color: var(--accent);
  color: var(--accent-foreground);
}

.skill-panel__row--selected.skill-panel__folder-row {
  font-weight: 600;
}

/* 删除模式下选中项：菜单项及子项文字添加删除线 */
.skill-panel__text-deleting {
  text-decoration: line-through;
  color: var(--muted-foreground);
}

/* 右侧拖拽条：拖动改变宽度 */
.skill-panel__resize {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 10px;
  cursor: ew-resize;
  z-index: 10;
  flex-shrink: 0;
}

.skill-panel__inner {
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  border-radius: 12px;
  overflow: hidden;
  background: var(--graph-toolbar-bg);
}

/* 添加文件夹对话框 */
.skill-add-dialog {
  position: fixed;
  inset: 0;
  z-index: 60;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}

.skill-add-dialog__box {
  width: 90%;
  max-width: 420px;
  padding: 20px;
  border-radius: 12px;
  background: var(--graph-toolbar-bg);
  border: 1px solid var(--graph-toolbar-border);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
}

.skill-add-dialog__title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--foreground);
}

.skill-add-dialog__hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--muted-foreground);
}

.skill-add-dialog__row {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.skill-add-dialog__field {
  margin-bottom: 12px;
}

.skill-add-dialog__field:last-of-type {
  margin-bottom: 16px;
}

.skill-add-dialog__label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--foreground);
}

.skill-add-dialog__input {
  flex: 1;
  min-width: 0;
}

.skill-add-dialog__pick {
  flex-shrink: 0;
}

.skill-add-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.skill-add-dialog__confirm {
  background: var(--graph-zoom-btn-bg) !important;
  color: var(--graph-zoom-btn-fg) !important;
  border-color: transparent !important;
}
</style>
