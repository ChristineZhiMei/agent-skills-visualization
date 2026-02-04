<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import gsap from 'gsap'
import * as d3 from 'd3'
import type { GraphNode, GraphEdge } from '../types/graph'
import type { SkillFolderItem } from '../types/sidebar'
import type { AliasCache } from '../types/aliases'
import Button from '../components/ui/button.vue'
import { NativeSelect, NativeSelectOption } from '../components/ui/native-select'

const ZOOM_MIN = 10
const ZOOM_MAX = 500
const ZOOM_PRESETS = [10, 25, 50, 75, 100, 150, 200, 300, 500] as const
const SPACING_MIN = 0
const SPACING_MAX = 80
const SPACING_DEFAULT = 28
/** 斥力最大作用距离（px），超过此距离的节点互不影响，避免“牵一发动全身” */
const CHARGE_DISTANCE_MAX = 200
/** 速度衰减（摩擦力）：每 tick 速度乘以 (1 - velocityDecay)，越大节点停得越快，相互影响次数越少 */
const VELOCITY_DECAY = 0.78
/** 列表点击定位节点：平移动画时长（秒） */
const CENTER_PAN_DURATION = 0.65
/** 列表点击定位节点：轻微缩放比例（1 = 不缩，<1 表示先缩再放大到当前，形成「聚焦」感） */
const CENTER_ZOOM_FROM = 0.97

const props = defineProps<{
  folders: SkillFolderItem[]
  /** 当前选中的节点 id，与侧栏联动 */
  selectedNodeId: string | null
  /** 显示命名缓存，与侧栏同步 */
  aliases: AliasCache
}>()

const emit = defineEmits<{
  'update:selectedNodeId': [value: string | null | { id: string; clientX: number; clientY: number }]
  'update:alias': [id: string, displayName: string | null]
}>()

const containerRef = ref<HTMLElement | null>(null)
const tickCount = ref(0)
const zoomPercent = ref(100)
const panX = ref(0)
const panY = ref(0)
/** 节点最小间距（叠加到碰撞半径），越大节点越分散 */
const minSpacing = ref(SPACING_DEFAULT)
const nodes = ref<GraphNode[]>([])
const edges = ref<GraphEdge[]>([])
let simulation: d3.Simulation<GraphNode, GraphEdge> | null = null
/** 当前「定位节点」动画时间线，用于在新定位时先终止上一次 */
let centerTimeline: gsap.core.Timeline | null = null

/** 由侧栏的一级目录 + 二级技能生成图谱节点与边：父节点 = 目录项，子节点 = 技能名称；label 使用别名若存在 */
function buildGraphFromFolders(
  folders: SkillFolderItem[],
  aliases: AliasCache
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodesList: GraphNode[] = []
  const edgesList: GraphEdge[] = []
  for (const folder of folders) {
    const dirId = folder.path
    const dirLabel = aliases.directories[dirId] ?? folder.path
    nodesList.push({
      id: dirId,
      label: dirLabel,
      type: 'directory',
      originalLabel: folder.path
    })
    for (const skill of folder.skills) {
      const skillId = `${folder.path}::${skill.name}`
      const skillLabel = aliases.skills[skillId] ?? skill.name
      nodesList.push({
        id: skillId,
        label: skillLabel,
        type: 'skill',
        originalLabel: skill.name
      })
      edgesList.push({ source: skillId, target: dirId })
    }
  }
  return { nodes: nodesList, edges: edgesList }
}
let dragNode: GraphNode | null = null
let lastPointerX = 0
let lastPointerY = 0
/** 本次指针是否发生过拖拽，用于区分点击与拖拽 */
let didDragThisPointer = false
/** 防抖：延迟多少 ms 后才视为拖拽开始，快速点击不会触发物理模拟 */
const DRAG_DELAY_MS = 120
/** 移动超过该像素数则立即视为拖拽，不等延迟 */
const DRAG_THRESHOLD_PX = 5

const scale = computed(() => zoomPercent.value / 100)

