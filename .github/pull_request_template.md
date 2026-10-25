## 改了什么

<!-- 一两句话说明这次改动解决的问题。写"为什么"比"怎么做"重要。 -->

## 怎么验证的

<!--
写清你实际跑过什么。参考 CONTRIBUTING.md 的提交前清单：

- pnpm test
- pnpm check-types
- pnpm lint:check
- python3 -m unittest discover -s tests/repository -v
- python3 -m unittest discover -s tests/docs -v
- python3 -m unittest discover -s tests/openwrt -v

改了 openwrt/ 下的安装、DNS、路由或后端时，模拟环境通过不等于真实透明代理验证通过。
如果在真机上验证过，写明固件、CPU 和 NaiLink 版本，例如：
iStoreOS 24.10.5 / x86_64 / kernel 6.6.119 / 0.6.31。

没跑过的检查也要说出来，别让人以为你跑了。
-->

## 检查清单

- [ ] `pnpm test` 通过
- [ ] `pnpm check-types` 通过
- [ ] `pnpm lint:check` 通过
- [ ] 改了 `openwrt/` 时跑过 `python3 -m unittest discover -s tests/openwrt -v`
- [ ] 改了版本号或发布相关文件时，`openwrt/README.md` / `CHANGELOG.md` 已同步
- [ ] 没有把 `wing` 子模块指针改掉（增量应该放在 `openwrt/wing/`）

## 安全相关

<!--
涉及凭据、会话、安装器或权限时勾选，并说明影响面。
参考 SECURITY.md：面板经 LuCI 会话门进入，安装器逐文件校验 sha256。
-->

- [ ] 不涉及安全边界
- [ ] 涉及安全边界，已在正文说明影响

## 相关

<!-- 修复的 issue 编号、关联的上游 commit，或需要同步的文档。 -->
