# 安全策略

## 支持范围

安全修复只进入最新发布的测试版。请先确认问题在[最新版本](https://github.com/slobys/NaiLink/releases)上仍可复现。

## 报告问题

请不要在公开 issue 或群里披露细节，改用 GitHub 的[私密漏洞报告](https://github.com/slobys/NaiLink/security/advisories/new)。

报告请包含：受影响的版本（`/usr/share/daed-router/version`）、固件与 CPU 架构（`ubus call system board`）、复现步骤、影响范围，以及可复现时的最小配置片段。请勿附带订阅链接、密码、`wing.db` 或 `luci-session.json`。

## 部署面

NaiLink 把管理面板挂在 LuCI 之后，面板本身不额外开放端口：

- `luci-proxy.go` 只接受经 `ubus call session access` 授权的会话，拒绝非 GET/HEAD/POST，限制请求体大小，并剥离转发头。
- `rpcd-daed` 的 `action` 只接受固定的服务动作白名单，其余读写权限由 `acl.json` 收紧。
- 安装器校验发布清单里每个文件的 sha256，并拒绝符号链接目录。

因此，面板的可信边界等于 LuCI 账号本身。请为 LuCI 使用强密码、只在内网暴露管理界面，并及时更新固件。

## 不在范围内

- 需要先取得 root 或 LuCI 管理权限才能触发的行为。
- 上游 daed / dae-wing 自身的缺陷：请同时反馈给[上游](https://github.com/daeuniverse/daed)。
- 透明代理本身的流量特征，以及被代理目标侧的可见性。