const contentTransform = computed(
  () => `translate(${panX.value}px, ${panY.value}px) scale(${scale.value})`
)

function zoomIn() {
  zoomPercent.value = Math.min(ZOOM_MAX, zoomPercent.value + 10)
}

function zoomOut() {
  zoomPercent.value = Math.max(ZOOM_MIN, zoomPercent.value - 10)
}

function setZoomPreset(p: number) {
  zoomPercent.value = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, p))
}

const presetOptions = computed(() => {
  const current = zoomPercent.value
  const inPresets = (ZOOM_PRESETS as readonly number[]).includes(current)
  if (inPresets) return [...ZOOM_PRESETS]
  return [...ZOOM_PRESETS, current].sort((a, b) => a - b)
})

const zoomPresetModel = computed({
  get: () => String(zoomPercent.value),
  set: (v) => setZoomPreset(Number(v))
})

const linePositions = computed(() =>
  edges.value.map((e) => {
    const s = nodes.value.find((n) => n.id === e.source)
    const t = nodes.value.find((n) => n.id === e.target)
    return {
      id: `${e.source}-${e.target}`,
      x1: s?.x ?? 0,
      y1: s?.y ?? 0,
      x2: t?.x ?? 0,
      y2: t?.y ?? 0
    }
  })
)

function getCenter() {
  const el = containerRef.value
  if (!el) return { cx: 400, cy: 300 }
  const w = el.clientWidth || 800
  const h = el.clientHeight || 600
  return { cx: w / 2, cy: h / 2 }
}

function startSimulation() {
  const { cx, cy } = getCenter()
  const links = edges.value.map((e) => ({ source: e.source, target: e.target }))

  nodes.value.forEach((node, i) => {
    const angle = (i / nodes.value.length) * 2 * Math.PI
    const r = 40 + Math.random() * 60
    node.x = cx + Math.cos(angle) * r
    node.y = cy + Math.sin(angle) * r
  })

  const spacing = minSpacing.value
  simulation = d3
    .forceSimulation<GraphNode>(nodes.value)
    .velocityDecay(VELOCITY_DECAY)
    .force(
      'link',
      d3.forceLink(links).id((d: GraphNode) => d.id)
    )
    .force('charge', d3.forceManyBody().strength(-35).distanceMax(CHARGE_DISTANCE_MAX))
    .force(
      'collision',
      d3
        .forceCollide<GraphNode>()
        .radius((d) => (d.type === 'directory' ? 50 : 44) + spacing)
        .strength(0.7)
    )
    .on('tick', () => {
      tickCount.value++
    })
}

function onPointerDown(e: PointerEvent, node: GraphNode) {
  if (e.button !== 0) return
  didDragThisPointer = false
  const target = e.currentTarget as HTMLElement
  target.setPointerCapture(e.pointerId)
  lastPointerX = e.clientX
  lastPointerY = e.clientY

  const startDrag = () => {
    didDragThisPointer = true
    dragNode = node
    dragNode.fx = dragNode.x ?? 0
    dragNode.fy = dragNode.y ?? 0
    simulation?.alpha(0.4).restart()
    window.removeEventListener('pointermove', waitingMove)
    window.removeEventListener('pointerup', waitingUp)
    window.removeEventListener('pointercancel', waitingUp)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const move = (e2: PointerEvent) => {
    if (!dragNode) return
    const dx = (e2.clientX - lastPointerX) / scale.value
    const dy = (e2.clientY - lastPointerY) / scale.value
    lastPointerX = e2.clientX
    lastPointerY = e2.clientY
    dragNode.fx = (dragNode.fx ?? 0) + dx
    dragNode.fy = (dragNode.fy ?? 0) + dy
    dragNode.x = dragNode.fx
    dragNode.y = dragNode.fy
    tickCount.value++
  }

  const up = (eUp: PointerEvent) => {
    try {
      target.releasePointerCapture(eUp.pointerId)
    } catch {
      /* already released */
    }
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    if (dragNode) {
      dragNode.fx = undefined
      dragNode.fy = undefined
      dragNode = null
    }
  }

  const waitingMove = (e2: PointerEvent) => {
    if (Math.hypot(e2.clientX - lastPointerX, e2.clientY - lastPointerY) >= DRAG_THRESHOLD_PX) {
      if (dragStartTimer != null) {
        clearTimeout(dragStartTimer)
        dragStartTimer = null
      }
      lastPointerX = e2.clientX
      lastPointerY = e2.clientY
      startDrag()
    }
  }

  const waitingUp = () => {
    if (dragStartTimer != null) {
      clearTimeout(dragStartTimer)
      dragStartTimer = null
    }
    try {
      target.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    window.removeEventListener('pointermove', waitingMove)
    window.removeEventListener('pointerup', waitingUp)
    window.removeEventListener('pointercancel', waitingUp)
  }

  let dragStartTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    dragStartTimer = null
    startDrag()
  }, DRAG_DELAY_MS)

  window.addEventListener('pointermove', waitingMove)
  window.addEventListener('pointerup', waitingUp)
  window.addEventListener('pointercancel', waitingUp)
}

