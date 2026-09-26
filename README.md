<div align="center">
  <a id="readme-top"></a>

  <img src="./image.png" alt="WebSpeak 项目横幅" width="100%" />

  <h1>WebSpeak</h1>

  <p><strong>让 TeamSpeak 自然地进入浏览器。</strong></p>
  <p>A self-hosted browser voice client for TeamSpeak 3 and TeamSpeak 6.</p>

  [![Latest Release](https://img.shields.io/github/v/release/EchoSixHIYA/WebSpeak-client-for-TeamSpeak?sort=semver&display_name=tag&style=flat-square&color=0f766e)](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/latest)
  [![Docker Image](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/actions/workflows/docker-publish.yml/badge.svg?branch=master)](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/actions/workflows/docker-publish.yml)
  [![License](https://img.shields.io/badge/license-AGPL--3.0--only-0f766e?style=flat-square)](./LICENSE)
  [![GitHub Stars](https://img.shields.io/github/stars/EchoSixHIYA/WebSpeak-client-for-TeamSpeak?style=flat-square&logo=github&color=0f766e)](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/stargazers)
  <br />
  [![TeamSpeak](https://img.shields.io/badge/TeamSpeak-3%20%7C%206-2580C3?style=flat-square)](https://www.teamspeak.com/)
  [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.5-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
  [![Vue](https://img.shields.io/badge/Vue-3-42B883?style=flat-square&logo=vuedotjs&logoColor=white)](https://vuejs.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Docker](https://img.shields.io/badge/Docker-GHCR-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/EchoSixHIYA/packages/container/package/webspeak)

  <p>
    <a href="./docs/README.zh-CN.md">简体中文文档</a> ·
    <a href="./docs/README.en.md">English documentation</a> ·
    <a href="./docs/README.de.md">Deutsche Dokumentation</a> ·
    <a href="./docs/README.ru.md">Русская документация</a> ·
    <a href="./docs/README.ja.md">日本語ドキュメント</a>
  </p>
</div>

## 项目简介 · Overview

| 逻辑 | 中文 | English |
| --- | --- | --- |
| **WHAT** | WebSpeak 是一个可自行部署的 TeamSpeak 3 / TeamSpeak 6 网页客户端与语音网关。 | WebSpeak is a self-hosted browser client and voice gateway for TeamSpeak 3 and TeamSpeak 6. |
| **WHY** | 无需安装桌面客户端，用户打开网页即可加入频道；部署者仍然掌控目标服务器、访问策略和数据。 | Users can join a voice channel from a browser without installing a desktop client, while the operator keeps control of servers, access, and data. |
| **HOW** | 部署后在管理员控制台配置 TeamSpeak 目标和访问方式，浏览器负责交互与音频，WebSpeak 负责网关连接。 | Configure the TeamSpeak target and access policy in the administration console. The browser handles interaction and audio; WebSpeak provides the gateway connection. |

## 文档 · Documentation

- [简体中文](./docs/README.zh-CN.md)
- [English](./docs/README.en.md)
- [Deutsch](./docs/README.de.md)
- [Русский](./docs/README.ru.md)
- [日本語](./docs/README.ja.md)
- [皮肤开发规范](./docs/SKIN_DEVELOPMENT.md)
- [WebSpeak 皮肤开发 Agent Skill](./.agents/skills/webspeak-skin-development/SKILL.md)

## 社区 · Community

<div align="center">

<a href="http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=yhumUMDD9PmyYFWdXWUb_x7hM5trFQY8&authKey=Pw3HBGT7GwMinTQnuFGfnpf0aRSzXOJKcAiujVP1%2BXMpjheAKrncTRivicBJxpjV&noverify=0&group_code=869500475">
  <img src="./web/public/qq-group-qr.jpg" alt="WebSpeak QQ 群二维码" width="290" />
</a>

**QQ群 / QQ group：`869500475`**

[通过群聊链接直接加入 / Join directly](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=yhumUMDD9PmyYFWdXWUb_x7hM5trFQY8&authKey=Pw3HBGT7GwMinTQnuFGfnpf0aRSzXOJKcAiujVP1%2BXMpjheAKrncTRivicBJxpjV&noverify=0&group_code=869500475)

[Telegram 群组 / Telegram group](https://t.me/+8qShpTcuN9A3MWY9)

</div>

## 友链项目 · Friend projects

### [NeteaseTSBot](https://github.com/yichen11818/NeteaseTSBot)

面向 TeamSpeak 3/6 的多平台音乐点播机器人，支持网易云音乐、QQ 音乐和 Bilibili 音频播放，并提供 Web 控制台。<br />
A multi-platform music bot for TeamSpeak 3/6 with Netease Cloud Music, QQ Music, and Bilibili playback, plus a web console.<br />
Ein plattformübergreifender Musikbot für TeamSpeak 3/6 mit Netease Cloud Music, QQ Music und Bilibili sowie Webkonsole.

## Contributors · 贡献者

感谢提交 PR 的贡献者：

- [LainHE](https://github.com/LainHE) — [PR #2](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pull/2)：浏览器端报错翻译与提示改造。

## 许可证 · License · Lizenz · Лицензия · ライセンス

WebSpeak 使用 [GNU Affero General Public License v3.0 only](./LICENSE) 发布。你可以使用、研究、修改和再分发本项目；如果修改后的版本通过网络向用户提供服务，需要按照 AGPL-3.0 向这些用户提供对应源代码。

WebSpeak is released under the [GNU Affero General Public License v3.0 only](./LICENSE). If a modified version is offered to users over a network, its corresponding source code must be offered under AGPL-3.0.

WebSpeak wird unter der [GNU Affero General Public License v3.0 only](./LICENSE) veröffentlicht. Bei Bereitstellung einer veränderten Version über ein Netzwerk muss der entsprechende Quellcode unter AGPL-3.0 angeboten werden.

WebSpeak распространяется по лицензии [GNU Affero General Public License v3.0 only](./LICENSE). Если изменённая версия предоставляется пользователям через сеть, соответствующий исходный код должен быть доступен этим пользователям на условиях AGPL-3.0.

WebSpeak は [GNU Affero General Public License v3.0 only](./LICENSE) の下で公開されています。変更版をネットワーク経由でユーザーに提供する場合は、対応するソースコードを AGPL-3.0 に従ってユーザーに提供する必要があります。

## Star History

<a href="https://star-history.com/#EchoSixHIYA/WebSpeak-client-for-TeamSpeak&Date">
  <img src="https://api.star-history.com/svg?repos=EchoSixHIYA/WebSpeak-client-for-TeamSpeak&type=Date" alt="WebSpeak Star History" width="100%" />
</a>

<div align="right"><a href="#readme-top">返回顶部 · Back to top ↑</a></div>
