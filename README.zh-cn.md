<p align="center">
  <img src="frontend/public/icon.svg" alt="FMMatchLens 图标" width="112" height="112">
</p>

<h1 align="center">FMMatchLens</h1>

<p align="center">
  <a href="README.md">English</a> | <strong>简体中文</strong>
</p>

<p align="center">
  Football Manager 本地比赛数据采集、存档与可视化分析工具
</p>

<p align="center">
  <a href="https://github.com/osnsyc/FMMatchLens/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/osnsyc/FMMatchLens/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/osnsyc/FMMatchLens/releases"><img alt="最新版本" src="https://img.shields.io/github/v/release/osnsyc/FMMatchLens?display_name=tag&color=7c3aed"></a>
  <a href="https://www.footballmanager.com/"><img alt="Football Manager 26.x" src="https://img.shields.io/badge/Football%20Manager-26.x-7c3aed"></a>
  <img alt="平台 Windows" src="https://img.shields.io/badge/platform-Windows-2563eb">
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#插件配置">插件配置</a> ·
  <a href="#开发者指南">开发者指南</a> ·
  <a href="#支持与反馈">支持与反馈</a>
</p>

---

FMMatchLens 通过读取 Football Manager 比赛运行时数据，在本机提供 HTTP/WebSocket 接口，并通过浏览器数据面板实时呈现比赛信息。数据默认留在本机，也可以保存为 `.fmlens` 文件离线回放。


## 核心特性

- **实时采集**：自动检测比赛状态，通过本地 WebSocket 低延迟更新数据。
- **多维分析**：提供比赛时间线、动量走势、xG 曲线、阵型、事件与球员站位热区。
- **完整阵容信息**：展示阵容、角色职责、关键属性、球员头像与俱乐部图标。
- **增量存档**：持续写入 `.fmlens`，异常退出时尽量保留已经完整写入的记录。
- **离线回放**：直接选择或拖放本地存档，无需启动游戏即可回看比赛。
- **本地优先**：API 默认只监听 `127.0.0.1:16726`，无需将比赛数据上传至第三方。
- **FM风格界面**：遵循 Football Manager Brand 风格，提供亮色、暗色主题，支持简体中文与英文切换。

## 快速开始

本节面向直接使用发布版的普通用户。你不需要下载源码，也不需要安装 .NET、Node.js 或 npm。

### 1. 安装前确认

请先确认以下条件：

- 操作系统为 **Windows 10/11 x64**。
- 游戏为 **Football Manager 2026 26.3**。其他版本可能因游戏内部结构不同而无法采集数据。
- 游戏已安装 **BepInEx 6 IL2CPP x64**。如果尚未安装，请先完成下一节。

FMMatchLens 的每个版本包含两个用途不同的压缩包：

| 文件 | 用途 | 应放在哪里 |
| --- | --- | --- |
| `FMMatchLens-plugin-v版本号.zip` | 在游戏内采集数据并启动本地接口 | 解压到 Football Manager 2026 游戏根目录 |
| `FMMatchLens-dashboard-v版本号.zip` | 显示实时比赛或回放存档 | 解压到任意普通文件夹 |