function onNodeClick(node: GraphNode, e: MouseEvent) {
  if (!didDragThisPointer) {
    emit('update:selectedNodeId', {
      id: node.id,
      clientX: e.clientX,
      clientY: e.clientY
    })
  }
}

/** 双击节点进入命名编辑：节点 id */
const editingNodeId = ref<string | null>(null)
const editingInputValue = ref('')
const editingInputRef = ref<HTMLInputElement | null>(null)

function getDisplayLabel(node: GraphNode): string {
  return node.label
}

function startEditNode(node: GraphNode) {
  editingNodeId.value = node.id
  editingInputValue.value = getDisplayLabel(node)
  nextTick(() => {
    editingInputRef.value?.focus()
    editingInputRef.value?.select()
  })
}

function commitEditNode() {
  const id = editingNodeId.value
  if (id == null) return
  const node = nodes.value.find((n) => n.id === id)
  const original =
    node?.originalLabel ?? (node?.type === 'directory' ? id : id.slice(id.indexOf('::') + 2))
  const val = editingInputValue.value.trim()
  if (val === '' || val === original) {
    emit('update:alias', id, null)
  } else {
    emit('update:alias', id, val)
  }
  editingNodeId.value = null
  editingInputRef.value = null
}

function onNodeInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitEditNode()
  }
  if (e.key === 'Escape') {
    editingNodeId.value = null
    editingInputValue.value = ''
  }
}

// 画布平移：在空白区域按住拖动
let isPanning = false
let panStartX = 0
let panStartY = 0
let panStartPanX = 0
let panStartPanY = 0

function onCanvasPointerDown(e: PointerEvent) {
  if (e.button !== 0 || dragNode) return
  const target = e.currentTarget as HTMLElement
  target.setPointerCapture(e.pointerId)
  isPanning = true
  panStartX = e.clientX
  panStartY = e.clientY
  panStartPanX = panX.value
  panStartPanY = panY.value
  const move = (e2: PointerEvent) => {
    if (!isPanning) return
    panX.value = panStartPanX + (e2.clientX - panStartX)
    panY.value = panStartPanY + (e2.clientY - panStartY)
  }
  const up = (eUp: PointerEvent) => {
    isPanning = false
    try {
      target.releasePointerCapture(eUp.pointerId)
    } catch {
      /* already released */
    }
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

function onWheel(e: WheelEvent) {
  const el = containerRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -5 : 5
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomPercent.value + delta))
    const s = scale.value
    const sNext = next / 100
    panX.value = px - ((px - panX.value) * sNext) / s
    panY.value = py - ((py - panY.value) * sNext) / s
    zoomPercent.value = next
  } else {
    e.preventDefault()
    panY.value -= e.deltaY
  }
}

/** 根据侧栏 folders 与 aliases 同步节点与边并重启力模拟 */
function syncGraphFromFolders() {
  const { nodes: n, edges: e } = buildGraphFromFolders(props.folders, props.aliases)
  nodes.value = n
  edges.value = e
  simulation?.stop()
  simulation = null
  nextTick(startSimulation)
}

