# relay

语音输入工具：按住快捷键说话，relay 会帮你整理语音、理解当前界面，并把内容放进你正在使用的应用里。

双平台，**以 macOS 为核心**：

| 目录 | 平台 | 状态 |
|------|------|------|
| [`mac/`](mac/) | macOS（SwiftPM + SwiftUI） | **核心主线**，活跃开发 |
| [`android/`](android/) | Android（Gradle + Kotlin） | 次线，持续打磨维护；待 Mac 版成熟后再做完整移植与迭代 |

## 仓库结构

```
relay/
├── mac/         # 核心 macOS 应用（relay）
├── android/     # 次线 Android 应用
├── docs/        # 设计规范等
├── marketing/   # 落地页 / 商业计划
├── README.md
└── BUILD.md     # 构建 · 版本 · 密钥 · 分支与发布流程
```

## 快速开始

完整的构建、版本号、密钥配置、分支与发布流程，见 **[BUILD.md](BUILD.md)**。

macOS（核心）：

```bash
cd mac
./build-app.sh --flavor dev      # 开发版；--flavor beta 出公测版
```

Android（次线）：

```bash
cd android
./build.sh --dev                 # 或 --beta
```

> 首次构建前需按模板创建本地密钥文件：
> `mac/Secrets.example.swift` → `mac/Sources/Secrets.swift`；
> `android/local.properties.example` → `android/local.properties`。详见 [BUILD.md](BUILD.md)。
