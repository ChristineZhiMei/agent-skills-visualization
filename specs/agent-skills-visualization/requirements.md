# 功能需求：Agent Skills Visualization

> 本文档由当前项目结构与用户对话（项目启动方式）归纳得出，后续可用需求技能细化或扩展。

## 1. 项目定位

- **名称**：Agent Skills Visualization（仓库名：`agent-skills-visualization`）  
- **类型**：Electron 桌面应用，前端为 Vue 3 + TypeScript。  
- **构建工具**：electron-vite；包管理：pnpm。

## 2. 功能需求

### 2.1 开发与运行

- **REQ-1**：开发者可通过 `pnpm install` 安装依赖。  
- **REQ-2**：开发者可通过 `pnpm dev` 以开发模式启动应用（含热更新）。  
- **REQ-3**：开发者可通过 `pnpm start` 在构建后预览生产包。  
- **REQ-4**：项目提供清晰的启动说明（如 README 或文档），便于新成员上手。

### 2.2 构建与分发

- **REQ-5**：支持通过 `pnpm build` 进行类型检查与构建。  
- **REQ-6**：支持为 Windows、macOS、Linux 分别打包（如 `build:win` / `build:mac` / `build:linux`）。

### 2.3 应用能力

- **REQ-7**：主进程负责创建窗口、生命周期与安全策略（如外部链接用系统浏览器打开）。  
- **REQ-8**：通过预加载脚本（preload）与 contextBridge 向渲染进程暴露受控 API，保证上下文隔离。  
- **REQ-9**：渲染进程使用 Vue 3 展示 UI，并可与主进程通过 IPC 通信。  
- **REQ-10**：开发环境下支持 HMR，生产环境加载本地打包的 renderer 资源。

### 2.4 技能可视化

- **REQ-11**：通过脚本对 skills 目录进行分析，构建技能之间的关系数据（节点 + 边）。
- **REQ-12**：关系图谱使用力导向模拟：节点间相互排斥，所有节点初始向中心吸引。
- **REQ-13**：节点可拖拽；技能节点为圆角长方形，连接点位于几何中心；目录节点为圆形。
- **REQ-14**：每个节点为可填充内容的 div；所有技能节点默认与「存放目录」节点相连。
- **REQ-15**：先提供基于模拟数据的关系图谱示例，不依赖真实目录解析。

## 3. 验收标准

| ID   | 验收标准 |
|------|----------|
| AC-1 | 执行 `pnpm install` 后无报错，可执行 `pnpm dev`。 |
| AC-2 | 执行 `pnpm dev` 后打开 Electron 窗口，界面正常、HMR 生效。 |
| AC-3 | 执行 `pnpm build` 通过类型检查并产出构建产物。 |
| AC-4 | 主进程与渲染进程 IPC 通信正常（如示例 ping/pong）。 |
| AC-5 | 文档或 README 中明确说明安装与启动步骤。 |
| AC-6 | 关系图谱能正确渲染节点与边（技能节点圆角矩形、目录节点圆形，连线从节点中心到中心）。 |
| AC-7 | 力导向生效：节点间排斥、整体向中心吸引，布局稳定后可拖拽节点。 |
| AC-8 | 示例图谱使用模拟数据即可展示，不依赖真实 skills 目录。 |

## 4. 非功能约束

- 使用 TypeScript，保持主进程、预加载、渲染进程的类型一致（如 `preload/index.d.ts`）。  
- 遵循现有项目结构：`src/main`、`src/preload`、`src/renderer`。
