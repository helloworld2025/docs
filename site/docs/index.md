---
layout: home

hero:
  name: "Relay 文档中心"
  text: "统一查阅 · 网页编辑 · 代码同步"
  tagline: 聚合 account / relay / analytics 三个仓库的文档，支持网页端直接编辑，也支持代码方式（git push）新增文档
  actions:
    - theme: brand
      text: 综合文档
      link: /general/
    - theme: alt
      text: Account (SSO)
      link: /account/
    - theme: alt
      text: Relay
      link: /relay/
    - theme: alt
      text: Analytics
      link: /analytics/
    - theme: alt
      text: ＋ 新建分类
      link: /edit/?action=create-section
      target: _self


features:
  - title: 📝 网页端编辑
    details: 登录后可直接在网页上新增/编辑 Markdown 文档，保存后自动提交到对应源仓库
  - title: 💻 代码方式同步
    details: 工程师照常在各自仓库的 docs/ 目录 git push，定时自动同步到本站点
  - title: 🔒 独立账号体系
    details: 与公司现有 admin 后台一致的登录方式（邮箱+密码+Turnstile 人机校验）
---