/** aliases 变化时仅更新节点 label，不重建图，避免力模拟重启 */
function applyAliasesToNodes() {
  for (const node of nodes.value) {
    if (node.type === 'directory') {
      node.label = props.aliases.directories[node.id] ?? node.originalLabel ?? node.id
    } else {
      node.label = props.aliases.skills[node.id] ?? node.originalLabel ?? ''
    }
  }
}

watch(() => props.folders, syncGraphFromFolders, { immediate: true })
watch(() => props.aliases, applyAliasesToNodes, { deep: true })

/** 供父组件获取节点在视口中的屏幕坐标（用于列表点击时弹窗定位到节点） */
function getNodeScreenPosition(nodeId: string): { x: number; y: number } | null {
  const node = nodes.value.find((n) => n.id === nodeId)
  if (!node || node.x == null || node.y == null) return null
  const el = containerRef.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const s = scale.value
  return {
    x: rect.left + panX.value + node.x * s,
    y: rect.top + panY.value + node.y * s
  }
}

/** 平移画布使指定节点位于视口中心（列表点击技能时调用），使用 GSAP 做平滑平移 + 轻微缩放聚焦；动画结束时调用 onComplete */
function centerNodeInView(nodeId: string, onComplete?: () => void): boolean {
  const node = nodes.value.find((n) => n.id === nodeId)
  if (!node || node.x == null || node.y == null) {
    onComplete?.()
    return false
  }
  const el = containerRef.value
  if (!el) {
    onComplete?.()
    return false
  }
  const rect = el.getBoundingClientRect()
  const w = rect.width || 800
  const h = rect.height || 600
  const s = scale.value
  const targetPanX = w / 2 - node.x * s
  const targetPanY = h / 2 - node.y * s
  const currentZoom = zoomPercent.value

  if (centerTimeline) {
    centerTimeline.kill()
    centerTimeline = null
  }

  const state = {
    x: panX.value,
    y: panY.value,
    zoom: currentZoom
  }

  centerTimeline = gsap.timeline({
    onUpdate: () => {
      panX.value = state.x
      panY.value = state.y
      zoomPercent.value = state.zoom
    },
    onKill: () => {
      centerTimeline = null
    },
    onComplete: () => {
      centerTimeline = null
      onComplete?.()
    }
  })
  centerTimeline
    .to(state, {
      zoom: currentZoom * CENTER_ZOOM_FROM,
      duration: 0.08,
      ease: 'power2.out'
    })
    .to(
      state,
      {
        x: targetPanX,
        y: targetPanY,
        zoom: currentZoom,
        duration: CENTER_PAN_DURATION,
        ease: 'power3.out'
      },
      '-=0.04'
    )

  return true
}

defineExpose({ getNodeScreenPosition, centerNodeInView })

/** 最小间距变化时更新碰撞半径并重新跑一会儿 */
watch(minSpacing, (spacing) => {
  if (!simulation) return
  simulation.force(
    'collision',
    d3
      .forceCollide<GraphNode>()
      .radius((d) => (d.type === 'directory' ? 50 : 44) + spacing)
      .strength(0.7)
  )
  simulation.alpha(0.35).restart()
})

onMounted(() => {
  const el = containerRef.value
  if (el) {
    el.addEventListener('wheel', onWheel, { passive: false })
  }
})

onUnmounted(() => {
  simulation?.stop()
  const el = containerRef.value
  if (el) {
    el.removeEventListener('wheel', onWheel)
  }
})
</script>

