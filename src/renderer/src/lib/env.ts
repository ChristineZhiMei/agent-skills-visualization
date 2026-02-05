/** 判断当前运行环境是否为 Electron 套壳 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__
}
