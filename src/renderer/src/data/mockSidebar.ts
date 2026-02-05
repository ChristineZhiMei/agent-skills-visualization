import type { SkillFolderItem } from '../types/sidebar'

/**
 * 模拟已添加的 skill 文件夹列表（两层：文件夹路径 → 技能名称+描述）
 */
export const mockSkillFolders: SkillFolderItem[] = [
  {
    path: '~/.cursor/skills',
    skills: [
      { name: 'find-bugs', description: '在本地分支变更中查找缺陷、安全漏洞与代码质量问题。' },
      { name: 'function-index', description: '项目功能索引管理。' },
      {
        name: 'knowledge-distiller',
        description: '将开发任务沉淀为可复用的 Cursor rules、skills。'
      },
      { name: 'skill-creator', description: '创建有效技能的指南。' },
      { name: 'skill-optimizer', description: '技能优化与建议日志。' }
    ]
  },
  {
    path: '/Users/me/project/.cursor/skills',
    skills: [
      { name: 'own-component-library', description: '分析前端项目，初始化/维护独立组件库。' },
      { name: 'create-rule', description: '创建 Cursor 规则。' },
      { name: 'update-cursor-settings', description: '修改 Cursor/VSCode 用户设置。' }
    ]
  }
]

/**
 * 将路径缩写为「头 1～2 字符 + … + 尾路径」
 * Web 端通过 File System Access API 添加的路径形如 __web__目录名__uuid，优先提取目录名展示
 */
export function abbreviatePath(path: string, headLen = 2, tailLen = 24): string {
  const webPrefixMatch = path.match(/^__web__(.+?)__[a-z0-9-]+$/i)
  if (webPrefixMatch) return webPrefixMatch[1]
  if (path.length <= headLen + tailLen + 3) return path
  const head = path.slice(0, headLen)
  const tail = path.slice(-tailLen)
  return `${head}…${tail}`
}