<template>
  <div ref="containerRef" class="graph-container">
    <!-- 平移层：固定在视口内、不随 transform 移动，始终铺满容器，解决画布超出后无法拖动 -->
    <div class="graph-pan-layer" aria-hidden="true" @pointerdown="onCanvasPointerDown" />
    <!-- 图谱内容：平移+缩放，pointer-events: none 让空白处点击穿透到平移层，节点保持 auto 可拖 -->
    <div class="graph-content" :style="{ transform: contentTransform }">
      <svg class="graph-edges" aria-hidden="true">
        <line
          v-for="line in linePositions"
          :key="line.id"
          class="graph-edge"
          :x1="line.x1"
          :y1="line.y1"
          :x2="line.x2"
          :y2="line.y2"
        />
      </svg>
      <div class="graph-nodes">
        <div
          v-for="node in nodes"
          :key="node.id"
          class="graph-node"
          :class="[
            node.type === 'directory' ? 'graph-node--directory' : 'graph-node--skill',
            { 'graph-node--selected': props.selectedNodeId === node.id }
          ]"
          :style="{
            left: `${node.x ?? 0}px`,
            top: `${node.y ?? 0}px`
          }"
          role="button"
          tabindex="0"
          :aria-pressed="props.selectedNodeId === node.id"
          @pointerdown="onPointerDown($event, node)"
          @click.stop="onNodeClick(node, $event)"
          @dblclick.stop="startEditNode(node)"
        >
          <input
            v-if="editingNodeId === node.id"
            :ref="
              (el) => {
                if (node.id === editingNodeId) editingInputRef = el as HTMLInputElement
              }
            "
            v-model="editingInputValue"
            type="text"
            class="graph-node__input"
            @keydown="onNodeInputKeydown"
            @blur="commitEditNode"
          />
          <span v-else class="graph-node__label">{{ node.label }}</span>
        </div>
      </div>
    </div>
    <div v-if="nodes.length === 0" class="graph-empty">暂无节点</div>
    <div class="graph-zoom">
      <div class="graph-zoom__row graph-zoom__row--spacing" title="节点最小间距">
        <span class="graph-zoom__label" aria-hidden="true">间距</span>
        <input
          v-model.number="minSpacing"
          type="range"
          class="graph-zoom__slider graph-zoom__spacing-slider"
          :min="SPACING_MIN"
          :max="SPACING_MAX"
          step="2"
          aria-label="节点最小间距"
        />
        <span class="graph-zoom__spacing-value" aria-hidden="true">{{ minSpacing }}</span>
      </div>
      <div class="graph-zoom__row graph-zoom__row--zoom">
        <span class="graph-zoom__label" aria-hidden="true">缩放</span>
        <Button
          variant="outline"
          size="icon"
          class="graph-zoom__btn"
          aria-label="缩小"
          @click="zoomOut"
        >
          −
        </Button>
        <input
          v-model.number="zoomPercent"
          type="range"
          class="graph-zoom__slider"
          :min="ZOOM_MIN"
          :max="ZOOM_MAX"
          step="5"
          aria-label="缩放比例"
        />
        <Button
          variant="outline"
          size="icon"
          class="graph-zoom__btn"
          aria-label="放大"
          @click="zoomIn"
        >
          +
        </Button>
        <NativeSelect v-model="zoomPresetModel" class="graph-zoom__preset" aria-label="预设缩放">
          <NativeSelectOption v-for="p in presetOptions" :key="p" :value="String(p)">
            {{ Number(p).toFixed(2) }}%
          </NativeSelectOption>
        </NativeSelect>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph-container {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 400px;
  overflow: visible;
  background: var(--graph-canvas);
  transition: background-color 0.25s ease;
}

.graph-pan-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
  cursor: grab;
  touch-action: none;
}

.graph-pan-layer:active {
  cursor: grabbing;
}

.graph-content {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  transform-origin: 0 0;
  pointer-events: none;
  overflow: visible;
}

.graph-content .graph-node {
  pointer-events: auto;
}

/* 控制区：按功能垂直排列，内容左对齐，格式为功能名称+操作 */
.graph-zoom {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--graph-toolbar-bg);
  border: 1px solid var(--graph-toolbar-border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  transition:
    background-color 0.25s ease,
    border-color 0.25s ease;
}

.graph-zoom__label {
  font-size: 14px;
  color: var(--foreground);
  white-space: nowrap;
  min-width: 2.5em;
}

.graph-zoom__row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}

