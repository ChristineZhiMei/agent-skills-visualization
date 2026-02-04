export interface AliasCache {
  /** key = folder path */
  directories: Record<string, string>
  /** key = `${folderPath}::${skillName}` */
  skills: Record<string, string>
}
