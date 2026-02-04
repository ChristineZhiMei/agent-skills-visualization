/**
 * 关系图谱节点：技能节点（圆角矩形）或目录节点（圆形）
 * x, y 由力模拟更新；fx, fy 拖拽时固定位置
 * label 为显示名（含别名）；originalLabel 为原始名（用于别名重置等）
 */
export interface GraphNode {
  id: string
  label: string
  type: 'skill' | 'directory'
  /** 原始名称（路径或技能名），用于别名未设置时的显示与重置 */
  originalLabel?: string
  x?: number
  y?: number
  fx?: number
  fy?: number
}

/**
 * 关系图谱边：source/target 为节点 id，力模拟中可被替换为节点引用
 */
export interface GraphEdge {
  source: string
  target: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}
