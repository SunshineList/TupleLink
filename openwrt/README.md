# Daed 软路由插件

支持 OpenWrt、ImmortalWrt、iStoreOS 的现代 LuCI，提供 x86_64 / ARM64 的
IPK 和 APK v3 安装包。当前测试版：[openwrt-v0.2.1](https://github.com/slobys/daed/releases/tag/openwrt-v0.2.1)。

## 使用

安装后进入 **服务 → Daed**，默认直接显示管理面板，仅保留两个页面：

- **管理面板**：配置、DNS、路由、节点、订阅、群组、流量以及代理启停。
- **运行日志**：自动刷新最近的运行日志，保留大小限制与凭据遮盖。

不再显示 Daed 首次向导、接口地址输入、注册登录、账户菜单、版本及外链工具栏。
浏览器沿用当前 LuCI 登录，不需要另设一套密码。HTTP 和 HTTPS 后台都通过同源
CGI 网关内嵌面板，不再要求新窗口。管理服务未运行时，面板提供启动按钮。

管理程序仅监听 `127.0.0.1`，默认内部端口 2023。浏览器从 LuCI 入口访问。
节点、订阅和路由仍需按实际网络配置；进入管理面板不等于已启用透明代理。

## 安装和保留数据升级

以 root 在路由器 SSH 中执行，已有本项目 0.1.x / 0.2.0 安装时使用同一条命令升级：

```sh
uclient-fetch -O /tmp/daed-install.sh https://github.com/slobys/daed/releases/download/openwrt-v0.2.1/install.sh && sh /tmp/daed-install.sh
```

升级先停止 Daed 并等待进程退出，将配置、SQLite 数据库及 WAL 备份到
`/root/daed-backups`，然后更新程序；保留既有节点、规则、账户数据和自启选择。
新入口复用原用户的面板存储；没有用户时自动准备本地服务身份。
不需要删除旧版或重新建立账户。失败时提示备份位置，不自动回滚。

0.2.1 修复升级后仍加载旧页面、只显示“服务仅监听本机”提示的问题：新版面板
使用独立的 LuCI 模块地址，安装时清理传统和 ucode 菜单缓存。升级后刷新后台，
再进入 **服务 → Daed**；仍显示旧内容时按 `Ctrl+F5`。无需把监听地址改为 LAN。

`--check` 仅检查环境；`--dry-run` 另下载并核对本机安装包，APK 使用已有
软件源索引模拟依赖。预检失败不会停止或卸载现有 Daed。正式安装会先更新
固件自身的索引。APK 不使用离线参数屏蔽未缓存的远端依赖，不强制忽略内核 ABI。

## 卸载和清空重装

```sh
# 安装成功后无需重新下载脚本
daed-router-setup --uninstall
# 也可以使用下载的脚本
sh /tmp/daed-install.sh --uninstall
# 仅在需要清空旧配置、或替换其他来源的 daed 包时使用
sh /tmp/daed-install.sh --reinstall
```

卸载、全新重装会先备份配置、数据库及 WAL，再移除 Daed 包和原数据。
`--reinstall` 不自动导入备份，原账户、节点和规则需要重新配置。
单独卸载不依赖 BTF、LuCI 或网络，支持 `--uninstall --dry-run` 和重复执行。
APK 会保留已经安装的 BTF、相关内核模块及必要依赖，避免被自动当作孤立依赖移除。
备份可能包含密钥，目录权限 0700、归档权限 0600。

## 环境要求

- 固件提供现代 JavaScript LuCI、uhttpd CGI、rpcd、UCI、jshn 和 jsonfilter。
- Linux 5.17+，具备 dae 所需 BPF 功能。支持原生 BTF 或加载器固定搜索路径中
  对应当前内核的外部 BTF/vmlinux，随包解析器核验格式、ELF 架构和网络类型。
- 固件自身软件源能够提供匹配本机内核 ABI 的 `kmod-sched-core`、
  `kmod-sched-bpf`、`kmod-veth` 及 `ca-bundle`、`v2ray-geoip`、`v2ray-geosite`。
- 足够的临时下载空间和 overlay 存储。APK 格式要求 apk-tools 3.x。

安装器不刷固件、不替换 BTF、不修改其他代理、DNS 或防火墙。
ARM64 架构标签以 `sdk-matrix.json` 为准，程序使用 ARMv8 基线。APK 按
`/etc/apk/arch` 选择标签，仅在列表缺失或为空时退回编译默认值。
系统名称、BTF 检查或管理页面启动不构成实际代理兼容性证明。

## 登录集成

CGI 网关通过 rpcd 校验当前 LuCI 会话对 `luci-app-daed-router` 的管理权限，
每个请求均重新校验，退出或过期的会话不能继续调用管理 API。
会话交接使用同源 POST，cookie 设置 HttpOnly / SameSite=Strict，并在 HTTPS 下
设置 Secure。写请求检查 Origin；不在 URL、页面或浏览器存储中下发 Daed JWT。

网关复用 wing 现有 SQLite 和 JWT 库生成短时本地授权，不修改 wing 子模块，
不新增 npm 或 Go 依赖。私有服务凭据保存在 `/etc/daed/luci-session.json`，权限
0600。首次启动前准备身份，之后 CGI 不直接读写数据库。
只读 LuCI 账户可看日志，管理面板需要该 ACL 组的写权限。

## 开发

```sh
# 在已有工作区依赖构建后，生成路由器专用前端
pnpm --dir apps/web build:openwrt
# 使用独立输出目录，避免工作区测试/普通网页版构建覆盖路由器前端
CGO_ENABLED=0 make -C wing APPNAME=daed VERSION=0.2.1 WEB_DIST="$PWD/apps/web/dist-openwrt" OUTPUT="$PWD/daed" bundle
# 从 wing/ 构建，复用已锁定的 Go 依赖
(cd wing && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o ../btf-probe ../openwrt/btf-probe.go)
(cd wing && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o ../luci-proxy ../openwrt/luci-proxy.go)
python3 openwrt/build.py --target ipk-x86_64 --binary ./daed --btf-probe ./btf-probe --luci-proxy ./luci-proxy --version 0.2.1 --work /path/to/sdk-cache --output /path/to/packages
python3 openwrt/manifest.py /path/to/packages --version 0.2.1
node --test tests/openwrt/ui.test.cjs
```

其余 SDK 目标：`ipk-arm64`、`apk-x86_64`、`apk-arm64`。SDK URL、哈希和
feed 提交固定在 `sdk-matrix.json`，原生打包后逐一验证文件、架构和权限。
手动工作流生成 artifact，测试版仍需维护者核验并发布为 prerelease。

自动测试、原生 uhttpd / rpcd 和浏览器验证的范围见 [VALIDATION.md](./VALIDATION.md)。