请从 [Releases](https://github.com/osnsyc/FMMatchLens/releases) 的同一个版本中下载这两个文件。不要下载页面上的 `Source code (zip)` 或 `Source code (tar.gz)`，它们是给开发者使用的源码，不能直接安装。

### 2. 安装 BepInEx 6

如果游戏目录中已经存在可正常使用的 `BepInEx` 文件夹，可以跳过本节。

1. 先阅读 [BepInEx 官方 IL2CPP 安装说明](https://docs.bepinex.dev/master/articles/user_guide/installation/unity_il2cpp.html)，再从 [BepInEx Bleeding Edge Builds](https://builds.bepinex.dev/projects/bepinex_be) 下载文件名包含 `Unity.IL2CPP-win-x64` 的 BepInEx 6 压缩包。不要误下成 `Unity.Mono`、`win-x86` 或其他系统版本；如 FMMatchLens Release 指定了 BepInEx 版本，则以该说明为准。
2. 找到 Football Manager 2026 的游戏根目录：
   - Steam：在游戏库中右键 Football Manager 2026，依次选择“管理”→“浏览本地文件”。
   - 其他平台：使用平台提供的“管理”“安装位置”或“浏览文件”功能。
3. 将 BepInEx 压缩包中的全部内容解压到该目录。这里的“游戏根目录”是游戏主程序所在的目录，不是“文档”中的存档目录。
4. 启动游戏一次，进入主菜单后退出。BepInEx 第一次启动可能需要稍长时间来生成运行文件。
5. 回到游戏根目录，确认已经生成 `BepInEx/core/` 和 `BepInEx/LogOutput.log`。

安装完成后的目录大致如下：

```text
Football Manager 2026/
├─ BepInEx/
│  ├─ core/
│  ├─ plugins/
│  └─ LogOutput.log
├─ doorstop_config.ini
├─ winhttp.dll
└─ <游戏主程序及其他文件>
```

如果启动游戏后没有生成这些文件，说明 BepInEx 尚未成功加载。此时应先解决 BepInEx 安装问题，再继续安装 FMMatchLens。

### 3. 安装 FMMatchLens 插件

1. 打开 [Releases](https://github.com/osnsyc/FMMatchLens/releases)，下载最新兼容版本的 `FMMatchLens-plugin-v版本号.zip`。
2. 如果压缩包的“属性”窗口中出现“解除锁定”选项，请先勾选“解除锁定”并应用，以免 Windows 阻止 DLL 加载。
3. 将压缩包**直接解压到 Football Manager 2026 游戏根目录**。Windows 询问是否合并 `BepInEx` 文件夹时选择允许；升级旧版本时允许覆盖 FMMatchLens 文件。
4. 检查下面这个文件是否真实存在：

   ```text
   <游戏根目录>/BepInEx/plugins/FMMatchLens/FMMatchLens.Plugin.dll
   ```

   正确的主要目录结构应为：

   ```text
   Football Manager 2026/
   └─ BepInEx/
      ├─ config/
      │  └─ com.fmmatchlens.plugin.cfg.example
      └─ plugins/
         └─ FMMatchLens/
            └─ FMMatchLens.Plugin.dll
   ```

5. 启动游戏并进入主菜单。
6. 插件首次成功加载后，会自动生成正式配置文件：

   ```text
   <游戏根目录>/BepInEx/config/com.fmmatchlens.plugin.cfg
   ```

### 4. 下载并打开数据面板

1. 从同一个 Release 下载 `FMMatchLens-dashboard-v版本号.zip`。
2. 在桌面、下载目录或其他位置新建一个文件夹，例如 `FMMatchLens Dashboard`。
3. 将面板压缩包完整解压到该文件夹。解压后应能在同一级看到：

   ```text
   FMMatchLens Dashboard/
   ├─ index.html
   ├─ assets/
   ├─ icon.svg
   └─ <其他面板资源>
   ```

4. 使用较新版本的 Microsoft Edge、Google Chrome 或 Firefox 双击打开 `index.html`。面板不需要安装，也不需要以管理员身份运行。
5. 保持游戏运行并进入一场比赛。插件采集到比赛数据后，面板会自动连接本机的 `http://127.0.0.1:16726` 并开始更新。

### 5. 检查是否安装成功

建议按以下顺序检查：

1. 游戏可以正常启动并进入主菜单。
2. `BepInEx/LogOutput.log` 中能搜索到 `FMMatchLens` 和 `loaded`。
3. 在游戏运行时，用浏览器打开 <http://127.0.0.1:16726/api/health>：
   - 能看到一段 JSON 文本，表示插件和本地接口工作正常。
   - 显示“无法访问”或“连接被拒绝”，表示插件没有加载，或游戏已经关闭。
4. 双击面板的 `index.html`，然后进入比赛；出现双方球队和比赛数据即表示安装完成。

面板打开后暂时没有数据并不一定是故障。插件只会在支持的游戏版本中、进入实际比赛并产生比赛帧后显示实时内容。

### 6. 使用存档回放

插件会把采集到的比赛逐步保存为 `.fmlens` 文件，默认位于：

```text
<游戏根目录>/BepInEx/plugins/FMMatchLens/data/matches/
```

回放时不需要启动游戏：

1. 双击打开面板的 `index.html`。
2. 点击面板中的“打开存档”，选择一个 `.fmlens` 文件；也可以把文件直接拖到面板中。
3. 使用时间轴和播放速度控件查看比赛。

### 7. 升级或卸载

升级 FMMatchLens 时：

1. 先关闭游戏和已经打开的数据面板。
2. 下载同一新版本的插件包和面板包。
3. 把插件包重新解压到游戏根目录并允许覆盖。
4. 将面板包解压到一个新文件夹，不要把新旧版本的 `assets` 混在一起。
5. 重新启动游戏，并通过日志确认新版本已经加载。

配置和比赛存档通常会保留在原位置。版本更新说明如果要求修改配置或重新安装 BepInEx，请以对应 Release 的说明为准。

卸载时，关闭游戏后删除以下内容即可：

```text
<游戏根目录>/BepInEx/plugins/FMMatchLens/
<游戏根目录>/BepInEx/config/com.fmmatchlens.plugin.cfg
```

删除 `FMMatchLens` 文件夹也会删除其中 `data/matches/` 下的比赛存档；如需保留回放文件，请先备份。

### 常见问题

| 现象 | 优先检查 |
| --- | --- |
| 游戏能启动，但日志中完全没有 `FMMatchLens` | DLL 是否位于准确路径；BepInEx 是否为 IL2CPP x64 版本；压缩包是否已解除锁定 |
| `/api/health` 无法打开 | 游戏是否仍在运行；日志中是否出现插件加载失败或端口 `16726` 被占用 |
| 健康检查正常，但面板没有实时数据 | 是否已经进入实际比赛；FM 与 FMMatchLens 版本是否兼容；日志中是否有 Hook 相关警告 |
| 球员头像或队徽不显示 | 检查 `Graphics.GraphicsPath` 是否指向正确的图形包根目录；比赛数据本身仍可正常使用 |

## 插件配置

插件首次成功加载后会创建：

```text
<游戏根目录>/BepInEx/config/com.fmmatchlens.plugin.cfg
```

请先关闭游戏，再使用记事本或其他纯文本编辑器修改该文件。仓库同时提供了可直接参考的 [完整配置示例](config/com.fmmatchlens.plugin.cfg.example)：

```ini
[Logging]
Mode = release

[Graphics]
GraphicsPath = C:\Users\<你的用户名>\Documents\Sports Interactive\Football Manager 26\graphics

[Archive]
Compression = Fast
ChunkTicks = 2400
MaxChunkLatencyMs = 60000
QueueCapacity = 8
```

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `Logging.Mode` | `release` | `release` 仅输出关键状态、警告和错误；`debug` 额外输出 Hook 与帧诊断信息。 |
| `Graphics.GraphicsPath` | FM26 用户图形目录 | 图形包与 `config.xml` 所在的根目录，用于加载头像和队徽；不使用自定义图形包时可保持默认值。 |
| `Archive.Compression` | `Fast` | `Fast` 使用独立的 zlib 封装 Deflate 块；`None` 禁用数据块压缩。 |
| `Archive.ChunkTicks` | `2400` | 单个可独立恢复数据块的最大 Tick 数。按默认每秒约 4 个 Tick 计算，约对应比赛内 10 分钟。达到此数量或达到 `MaxChunkLatencyMs` 时，哪个条件先满足就先提交。 |
| `Archive.MaxChunkLatencyMs` | `60000` | 未达到 Tick 上限时，提交部分数据块的最大等待时间（毫秒）。默认 60 秒主要用于应对暂停或 Tick 产生异常缓慢的情况；正常比赛中通常会先达到 `ChunkTicks`。 |
| `Archive.QueueCapacity` | `8` | 后台压缩与写入队列上限；持续积压会明确停止当前存档，不会静默丢帧。 |

归档数据会先积累成数据块，再由后台线程完成编码、压缩和写盘。数据块较大时，块头等固定开销较低，通常也更有利于压缩；数据块较小时，则会更频繁地提交。当前数据块达到 `ChunkTicks`，或者等待时间达到 `MaxChunkLatencyMs`，任一条件先满足都会触发提交。这些配置不会改变数据采集频率，只会改变已经采集的数据多久写入一次存档。

按照默认值和每秒约 4 个 Tick 计算，2400 个 Tick 需要约 600 个现实秒，也就是比赛内约 10 分钟。如果游戏大约以 5 倍速度运行，同样的比赛内 10 分钟可能只经过约 2 个现实分钟。`MaxChunkLatencyMs = 60000` 并不意味着正常比赛每分钟必然写一次；只要 Tick 正常产生，通常会先达到 2400 个 Tick。60 秒主要是当比赛暂停或 Tick 频率明显降低时，对未满数据块的最长等待时间。

修改后保存文件并重新启动游戏。`GraphicsPath` 可以填写绝对路径，例如：

```ini
GraphicsPath = D:\FM Graphics
```

路径两端不需要添加引号。存档、图形索引缓存等运行数据保存在：

```text
<游戏根目录>/BepInEx/plugins/FMMatchLens/data/
```

## 开发者指南

以下内容只适用于需要修改源码、调试或自行构建 FMMatchLens 的开发者。普通用户按照上面的“快速开始”安装 Release 即可。

### 环境要求

- [.NET SDK 10](https://dotnet.microsoft.com/download)（版本由 `global.json` 管理）
- [Node.js 22 或更高版本](https://nodejs.org/) 与 npm
- 已安装 BepInEx 6 IL2CPP 的 Football Manager 2026，用于游戏内调试

### 获取源码并安装依赖

```powershell
git clone https://github.com/osnsyc/FMMatchLens.git
cd FMMatchLens
```

插件项目依赖 BepInEx 与 MonoMod 的运行时程序集。为避免在仓库中分发第三方 DLL，并确保编译时版本与实际游戏环境一致，`src/FMMatchLens.Plugin/lib/` 不受 Git 跟踪。首次构建前，请在仓库根目录打开 PowerShell，从准备运行插件的 BepInEx 安装中复制依赖。先把下面的 `$bepInExCore` 改为自己机器上的真实路径：

```powershell
$bepInExCore = "C:\Path\To\Football Manager 2026\BepInEx\core"
$pluginLib = Join-Path $PWD "src\FMMatchLens.Plugin\lib"
$pluginReferences = @(
  "BepInEx.Core.dll",
  "BepInEx.Unity.IL2CPP.dll",
  "MonoMod.Backports.dll",
  "MonoMod.RuntimeDetour.dll",
  "MonoMod.Utils.dll"
)

New-Item -ItemType Directory -Force -Path $pluginLib | Out-Null
foreach ($file in $pluginReferences) {
  $source = Join-Path $bepInExCore $file
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Missing BepInEx dependency: $source"
  }
  Copy-Item -LiteralPath $source -Destination $pluginLib -Force
}
```

脚本没有报错后，再安装前端依赖：

```powershell
cd frontend
npm ci
cd ..
```

### 启动前端开发服务器

在仓库根目录执行：

```powershell
cd frontend
npm run dev
```

Vite 会输出本地访问地址。前端会直接连接插件提供的 `127.0.0.1:16726` API，因此需要实时数据时请同时启动游戏和插件；只调试存档回放时可直接拖入 `.fmlens` 文件。

### 构建与检查

在仓库根目录执行：

```powershell
dotnet build src/FMMatchLens.Plugin/FMMatchLens.Plugin.csproj -c Release

cd frontend
npm run typecheck
npm run lint
npm run build
```

构建产物：

| 组件 | 输出目录 |
| --- | --- |
| 插件 | `src/FMMatchLens.Plugin/bin/Release/net6.0/` |
| 数据面板 | `frontend/dist/` |

### 安装本地开发版插件

完成 Release 构建后，将 DLL 复制到现有 BepInEx 安装中：

```powershell
$gameRoot = "C:\Path\To\Football Manager 2026"
$pluginRoot = Join-Path $gameRoot "BepInEx\plugins\FMMatchLens"
New-Item -ItemType Directory -Force -Path $pluginRoot
Copy-Item "src\FMMatchLens.Plugin\bin\Release\net6.0\FMMatchLens.Plugin.dll" $pluginRoot -Force
```

启动游戏后，可在 BepInEx 日志中搜索 `FMMatchLens` 确认加载状态。需要排查 Hook 或采集问题时，将 `Logging.Mode` 改为 `debug` 并重启游戏。

更多提交规范与版本维护说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 项目结构

```text
FMMatchLens/
├─ src/FMMatchLens.Plugin/   # BepInEx / IL2CPP 插件与本地 API
├─ frontend/                 # React + TypeScript + Vite 数据面板
├─ config/                   # 可公开提交的插件配置示例
├─ .github/                  # Issue、PR、CI 与 Release 自动化
├─ Directory.Build.props     # 项目版本与共享元数据
└─ global.json               # .NET SDK 版本策略
```

## 支持与反馈

| 渠道 | 适用场景 | 入口 |
| --- | --- | --- |
| 🐛 Bug 报告 | 可复现的插件、API、存档或面板问题 | [创建 Bug 报告](https://github.com/osnsyc/FMMatchLens/issues/new?template=bug-report.yml) |
| ✨ 功能建议 | 新的数据、分析视图或工程改进 | [提交功能建议](https://github.com/osnsyc/FMMatchLens/issues/new?template=feature-request.yml) |
| ✉️ 联系作者 | 不适合公开讨论的其他事项 | [osnsyc@gmail.com](mailto:osnsyc@gmail.com) |
| 🌐 作者博客 | 项目动态与其他作品 | [osnsyc.top](https://osnsyc.top/) |

提交问题前，请准备 FMMatchLens、Football Manager 与 BepInEx 的版本信息。日志中可能含有本机用户名或路径，公开上传前请先脱敏。

### 支持项目

如果 FMMatchLens 对你有帮助，可以通过以下方式支持持续开发：

<p align="center">
  <a href="https://ko-fi.com/osnsyc"><img alt="Support on Ko-fi" src="https://img.shields.io/badge/Ko--fi-Support-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white"></a>
</p>

## 免责声明

FMMatchLens 是非官方社区项目，与 Sports Interactive 或 SEGA 无隶属、授权或背书关系。Football Manager 及相关标识归其权利人所有。请自行承担使用第三方插件和读取游戏运行时数据可能带来的风险，并遵守游戏条款及当地法律。
