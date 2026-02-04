import type { GraphData } from '../types/graph'

/**
 * 模拟关系图谱数据：1 个目录节点 + 若干技能节点，
 * 边为每个 skill → directory，可选 skill→skill 展示关系
 */
export const mockGraphData: GraphData = {
  nodes: [
    { id: 'dir-root', label: 'skills 目录', type: 'directory' },
    { id: 'skill-find-bugs', label: 'find-bugs', type: 'skill' },
    { id: 'skill-function-index', label: 'function-index', type: 'skill' },
    { id: 'skill-knowledge-distiller', label: 'knowledge-distiller', type: 'skill' },
    { id: 'skill-own-component-library', label: 'own-component-library', type: 'skill' },
    { id: 'skill-skill-creator', label: 'skill-creator', type: 'skill' }
  ],
  edges: [
    { source: 'skill-find-bugs', target: 'dir-root' },
    { source: 'skill-function-index', target: 'dir-root' },
    { source: 'skill-knowledge-distiller', target: 'dir-root' },
    { source: 'skill-own-component-library', target: 'dir-root' },
    { source: 'skill-skill-creator', target: 'dir-root' },
    { source: 'skill-function-index', target: 'skill-knowledge-distiller' },
    { source: 'skill-skill-creator', target: 'skill-own-component-library' }
  ]
}
