/**
 * 从 SKILL.md 内容解析 name、description
 * 支持 YAML frontmatter 或首个 # 标题
 * 纯函数，主进程与 renderer 共用
 */
export function parseSkillMd(
  content: string
): { name: string; description: string } | null {
  const trimmed = content.trim()
  if (!trimmed) return null

  const frontMatch = trimmed.match(/^---\s*\n([\s\S]*?)\n---/)
  if (frontMatch) {
    const block = frontMatch[1]
    const nameMatch = block.match(/^name:\s*(.+?)(?:\n|$)/m)
    const descMatch = block.match(/^description:\s*([\s\S]*?)(?=\n\w+:|\s*$)/m)
    const name = nameMatch ? nameMatch[1].trim() : ''
    const description = descMatch ? descMatch[1].trim().replace(/\n+/g, ' ') : ''
    if (name) return { name, description }
  }

  const firstLine = trimmed.split('\n')[0] ?? ''
  const nameFromHeading = firstLine.replace(/^#+\s*/, '').trim()
  if (nameFromHeading) {
    const rest = trimmed.slice(trimmed.indexOf('\n') + 1).trim()
    const desc = rest.split(/\n\n/)[0]?.replace(/\n/g, ' ').trim() ?? ''
    return { name: nameFromHeading, description: desc }
  }

  return null
}
