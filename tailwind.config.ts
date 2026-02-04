// Tailwind v4 使用 @tailwindcss/vite，此文件仅用于 shadcn-vue CLI 路径解析
import type { Config } from 'tailwindcss'

export default {
  content: ['./src/renderer/**/*.{vue,js,ts,jsx,tsx}']
} satisfies Config