.graph-zoom__row--spacing {
  gap: 6px;
}

/* 右下角按钮：橙色（与上边一致），覆盖 Button variant */
.graph-zoom__btn {
  width: 28px;
  height: 28px;
  min-width: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: var(--graph-zoom-btn-bg) !important;
  color: var(--graph-zoom-btn-fg) !important;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition:
    background-color 0.25s ease,
    filter 0.2s ease;
}

.graph-zoom__btn:hover {
  filter: brightness(1.1);
}

.graph-zoom__slider {
  width: 80px;
  height: 6px;
  accent-color: var(--graph-zoom-btn-bg);
  cursor: pointer;
}

.graph-zoom__preset {
  min-width: 64px;
  height: 28px;
  font-size: 12px;
}

/* 预设下拉与 +/- 按钮统一主题色（NativeSelect 的 class 在 wrapper 上，需深度覆盖内部 select） */
.graph-zoom__preset :deep(select) {
  height: 28px;
  min-height: 28px;
  padding: 0 8px 0 6px;
  border: none;
  border-radius: 6px;
  background: var(--graph-zoom-btn-bg) !important;
  color: var(--graph-zoom-btn-fg) !important;
  cursor: pointer;
  transition:
    background-color 0.25s ease,
    filter 0.2s ease;
}

.graph-zoom__preset :deep(select:hover) {
  filter: brightness(1.1);
}

.graph-zoom__preset :deep(select:focus) {
  outline: none;
  box-shadow: none;
}

.graph-zoom__preset :deep(.lucide-icon),
.graph-zoom__preset :deep(svg) {
  color: var(--graph-zoom-btn-fg);
  opacity: 0.9;
}

/* 固定宽度 + 右对齐，避免数字位数变化时布局抖动 */
.graph-zoom__value {
  display: inline-block;
  width: 3.25em;
  font-size: 12px;
  color: var(--foreground);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.graph-zoom__spacing {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 间距滑块占满该行剩余宽度（覆盖 .graph-zoom__slider 的固定宽度） */
.graph-zoom__spacing-slider {
  width: 0;
  flex: 1;
  min-width: 40px;
}

.graph-zoom__spacing-value {
  min-width: 1.8em;
  font-size: 12px;
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}

.graph-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--muted-foreground);
  font-size: 14px;
}

/* 不裁剪超出视口的连线，避免节点超出画布时连线消失 */
.graph-edges {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.graph-edge {
  stroke: var(--graph-edge);
  stroke-width: 1.5;
  transition: stroke 0.25s ease;
}

.graph-nodes {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.graph-node {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  cursor: grab;
  user-select: none;
}

.graph-node:active {
  cursor: grabbing;
}

.graph-node--skill {
  width: fit-content;
  padding: 8px 14px;
  border-radius: 8px;
  background: var(--graph-node-skill-bg);
  border: 1px solid var(--graph-node-skill-border);
  color: var(--foreground);
  font-size: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  transition:
    background-color 0.25s ease,
    border-color 0.25s ease,
    color 0.25s ease;
}

.graph-node--directory {
  width: fit-content;
  padding: 8px 14px;
  border-radius: 8px;
  background: var(--chart-1);
  color: oklch(0.99 0 0);
  font-size: 12px;
  border: 1px solid transparent;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  transition:
    background-color 0.25s ease,
    color 0.25s ease;
}

.graph-node__label {
  white-space: nowrap;
}

.graph-node__input {
  width: 100%;
  min-width: 3em;
  max-width: 180px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: center;
  outline: none;
  box-shadow: none;
}

.graph-node__input::placeholder {
  color: var(--muted-foreground);
}

/* 节点选中状态：与侧栏列表联动 */
.graph-node--selected.graph-node--skill {
  box-shadow: 0 0 0 2px var(--chart-1);
  border-color: var(--chart-1);
}

.graph-node--selected.graph-node--directory {
  box-shadow: 0 0 0 2px oklch(0.99 0 0);
  border-color: oklch(0.99 0 0);
}
</style>
