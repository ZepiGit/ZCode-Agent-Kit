# ZCode Proxy
[English (original)](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [日本語](README.ja.md) · **简体中文**

此组件提供 ZCode Agent Kit 随附的本地模型代理。Kit 负责其安装配置以及
与助手工具的集成。

## 在 ZCode Agent Kit 中使用

请使用[主 README](../README.zh-CN.md)中介绍的设置和模型命令。随附源码
版本及本地修改记录在[组件清单](../MANIFEST.md)中。

## 安全

该代理面向可信的本地环境。请仅在本机运行，并保护登录信息和配置数据。
部分服务商验证流程可能会在没有操作系统沙箱的情况下执行服务商提供的
JavaScript；本地绑定无法隔离这段代码。请阅读[安全政策](../SECURITY.md)，
并且不要将服务暴露到本机之外。

## 许可

此捆绑组件可能适用与 Kit 不同的条款。重新分发前，请查看[组件清单](../MANIFEST.md)
以及适用的上游声明。
