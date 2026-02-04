/**
 * 单个技能：名称 + 描述（来自 SKILL.md）
 */
export interface SkillItem {
  name: string
  description: string
}

/**
 * 已添加的 skill 文件夹：路径 + 其下技能列表（名称+描述）
 */
export interface SkillFolderItem {
  path: string
  skills: SkillItem[]
}
