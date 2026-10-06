# ClawX v0.6.0 同步记录

同步目标：`https://github.com/ValueCell-ai/ClawX` 的 `main`，
提交 `c8a54dcd4f478a4c8802ba7c4b4bae04b5f854e8`，标签 `v0.6.0`。
同步前本地提交为 `14dc5eda`（v0.4.28）；此次合并接入 147 个上游提交。

## 合并结果

- 接入上游 ACP 聊天、电脑操作、语音输入、文件预览、渠道插件及配置协调器更新。
- 保留品牌配置、品牌图标、独立数据目录、账号服务、运行时模型管理、配置编辑、日志和用量页面。
- 模型页保留上游提供商设置与本地运行时模型编辑器，语音与图片生成设置使用上游模型页入口。
- 账号、模型编辑和配置编辑/恢复通过上游 `mutateOpenClawConfig` 协调配置写入。
- 保留本地发布工作流和更新源，并补充 Windows/macOS CUA driver 下载及原生 SDK 解包配置。
- 接受上游移除旧聊天内部实现及 Dreams 页面；同步四种语言的上游资源及 README。
- 修复 Windows 下跨磁盘日志路径校验、插件绝对路径清理、Harness 命令路径含空格的问题。
- 固定补丁及 `.mjs` 文件使用 LF，保持 pnpm 补丁哈希和测试加载稳定。
- Electron 测试保留账号覆盖，增加配置、日志、用量及运行时模型编辑器导航覆盖。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `typecheck` | 通过，Main/Renderer 均通过 |
| `build:vite` | 通过，包含 Electron Main/Preload 构建 |
| `lint:check` | 通过；7 个 Fast Refresh 警告 |
| 本次集成重点单元测试 | 490 项通过，0 项失败 |
| 配置协调器新增集成测试 | 包含在重点测试中：并发模型编辑、密钥保留、协议拒绝及 JSON5 编辑备份 |
| Electron 首次启动、账号、导航、电脑操作 | 13 项通过 |
| 任务 Harness validate / run --dry-run | 通过 |
| `harness:ci` | 通过，22 项基线测试通过 |
| `comms:replay` / `comms:compare` | 通过 |
| 全量单元测试 | 2624 项通过，56 项失败，6 项跳过 |

全量测试仍有以下失败组，重点测试全部通过不能代替全量通过：

| 文件 | 失败数 |
| --- | ---: |
| after-pack-cleanup.test.ts | 1 |
| agent-config.test.ts | 2 |
| attachment-access.test.ts | 8 |
| clawx-openai-image-plugin.test.ts | 1 |
| cua-driver-artifacts.test.ts | 1 |
| dingtalk-dws.test.ts | 7 |
| files-api-workspace.test.ts | 4 |
| issue-report-api.test.ts | 1 |
| launch-at-startup.test.ts | 1 |
| openclaw-cli.test.ts | 9 |
| openclaw-upgrade-snapshot.test.ts | 3 |
| plugin-install.test.ts | 14 |
| process-instance-lock.test.ts | 1 |
| skills-symlink-cleanup.test.ts | 3 |

这些失败主要涉及 Windows 下软链接权限、POSIX 路径/文件权限断言、平台模拟中的路径分隔符，以及本机 Node 24.13.0 的 SQLite 版本。
OpenClaw 2026.7.1-2 要求安全的 SQLite 版本，Node 应使用 22.22.3+、24.15.0+ 或 25.9.0+。
项目的 Windows Node 下载脚本已采用上游的 22.22.3，Electron 已更新为上游的 40.10.6。
完整套件状态仍为失败，发布前应在受支持的 Node 环境和各目标平台继续验证上述失败组。

## 本地工作区保护

同步前提交保存在 `codex/backup-before-upstream-v0.6.0` 分支。
原来未提交的 Linux 上传脚本和两个发布工作流改动通过专用 stash 保存，并在合并提交后恢复为未提交改动。
此次工作范围是本地源码同步，未生成发布标签或发布安装包。
