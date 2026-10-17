# Daed 软路由插件（第一期）

目标是 OpenWrt、ImmortalWrt、iStoreOS 的 LuCI，提供 x86_64 和 ARM64
原生运行程序、IPK/APK 软件包、服务控制和现有 Daed 面板入口。
APK 包使用 OpenWrt 的 APK v3 格式，安装器要求 apk-tools 3.x。

当前为待实机验收的第一期测试版，发行标签为
[openwrt-v0.1.2](https://github.com/slobys/daed/releases/tag/openwrt-v0.1.2)。
工作流只生成构建产物，不自动发布；测试发行由维护者上传完整资产。

## 使用前提

- 已安装固件自带的现代 JavaScript LuCI、rpcd、UCI、jshn、jsonfilter。
- Linux 5.17+，并具备 dae 所需 BPF 功能。支持原生 BTF，或底层加载器
  搜索路径中对应当前内核版本的外部 BTF/vmlinux（包括符号链接）。
  随包静态解析器检查 BTF 格式、ELF 架构和必要网络类型。
  内核配置不可读取时会显示待核验，实际 eBPF 加载仍须测试。
- 管理页面默认绑定 `lan` 逻辑网络的运行时 IPv4 地址，端口 2023。
  主路由和旁路由都应确认正确的 LAN 网络名称；不要求改动 LAN/WAN。
- 固件原有软件源能提供匹配本机内核 ABI 的 `kmod-sched-core`、
  `kmod-sched-bpf`、`kmod-veth`，以及 `ca-bundle`、`v2ray-geoip`、`v2ray-geosite`。
- 有足够的 `/tmp` 空间暂存两个安装包、overlay 空间安装程序。

系统名称不等于兼容性证明。第一期不自动刷机，不自动下载或替换 BTF 文件，
不更换软件源、不强制忽略 kmod 依赖，不修改其他代理、DNS 或防火墙。
IPv6 透明代理由原有内核及面板配置负责；本期自动面板入口需要 LAN IPv4。

## 获取安装包

用户可直接使用下方固定版本的一键安装入口，安装器只下载匹配本机的包。
需要离线安装时，从测试版 Release 下载本机架构的运行包、同格式的 LuCI
包，以及清单、检查器和安装脚本。构建完整产物包含：

- `daed-router-版本-架构.ipk/apk`：静态运行程序、服务、兼容检查。
- `luci-app-daed-router-版本.ipk/apk`：LuCI 页面与受 ACL 保护的 RPC。
- `manifest.tsv`、`SHA256SUMS`、`daed-check`、`install.sh`、两架构 `btf-probe`。
- 对应源码和主仓库、子模块提交记录。

ARM64 包覆盖清单中的 generic、a35、a53、a55、a72、a73、a75、a76
架构标签，程序使用同一个 ARM64 基线二进制。APK 优先读取 `/etc/apk/arch`
中的有效架构列表，仅在列表为空或文件不存在时使用 `apk --print-arch`
的编译默认值；opkg 按其架构优先级选择。清单缺少对应标签时退出。

维护者也可在 GitHub Actions 手动运行 **OpenWrt plugin**，填写 `X.Y.Z`
版本号，下载 `daed-openwrt-X.Y.Z` artifact。发布时上传完整产物，尚未完成
实机验收的版本必须标记为 prerelease。不要混用不同版本的清单和检查器。

## 安装

在路由器 SSH 中以 root 执行：

```sh
uclient-fetch -O /tmp/daed-install.sh https://github.com/slobys/daed/releases/download/openwrt-v0.1.2/install.sh && sh /tmp/daed-install.sh --release openwrt-v0.1.2
```

仅预检时，在末尾追加 `--check`；选包并校验但不安装时追加 `--dry-run`。
下载校验依赖可信 HTTPS；APK 使用 `--allow-untrusted` 安装已通过清单
SHA-256 校验的本地包，不会修改系统的软件源签名设置。

离线安装可将下载的产物放到路由器 `/tmp/daed-release`：

```sh
cd /tmp/daed-release
sh install.sh --asset-dir /tmp/daed-release --check
sh install.sh --asset-dir /tmp/daed-release --dry-run
sh install.sh --asset-dir /tmp/daed-release
```

安装器按 `manifest.tsv` 校验实际使用的包和检查器。下载了完整发行目录时，
可额外执行 `sha256sum -c SHA256SUMS` 校验所有发行文件。

`--check` 只检查环境；`--dry-run` 还会选包并校验 SHA-256，APK 额外使用
已有软件源索引模拟依赖解析；索引缺失时可能失败，正式安装会先更新索引。
两者都不会更新软件源缓存、安装包或启动服务。正式安装通过本机
opkg/apk 解析依赖，不添加外部软件源。APK 正式安装也会先模拟解析，失败时
不停止或卸载原有 Daed。首次安装会启动管理服务并开启自启，
**启用代理仍需在面板完成账户、节点、接口和规则配置**。

## LuCI 页面

刷新软路由后台，进入 **服务 → Daed**：

1. **运行状态**：固件、架构、内核、BTF、必要内核配置、其他代理提示。
   服务状态来自 procd，不能等同于代理启用或真实 LAN 流量验证。
2. **服务设置**：管理服务启用、LAN 网络、管理端口、仅本机监听。
   开机自启在运行状态页单独控制。
3. **管理面板**：保留现有 Daed 账户鉴权。HTTP LuCI 内嵌面板；HTTPS
   LuCI 提供新窗口入口，避免混合内容被浏览器拦截。统一 HTTPS/单点登录
   未在第一期实现，已有反向代理需自行配置。
4. **运行日志**：最近 120 行，最多读取 32 KB，常见链接和凭据字段遮盖。
   日志在 `/var/log/daed`，单文件 1 MB、保留一份轮转，避免持续写闪存。

LAN 地址变化时 procd 接口触发器重载服务。正常停止通过 SIGTERM 给
dae 留出清理时间，不删除其他程序的网络命名空间或刷新全部防火墙。

## 已有安装、升级与卸载

检测到原版 `daed` / `luci-app-daed` 包、未受本项目包管理的二进制或
数据目录时拒绝覆盖。需要全新安装时，显式使用 `--reinstall`。不自动迁移原版数据库。

升级本项目安装前先停止管理服务，确认进程退出，再将 `/etc/daed`
（含 SQLite WAL）、UCI 配置及版本记录备份到 `/root/daed-backups`。
备份目录 0700、归档 0600。保留原来的运行和开机自启选择。
包安装失败时退出并保持服务停止，提示备份路径；不宣称原子包升级或
自动回滚。需要恢复时先安装先前版本的软件包，再在停止状态下恢复备份。
备份可能包含节点凭据、账户和密钥，请妥善保存。

脚本提供独立卸载和一步重装：

```sh
# 下载本发行的 install.sh 后执行，卸载不依赖下载其他发行文件
sh /tmp/daed-install.sh --uninstall
# 已有原版时，先核验新资产（APK 还模拟依赖），再备份、卸载并全新安装
sh /tmp/daed-install.sh --reinstall
```

安装成功后，脚本同时保存在 `/usr/sbin/daed-router-setup`。后续可直接执行
`daed-router-setup --uninstall`，无需再次下载脚本。

这两个显式操作会先停止 Daed 并等待进程退出，将配置、数据库（含 WAL）、
服务脚本及旧二进制备份到 `/root/daed-backups/uninstall-*.tar.gz`，核验归档
后移除 Daed 的软件包（包括语言包）和原配置/数据。备份失败或包移除失败
时退出并保留数据；不跟随符号链接清理数据目录。单独卸载不要求 BTF、现代
LuCI 或网络可用，支持重复执行。`--dry-run` 可与卸载或重装组合。

APK 会自动移除孤立依赖，因此卸载前会将已安装的 BTF、内核模块和必要运行
依赖保留在 world 中；不执行依赖升级或下载。opkg 不启用自动依赖清理。
`--reinstall` 启动的是全新管理服务，旧账户、节点和规则需要重新配置，
备份不会自动导入。`keep.d` 支持固件标准 sysupgrade 备份，跨版本恢复仍须验证。

## 开发与验证

没有新增 npm 或 Go 依赖。BTF 解析器复用 wing 已有的 cilium/ebpf v0.20.0。插件使用 LuCI 自带 JS、BusyBox shell 和
固件原生 JSON 工具；SDK 打包工具使用 Python 标准库。

```sh
# Linux 构建主机；解析器从 wing/ 构建，复用其依赖
(cd wing && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o ../btf-probe ../openwrt/btf-probe.go)
# 提供同架构的真实静态 Daed 程序和解析器
python3 openwrt/build.py --target ipk-x86_64 --binary ./daed --btf-probe ./btf-probe --version 0.1.2 --work /path/to/sdk-cache --output /path/to/packages
# 其余 target：ipk-arm64 / apk-x86_64 / apk-arm64
python3 openwrt/manifest.py /path/to/packages --version 0.1.2
node --test tests/openwrt/ui.test.cjs
```

SDK 下载地址和 SHA-256 固定在 `sdk-matrix.json`，编译前检查 ELF 架构与
静态链接。内核模块通过路由器自己的软件源安装。SDK 版本代表包格式的
构建基线，不表示只支持该固件版本，也不表示其他固件已通过实机验收。

测试使用校验过的 OpenWrt x86_64 rootfs，在一次性 chroot 中运行真实
BusyBox ash、UCI、jshn 和 jsonfilter；包管理、服务、内核及网络是夹具。
ARM64 架构选择测试为模拟 uname/包架构，不能当作 ARM64 实机运行证明。

实机发布门槛：三类固件目标组合的安装/依赖解析、LuCI ACL 和保存设置、
真实 eBPF 加载、LAN IPv4/IPv6 流量与 DNS、PPPoE/接口重连、重启自启、
停止后的网络恢复，以及升级后的数据完整性。测试状态应随验证更新。
本轮验证记录见 [VALIDATION.md](./VALIDATION.md)。
