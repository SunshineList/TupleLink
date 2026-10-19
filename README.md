# NaiLink · 奶油互联

基于 [daeuniverse/daed](https://github.com/daeuniverse/daed) 二次开发，面向 OpenWrt、ImmortalWrt 和 iStoreOS 的 LuCI 后台使用。

在一个面板里管理节点、订阅和群组，查看实时流量、测试节点延迟，并设置 DNS 与路由规则。支持电脑和手机，多种主题可选，沿用路由器后台登录。

## 安装或升级

支持 **x86_64 和 ARM64**，提供 IPK / APK v3 安装包。固件需具备现代 LuCI、受支持的内核、eBPF 和匹配的 BTF；安装器会先检查兼容性，具体条件见[安装说明](openwrt/README.md)。

在路由器 SSH 中以 root 执行：

```sh
uclient-fetch -O /tmp/daed-install.sh https://github.com/slobys/daed/releases/download/openwrt-v0.6.14/install.sh && sh /tmp/daed-install.sh --release openwrt-v0.6.14
```

已有本项目安装时，执行同一条命令即可升级。升级前自动备份，保留节点、订阅、群组和配置；备份位于 `/root/daed-backups`。其他来源的 Daed 安装请先参阅迁移说明。

## 获取完整源码

```sh
git clone --recurse-submodules https://github.com/slobys/daed.git
cd daed
```

也可以直接下载 [0.6.14 完整源码包](https://github.com/slobys/daed/releases/download/openwrt-v0.6.14/daed-openwrt-source.tar.gz)，其中已包含后端子模块。GitHub 的 **Code → Download ZIP** 不包含子模块；编译请使用上述任一方式，步骤见[开发说明](openwrt/README.md#开发)。

## 开始使用

1. 打开路由器后台 **服务 → NaiLink**（已发布的 0.6.13 及更早版本显示为 **Daed**）。
2. 在 **节点和订阅** 中导入节点或添加订阅，名称可以留空自动识别。
3. 在 **管理面板** 中将节点或订阅加入群组，测试后选择合适的节点。
4. 按需调整 **高级设置** 中的接口、DNS 和路由，再点击 **应用配置**。

出现问题可先查看 **运行日志**。节点能否联网还取决于服务器、线路和配置，导入成功不代表连接一定可用。

## 交流与反馈

- [YouTube 频道](https://www.youtube.com/@naiyou) · [Telegram 群组](https://t.me/naiyous)
- [下载新版](https://github.com/slobys/daed/releases) · [反馈问题](https://github.com/slobys/daed/issues)
- [详细安装、升级和卸载说明](openwrt/README.md) · [验证记录](openwrt/VALIDATION.md)

## 致谢与许可

感谢 [daed](https://github.com/daeuniverse/daed)、[dae-wing](https://github.com/daeuniverse/dae-wing) 和 [dae](https://github.com/daeuniverse/dae)。本仓库是独立维护的分支，并非上游官方发行版。

前端及安装集成遵循 [MIT](LICENSE)，后端及其修改遵循 [AGPL-3.0](https://github.com/daeuniverse/dae-wing/blob/main/LICENSE)。相关版权声明与子模块版本均保留。
