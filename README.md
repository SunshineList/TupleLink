# NaiLink · 奶油互联

一个适用于 **OpenWrt、ImmortalWrt、iStoreOS** 的代理管理插件。管理节点、订阅和群组，查看实时流量，测试节点延迟，配置 DNS 与路由。支持电脑、手机和多种主题，沿用路由器后台登录。

基于 [daed](https://github.com/daeuniverse/daed) 二次开发，独立维护。当前为 [0.6.20 测试版](https://github.com/slobys/NaiLink/releases/tag/openwrt-v0.6.20)，提供 IPK / APK v3 安装包。

| CPU 架构                            | 支持范围                                 |
| ----------------------------------- | ---------------------------------------- |
| x86_64、ARM64                       | 已提供安装包                             |
| ARMv7 小端                          | 仅实验构建；已测常见内核无法运行透明代理 |
| MIPS32r2、MIPSel32r2                | 仅实验构建；已测常见内核无法运行透明代理 |
| ARMv5/v6、MIPS64、RISC-V、32 位 x86 | 暂不支持                                 |

需要 **Linux 5.17+、所需 eBPF/JIT 功能、可用 BTF 和 LuCI**。脚本按 CPU、固件包架构和 IPK/APK 自动选择，并实际加载、关闭临时内核探针，不兼容时停止安装。**ARMv7 / MIPS 常见内核缺少当前核心必需的 BPF 回调能力，暂不推荐安装作为透明代理使用**；管理页面能打开不代表代理可用，详见[兼容性与架构说明](openwrt/README.md#兼容性与架构范围)。

## 安装、更新与卸载

用 SSH 以 **root** 登录路由器，执行下面的命令打开中文菜单：

```sh
uclient-fetch -O /tmp/nailink-install.sh https://github.com/slobys/NaiLink/releases/download/openwrt-v0.6.20/install.sh && sh /tmp/nailink-install.sh --menu --release openwrt-v0.6.20
```

- **1 安装 / 更新**：获取最新发布版；已有安装会先备份，并保留节点、订阅、群组和配置。
- **2 卸载**：确认后先备份，再删除插件及当前节点、配置。已有备份和共享依赖保留。
- **3 检查环境**：只检查兼容性，不修改系统。
- **0 退出**：不执行操作。

安装后，直接运行 `nailink` 即可再次打开菜单。卸载可离线执行；备份保存在 `/root/daed-backups`。

菜单提示无法解析 `raw.githubusercontent.com` 时，可执行 `nailink --install --release openwrt-v0.6.20` 绕过该入口。如果 `github.com` 也无法解析，先检查路由器自身的 DNS，详见[更新故障处理](openwrt/README.md#安装和保留数据升级)。

已安装旧版、只想直接卸载，也可以执行：

```sh
daed-router-setup --uninstall
```

## 开始使用

打开路由器后台 **服务 → NaiLink**：

1. 在 **节点和订阅** 导入节点或添加订阅，名称可留空自动识别。
2. 在 **管理面板** 将节点或订阅加入群组，测试并选择节点。
3. 按需调整 **高级设置** 中的接口、DNS 与路由，点击 **应用配置**。

运行异常时先查看 **运行日志**。升级后重新登录后台；0.6.13 及更早版本的菜单名为 Daed。

## 下载与源码

[下载安装包](https://github.com/slobys/NaiLink/releases) · [完整源码包](https://github.com/slobys/NaiLink/releases/download/openwrt-v0.6.20/daed-openwrt-source.tar.gz) · [详细说明](openwrt/README.md) · [验证记录](openwrt/VALIDATION.md)

编译源码请使用完整源码包，或运行 `git clone --recurse-submodules https://github.com/slobys/NaiLink.git`。GitHub 的 **Download ZIP** 不包含后端子模块。

## 交流与致谢

[YouTube 频道](https://www.youtube.com/@naiyou) · [Telegram 群组](https://t.me/naiyous) · [反馈问题](https://github.com/slobys/NaiLink/issues)

感谢 [daed](https://github.com/daeuniverse/daed)、[dae-wing](https://github.com/daeuniverse/dae-wing) 和 [dae](https://github.com/daeuniverse/dae)。本项目并非上游官方发行版。前端及安装集成遵循 [MIT](LICENSE)，后端及其修改遵循 [AGPL-3.0](https://github.com/daeuniverse/dae-wing/blob/main/LICENSE)，保留相关版权声明。
