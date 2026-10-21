# NaiLink 安装与使用

## OpenWrt / ImmortalWrt / iStoreOS

请使用 [README 中的安装菜单](../README.md#安装更新与卸载)，或阅读[在线安装文档](https://slobys.github.io/NaiLink/installation.html)。脚本检查 CPU、包格式和实际内核能力，更新保留节点与配置，卸载前备份。

安装后打开后台 **服务 → NaiLink**，按[首次设置](https://slobys.github.io/NaiLink/quick-start.html)导入节点、加入群组、应用配置。

不要在 OpenWrt 上运行 systemctl，也不要下载上游旧 DEB / RPM 替代 NaiLink 插件。ARMv7 / MIPS 的限制见[兼容性说明](https://slobys.github.io/NaiLink/installation.html)。

## 普通 Linux / Docker

这是独立部署入口，不带 LuCI 插件或路由器安装菜单。宿主机仍须具备所需 eBPF、JIT、BTF 和内核能力。

Docker 构建支持 `linux/amd64` 和 `linux/arm64`。Windows / macOS 的 Docker Desktop 可用于构建、API 和页面检查，不代表宿主机透明代理可用。

```sh
git clone --recurse-submodules https://github.com/slobys/NaiLink.git
cd NaiLink
docker compose build
docker compose up -d
docker compose logs -f
```

Linux 上打开 `http://服务器地址:2023`，完成初始化。Compose 使用主机网络和特权权限以访问宿主机网络；该端口不要直接暴露公网。配置沿用宿主机 `/etc/daed`，更新前先备份。构建需要访问 Docker Hub、包仓库和 GitHub。

停止容器：`docker compose down`。它不会删除绑定目录 `/etc/daed`。容器卸载和 OpenWrt 插件卸载是不同操作。

完整构建和普通 Linux 服务安装见[构建说明](build.md)，联网问题见[故障排查](https://slobys.github.io/NaiLink/troubleshooting.html)。
