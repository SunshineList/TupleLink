# 0.3.0 验证记录

日期：2026-10-18。工作分支：`codex/openwrt-plugin`。
测试发行：[openwrt-v0.3.0](https://github.com/slobys/daed/releases/tag/openwrt-v0.3.0)。
主仓库和子模块准确提交随发行保存在 `SOURCE_COMMIT.txt`。

## 管理面板改版

- 群组、节点、订阅置于常用功能区；配置、DNS、路由仍使用原有编辑器，折叠
  后保持挂载；流量概况与趋势保留 1 分钟、10 分钟、30 分钟、1 小时时间范围。
- 节点库合并手动节点和订阅节点，按 ID 去重，新增搜索、来源筛选、延迟排序、
  分批显示及加入群组。订阅节点保留订阅的管理边界，不提供手动编辑或删除。
- 延迟展示实际测速结果与时间；未测速不显示虚构数值。默认群组标签不冒充
  当前实际路由选用状态。运行状态、变更状态和流量数据均来自现有后端。
- 保留节点导入和协议编辑、二维码、敏感链接遮盖、删除确认、订阅更新与定时
  更新、名称过滤、群组成员选择及拖拽。失败时保留导入/编辑输入，提供重试。
- 修复节点编辑原标签未预填，以及普通 VLESS 编辑生成 `flow=none` 后被 dae
  拒绝的问题；实际保存回归覆盖原协议、地址和标签。
- 节点批量导入遇到无效链接时回滚，避免部分写入后表单误报成功。批量订阅
  更新等待全部请求结束，部分失败时仍刷新列表以反映已完成的结果。
- LuCI 仍只保留管理面板和运行日志，使用已有 LuCI 会话和同源 CGI 网关。
  不增加依赖、不修改 wing 子模块，不变更节点、订阅、配置的数据结构。

## 旧数据升级和浏览器验证

`tests/openwrt/native_panel.py` 与 `browser-panel.cjs` 在一次性 OpenWrt 24.10.4
x86 rootfs 中运行真实 LuCI、uhttpd、ubusd/rpcd、CGI、SQLite 及 Daed API。
仅板卡信息和 procd 服务状态使用夹具；登录和 ACL 校验使用原生 rpcd。

- 先启动 0.2.1，写入 7 个手动节点、一个含 2 节点的本地测试订阅、群组成员、
  订阅名称过滤规则和面板存储；升级到 0.3.0，逐表比对所有非运行时用户表
  的哈希，并核对 API 资源和浏览器持久排序偏好，均保持一致。
- 使用真实 API 验证来源筛选、搜索空结果、只读订阅节点、加入群组及重复防护。
- 使用键盘执行筛选后拖拽排序，验证隐藏节点次序不被改变。
- 本地订阅源返回 HTTP 503 时更新失败，原节点不丢失；恢复后重试成功。
- 无效节点导入、无效群组创建保留输入；修正群组和节点后保存到真实数据库。
- 展开原有高级设置和流量图表；390、768、1600 像素宽度无面板水平溢出。
  HTTP/HTTPS 均无需独立向导，HTTPS 会话 cookie 保持 Secure / HttpOnly。
- 代理启动、停止、应用的加载、禁用和失败重试使用浏览器故障注入；Run 请求
  不转发到后台，不加载 eBPF。此项验证按钮状态和调用参数，不证明真实代理可用。

## 自动检查与发行包

- 25 项前端及 100 项语言工具工作区测试；TypeScript 和相关 ESLint 检查。
- 45 项 Python 安装/发行测试，包含原生 APK v3、真实 HTTP 源依赖预检、
  备份及 WAL、卸载依赖保留、停服前失败保护、缓存清理和 rpcd 会话测试。
- 8 项 LuCI 模块测试：同源嵌入、会话 POST、权限拒绝、菜单资源和日志渲染。
- Go BTF 解析与网关会话测试；ShellCheck 检查安装器、兼容检查、RPC、procd、CGI。
- x86_64 / ARM64 静态 Daed、BTF 解析器、CGI 网关构建。
- 22 个原生 IPK/APK：每种格式 1 个 x86_64、9 个 ARM64 标签运行包和 1 个
  LuCI 包。逐包核对元数据、ELF、脚本、权限、菜单引用和页面文件。
- SDK 固定为 OpenWrt 24.10.4 / 25.12.4，不替换路由器软件源或内核。

## 复现浏览器升级测试

需要 Linux root、预先校验并安装完整 LuCI 的隔离 rootfs、旧/新运行程序及
新网关。测试只写入专用 `--workspace`，目录必须不存在；可用 JSON 控制命令
停止服务。Windows 浏览器端使用项目现有 Playwright，未增加依赖。

```sh
python3 tests/openwrt/native_panel.py --rootfs /path/to/rootfs \
  --old-runtime /path/to/0.2.1/daed --runtime /path/to/0.3.0/daed \
  --proxy /path/to/0.3.0/luci-proxy --workspace /path/to/new-test-directory \
  --control /path/to/shared-control
DAED_PANEL_CONTROL=/path/to/shared-control node tests/openwrt/browser-panel.cjs
```

可用 `DAED_BROWSER_EXECUTABLE` 指定浏览器。HTTP 端口 18080，HTTPS 18443，
订阅源 18081，内部 API 12025。夹具为测试身份和本地订阅，不使用真实代理凭据。

## 边界

浏览器验证为隔离 x86_64 / API-only 环境，不接管 LAN 流量。ARM64 程序已
编译并核对 ELF，此次未在 R4S 实机运行。OpenWrt 家族的不同主题、菜单与
权限策略仍需目标固件验收；真实 eBPF、LAN IPv4/IPv6、DNS 分流、接口重连、
重启自启、长期稳定性、业务数据库恢复及 sysupgrade 仍待实机验证。
`docs/ui/panel-proposal.html` 是设计参考，使用演示数据，不打包进正式面板。
版本继续标记 prerelease；未声称 GitHub Actions 已远端运行。
