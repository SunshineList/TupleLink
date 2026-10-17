# 第一期验证记录

日期：2026-10-17。工作分支：`codex/openwrt-plugin`。
开发基线：`be4ef873c352a9ec930c877a3a821163f4b4ac0a`。
测试发行：[openwrt-v0.1.1](https://github.com/slobys/daed/releases/tag/openwrt-v0.1.1)。
以下为本地构建和自动化验证记录；发布资产的准确源码提交见
`SOURCE_COMMIT.txt`，发行状态以 GitHub Release 为准。

## 已完成

| 项目               | 结果与范围                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 前端工作区构建     | 6 个工作区构建通过；端口修复后再次构建 Web 面板通过                                                                         |
| 前端测试           | 18 项通过，含自定义端口、HTTPS、IPv6 地址及开发模式回归                                                                     |
| 语言工具工作区测试 | 100 项通过，涵盖 node-parser、lang-core 和 LSP；提交前由仓库 hook 执行                                                      |
| 类型与代码检查     | Web TypeScript 类型检查、三个相关 TS 文件 ESLint 通过                                                                       |
| LuCI 页面测试      | 6 项通过，使用 LuCI 函数包装约定；覆盖状态、固定操作、HTTPS 降级入口及日志文本渲染                                          |
| 安装与发行测试     | 35 项 Python 测试通过；其中使用真实 OpenWrt BusyBox ash、UCI、jshn、jsonfilter 执行安装/RPC 测试                            |
| Shell 检查         | 安装脚本、检查器、RPC、procd 脚本 ShellCheck 通过；仅排除固件提供的外部 source 和 rc.common 的 ash 扩展提示                 |
| 真实程序构建       | Go 1.26.0 + Clang/LLVM 18 生成真实 eBPF 对象，完成 x86_64 和 ARM64 静态程序编译                                             |
| 原生安装包         | 固定 SHA-256 的 OpenWrt 24.10.4、25.12.4 SDK 成功生成 22 个 IPK/APK 包                                                      |
| 包内容验证         | 22 个包逐一检查原生包元数据、版本、架构、ELF 静态链接、必需文件、源文件内容和执行权限；APK 另用原生工具 verify/extract 验证 |
| 启动烟测           | x86_64 原始程序，以及从 IPK/APK 提取的程序，均通过版本检查和本机回环 HTTP 面板启动测试；使用 API-only 模式                  |

自动化测试共 162 项（18 前端 + 100 语言工具 + 6 LuCI + 35 Python + 3 Go BTF 解析测试，另含 5 个无效数据子场景）。

新增真实 APK v3 卸载测试：在一次性 OpenWrt rootfs 内运行 SDK 的实际 APK
工具，安装带依赖关系的测试包，再通过真实卸载器移除 Daed。确认原本只作为
依赖的 `vmlinux-btf` 被保留在 world 和文件系统中，Daed 包被移除，数据库
WAL 进入备份。这里使用的是专门构造的测试包，不是路由器上的旧安装包。

安装包数量：每种格式包含 1 个 x86_64 运行包、9 个 ARM64 架构标签运行包、
1 个通用 LuCI 包，共 11 × 2。ARM64 标签及 SDK 固定值见
[sdk-matrix.json](./sdk-matrix.json)。

## 本轮主要文件

- [安装脚本](./install.sh)：固定版本下载、SHA-256、架构/包格式选择、已有安装保护、停服备份和安装后检查。
- [包定义](./Makefile)、[SDK 构建器](./build.py)、[清单生成器](./manifest.py)：原生包、来源固定、完整矩阵检查及打包后校验。
- `files/`：procd、只读兼容检查、UCI 默认配置、固定 RPC 方法、ACL、菜单、固件备份声明。
- `htdocs/`：运行状态、服务设置、管理面板入口和限量脱敏日志。
- [构建工作流](../.github/workflows/openwrt.yml)：PR 测试、手动双架构构建及四组 SDK 打包；只上传 artifact。
- [前端连接地址](../apps/web/src/utils/endpoint.ts)：生产面板跟随实际服务地址；保留开发模式的独立后端端口。
- `tests/openwrt/` 和前端连接地址回归测试；根 README、Git 忽略及换行规则。
- `eslint.config.js`：LuCI 函数包装模块由专门的 UI 测试解析，不交给普通模块解析器。

## 验证边界与待验收项

OpenWrt、ImmortalWrt、iStoreOS 的系统标识，以及 ARM64 包选择，在隔离
OpenWrt x86_64 rootfs 中通过夹具模拟。包管理器、procd、内核能力和接口
状态也是夹具；这些测试证明安装控制流程，不证明真实依赖安装或网络行为。

已真实编译 ARM64 程序并验证 ELF，没有在 ARM64 硬件上运行。
API-only 烟测没有加载 eBPF、绑定 LAN/WAN 或接管任何真实流量。
GitHub Actions 工作流已加入并做本地语法核对，尚未在远端执行。

仍需在目标固件实机完成：

1. 本机软件源的依赖和内核 ABI 匹配；LuCI 菜单、RPC 权限与保存应用。
2. 账户初始化、订阅导入、真实 eBPF 加载及 LAN IPv4/IPv6 流量与 DNS 分流。
3. 主路由/旁路由、PPPoE、桥接、多网口、接口变化和重启自启。
4. 正常停止后的网络恢复、现有代理的接管冲突、长时间稳定性。
5. 真实 SQLite 数据升级备份与人工恢复，以及固件 sysupgrade 数据保留。

0.1.1 支持原生及底层加载器固定搜索路径中的外部 BTF，并用真实解析库读取。
BTF 可解析、必要类型存在，并不证明完整 CO-RE 重定位和 eBPF 加载成功。HTTPS LuCI 使用
新窗口打开 HTTP LAN 面板；统一 HTTPS、单点登录、原版安装自动迁移和
原子升级/自动回滚尚未实现。显式卸载/全新重装会先备份并清除原数据，
不自动导入旧数据库。新增卸载、重装、备份/移除失败、BTF 解析失败与校验失败路径测试。
