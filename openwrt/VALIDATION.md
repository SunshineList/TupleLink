# 0.2.0 验证记录

日期：2026-10-18。工作分支：`codex/openwrt-plugin`。
测试发行：[openwrt-v0.2.0](https://github.com/slobys/daed/releases/tag/openwrt-v0.2.0)。
主仓库和子模块准确提交随发行保存在 `SOURCE_COMMIT.txt`。

## 页面与登录

- LuCI 菜单只包含管理面板和运行日志，默认进入管理面板。
- 路由器专用前端跳过设置向导，隐藏账户、调试、版本、外链和独立退出入口。
  节点、订阅、规则、DNS、群组和代理启停保留。普通非路由器构建继续使用原登录。
- 7 项 LuCI 模块测试覆盖菜单、HTTP/HTTPS 同源嵌入、会话 POST 交接、拒绝访问
  及日志文本渲染。
- 4 项 Go 网关测试覆盖首次准备身份、既有用户/面板存储保持不变、私有凭据权限、
  同源 cookie、CSRF 拒绝、后台本地授权以及会话撤销。
- 真实 OpenWrt x86 rootfs 中启动 ubusd/rpcd，通过真实登录与 CGI 验证：管理员
  会话可用、只读账户被拒绝、退出后的会话被拒绝；HTTPS cookie 包含 Secure。
- Edge 无头浏览器通过真实 OpenWrt uhttpd（HTTP 和 HTTPS）→ CGI → 真实 Daed
  GraphQL API 链路进入管理面板，无欢迎/注册/登录向导，无页面脚本错误。
  该浏览器场景的会话校验使用夹具；真实 rpcd 权限校验由上一项独立测试覆盖。
- 全新数据库首次进入自动初始化配置。升级网关沿用既有用户及 JsonStorage，
  不改密码、不清空节点和配置。网关令牌不发送到浏览器。

## 安装与构建

- 44 项 Python 安装/发行测试通过，包括真实 APK v3 架构选择、缓存 HTTP 源
  依赖预检、卸载依赖保留、停服前失败保护，以及原生 rpcd 会话测试。
- 18 项前端及 100 项语言工具工作区测试；TypeScript 和相关 ESLint 检查。
- ShellCheck：安装器、兼容检查、RPC、procd 和 CGI 入口。
- 3 项 Go BTF 解析测试及 5 个无效输入子场景。
- x86_64 / ARM64 静态 Daed、BTF 解析器和 LuCI 网关构建。
- 22 个原生 IPK / APK，覆盖每种格式 1 个 x86_64 运行包、9 个 ARM64 标签运行包、
  1 个 LuCI 包。逐包验证元数据、ELF、权限、脚本、CGI 入口和页面内容，拒绝残留旧页面。
- 构建 SDK 沿用固定哈希的 OpenWrt 24.10.4 / 25.12.4，不替换路由器软件源或内核。

## 边界

浏览器与原生服务验证运行在隔离 x86_64 rootfs / API-only 模式，不加载 eBPF
或接管 LAN 流量。ARM64 程序已编译并核对 ELF；此次新网关尚未在 ARM64
硬件运行。用户此前 R4S / OpenWrt 25.12.5 / 内核 6.12.94 日志已确认 BTF
解析器能读取外部 BTF，后续截图显示既有插件能打开旧面板，不等同于新版本实机验收。

仍待目标路由器验收：原生 LuCI 完整主题/菜单、权限策略、节点和订阅导入、
真实 eBPF、LAN IPv4/IPv6 及 DNS 分流、接口重连、重启自启、长期稳定性、
真实业务数据库升级恢复及 sysupgrade。GitHub Actions 仍未声称已远端运行。
版本继续标记 prerelease。
