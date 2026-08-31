<p align="center">
  <img src="frontend/public/icon.svg" alt="FMMatchLens icon" width="112" height="112">
</p>

<h1 align="center">FMMatchLens</h1>

<p align="center">
  <strong>English</strong> | <a href="README.zh-cn.md">简体中文</a>
</p>

<p align="center">
  Local match data collection, archiving, and visual analytics for Football Manager
</p>

<p align="center">
  <a href="https://github.com/osnsyc/FMMatchLens/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/osnsyc/FMMatchLens/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/osnsyc/FMMatchLens/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/osnsyc/FMMatchLens?display_name=tag&color=7c3aed"></a>
  <a href="https://www.footballmanager.com/"><img alt="Football Manager 26.x" src="https://img.shields.io/badge/Football%20Manager-26.x-7c3aed"></a>
  <img alt="Windows platform" src="https://img.shields.io/badge/platform-Windows-2563eb">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#plugin-configuration">Plugin Configuration</a> ·
  <a href="#developer-guide">Developer Guide</a> ·
  <a href="#support-and-feedback">Support and Feedback</a>
</p>

---

FMMatchLens reads Football Manager match data at runtime, exposes local HTTP and WebSocket endpoints, and presents live match information in a browser dashboard. Data stays on your computer by default and can also be saved as `.fmlens` archives for offline replay.

## Key features

- **Live data collection**: automatically detects match state and delivers low-latency updates over a local WebSocket connection.
- **Multidimensional analysis**: match timeline, momentum, xG, formations, events, and player position heatmaps.
- **Complete squad information**: lineups, roles and duties, key attributes, player portraits, and club badges.
- **Incremental archives**: continuously writes `.fmlens` files and preserves as many complete records as possible after an abnormal exit.
- **Offline replay**: select or drag in a local archive to review a match without starting the game.
- **Local-first design**: the API listens only on `127.0.0.1:16726` by default, so match data does not need to be uploaded to a third party.
- **FM-inspired interface**: follows the Football Manager brand style, includes light and dark themes, and supports English and Simplified Chinese.

## Quick start

This section is for users installing a published release. You do not need the source code, .NET, Node.js, or npm.

### 1. Before installation

Confirm that your environment meets these requirements:

- **Windows 10/11 x64**.
- **Football Manager 2026 26.3**. Other game versions may not work because their internal structures can differ.
- **BepInEx 6 IL2CPP x64** is installed in the game. If it is not installed yet, follow the next section first.

Each FMMatchLens release provides two archives for different purposes:

| File | Purpose | Installation location |
| --- | --- | --- |
| `FMMatchLens-plugin-v<version>.zip` | Collects game data and starts the local API | Extract into the Football Manager 2026 game root |
| `FMMatchLens-dashboard-v<version>.zip` | Displays live matches or archive replays | Extract into any normal folder |

Download both files from the same version on the [Releases](https://github.com/osnsyc/FMMatchLens/releases) page. Do not download `Source code (zip)` or `Source code (tar.gz)`; those archives contain source code for developers and cannot be installed directly.

### 2. Install BepInEx 6

Skip this section if the game directory already contains a working `BepInEx` installation.

1. Read the [official BepInEx IL2CPP installation guide](https://docs.bepinex.dev/master/articles/user_guide/installation/unity_il2cpp.html), then download a BepInEx 6 archive whose name contains `Unity.IL2CPP-win-x64` from [BepInEx Bleeding Edge Builds](https://builds.bepinex.dev/projects/bepinex_be). Do not download a `Unity.Mono`, `win-x86`, or non-Windows build. If an FMMatchLens release specifies a BepInEx version, follow the release notes.
2. Locate the Football Manager 2026 game root:
   - Steam: right-click Football Manager 2026 in your library, then select **Manage → Browse local files**.
   - Other platforms: use the platform's installation location or browse-files function.
3. Extract every file from the BepInEx archive into this directory. The game root is the directory containing the game executable, not the save directory under Documents.
4. Start the game once, wait until the main menu appears, and exit. The first BepInEx launch may take longer while it generates runtime files.
5. Return to the game root and confirm that `BepInEx/core/` and `BepInEx/LogOutput.log` were created.

The installed directory should look similar to this:

```text
Football Manager 2026/
├─ BepInEx/
│  ├─ core/
│  ├─ plugins/
│  └─ LogOutput.log
├─ doorstop_config.ini
├─ winhttp.dll
└─ <game executable and other files>
```

If these files do not appear after starting the game, BepInEx has not loaded successfully. Fix the BepInEx installation before installing FMMatchLens.

### 3. Install the FMMatchLens plugin

1. Open [Releases](https://github.com/osnsyc/FMMatchLens/releases) and download the latest compatible `FMMatchLens-plugin-v<version>.zip`.
2. If the archive's Windows Properties dialog includes an **Unblock** option, enable it before extraction so Windows does not prevent the DLL from loading.
3. Extract the archive **directly into the Football Manager 2026 game root**. Allow Windows to merge the `BepInEx` directory and overwrite existing FMMatchLens files when upgrading.
4. Confirm that this file exists:

   ```text
   <game root>/BepInEx/plugins/FMMatchLens/FMMatchLens.Plugin.dll
   ```

   The relevant directory structure should be:

   ```text
   Football Manager 2026/
   └─ BepInEx/
      ├─ config/
      │  └─ com.fmmatchlens.plugin.cfg.example
      └─ plugins/
         └─ FMMatchLens/
            └─ FMMatchLens.Plugin.dll
   ```

5. Start the game and wait for the main menu.
6. After the plugin loads successfully for the first time, it creates the active configuration file:

   ```text
   <game root>/BepInEx/config/com.fmmatchlens.plugin.cfg
   ```

### 4. Download and open the dashboard

1. Download `FMMatchLens-dashboard-v<version>.zip` from the same release.
2. Create a folder on your desktop, in Downloads, or elsewhere—for example, `FMMatchLens Dashboard`.
3. Extract the entire dashboard archive into that folder. The resulting files should include:

   ```text
   FMMatchLens Dashboard/
   ├─ index.html
   ├─ assets/
   ├─ icon.svg
   └─ <other dashboard assets>
   ```

4. Double-click `index.html` and open it with a recent version of Microsoft Edge, Google Chrome, or Firefox. The dashboard requires no installation or administrator privileges.
5. Keep the game running and enter a match. Once the plugin starts collecting data, the dashboard automatically connects to `http://127.0.0.1:16726` and begins updating.

### 5. Verify the installation

Check the installation in this order:

1. The game starts normally and reaches the main menu.
2. `BepInEx/LogOutput.log` contains both `FMMatchLens` and `loaded`.
3. While the game is running, open <http://127.0.0.1:16726/api/health> in a browser:
   - JSON output means that the plugin and local API are running.
   - A connection refused or unavailable message means the plugin did not load or the game is no longer running.
4. Double-click the dashboard's `index.html`, then enter a match. Installation is complete when both teams and live match data appear.

An empty dashboard immediately after opening is not necessarily an error. Live information appears only after a supported game version enters an actual match and produces match frames.

### 6. Replay an archive

The plugin incrementally saves collected matches as `.fmlens` files under:

```text
<game root>/BepInEx/plugins/FMMatchLens/data/matches/
```

The game does not need to be running for replay:

1. Double-click the dashboard's `index.html`.
2. Select **Open Archive** and choose a `.fmlens` file, or drag the file directly into the dashboard.
3. Use the timeline and playback-speed controls to review the match.

### 7. Upgrade or uninstall

To upgrade FMMatchLens:

1. Close the game and all open dashboard windows.
2. Download the plugin and dashboard archives from the same newer release.
3. Extract the plugin archive into the game root and allow existing files to be overwritten.
4. Extract the dashboard archive into a new folder. Do not mix `assets` from different versions.
5. Restart the game and confirm the new version in the log.

Configuration and match archives normally remain in place. If the release notes require a configuration change or BepInEx reinstall, follow the instructions for that release.

To uninstall, close the game and remove:

```text
<game root>/BepInEx/plugins/FMMatchLens/
<game root>/BepInEx/config/com.fmmatchlens.plugin.cfg
```

Removing the `FMMatchLens` directory also removes match archives under `data/matches/`. Back up any replay files you want to keep first.

### Troubleshooting

| Symptom | Check first |
| --- | --- |
| The game starts, but `FMMatchLens` never appears in the log | Confirm the exact DLL path, verify that BepInEx is the IL2CPP x64 build, and unblock the downloaded archive |
| `/api/health` is unavailable | Confirm the game is still running; check the log for plugin load errors or another process using port `16726` |
| Health check works, but no live data appears | Enter an actual match; verify FM and FMMatchLens version compatibility; check the log for Hook warnings |
| Player portraits or club badges do not appear | Confirm that `Graphics.GraphicsPath` points to the graphics-pack root; match data remains usable without custom graphics |

## Plugin configuration

After its first successful load, the plugin creates:

```text
<game root>/BepInEx/config/com.fmmatchlens.plugin.cfg
```

Close the game before editing this file with Notepad or another plain-text editor. The repository also includes a [complete configuration example](config/com.fmmatchlens.plugin.cfg.example):

```ini
[Logging]
Mode = release

[Graphics]
GraphicsPath = C:\Users\<your-username>\Documents\Sports Interactive\Football Manager 26\graphics

[Archive]
Compression = Fast
ChunkTicks = 2400
MaxChunkLatencyMs = 60000
QueueCapacity = 8
```

| Setting | Default | Description |
| --- | --- | --- |
| `Logging.Mode` | `release` | `release` writes only key status messages, warnings, and errors; `debug` also writes Hook and frame diagnostics. |
| `Graphics.GraphicsPath` | FM26 user graphics directory | Root directory containing graphics packs and `config.xml` files, used to load portraits and badges. Leave the default when no custom graphics packs are used. |
| `Archive.Compression` | `Fast` | `Fast` uses independent zlib-wrapped Deflate chunks; `None` disables chunk compression. |
| `Archive.ChunkTicks` | `2400` | Maximum captured ticks in one independently recoverable chunk. With the default capture rate of about 4 ticks per second, this is roughly 10 in-game minutes. The chunk is submitted when this limit or `MaxChunkLatencyMs` is reached, whichever comes first. |
| `Archive.MaxChunkLatencyMs` | `60000` | Maximum delay in milliseconds before submitting a partial chunk. The default 60 seconds is mainly a fallback for pauses or unusually slow tick production; during a normal match, `ChunkTicks` usually triggers first. |
| `Archive.QueueCapacity` | `8` | Bounded background compression/write queue. Sustained overflow stops the current archive explicitly instead of silently dropping frames. |

Archive data is collected into chunks before it is encoded, compressed, and written by a background worker. Larger chunks reduce per-chunk overhead and usually improve compression, while smaller chunks are submitted more frequently. A chunk is sealed as soon as it reaches `ChunkTicks` or the latency limit expires. These settings do not change the capture rate; they only change how often accumulated data is flushed to the archive.

With the default values and approximately 4 captured ticks per second, 2,400 ticks takes about 600 real seconds, or 10 in-game minutes at normal game speed. If the game is running at roughly 5x speed, the same in-game interval may pass in about 2 real minutes. `MaxChunkLatencyMs = 60000` does not force a write every minute when ticks are arriving normally; it only submits a partially filled chunk after 60 seconds when the tick limit has not been reached.

Save the file and restart the game after making changes. `GraphicsPath` can be an absolute path, for example:

```ini
GraphicsPath = D:\FM Graphics
```

Do not place quotation marks around the path. Match archives, the graphics index cache, and other runtime data are stored under:

```text
<game root>/BepInEx/plugins/FMMatchLens/data/
```

## Developer guide

This section is for contributors who want to modify, debug, or build FMMatchLens. Users installing a release should follow the Quick Start instructions above.

### Requirements

- [.NET SDK 10](https://dotnet.microsoft.com/download), with the version policy defined by `global.json`
- [Node.js 22 or newer](https://nodejs.org/) and npm
- Football Manager 2026 with BepInEx 6 IL2CPP installed for in-game debugging

### Clone the repository and install dependencies

```powershell
git clone https://github.com/osnsyc/FMMatchLens.git
cd FMMatchLens
```

The plugin project depends on BepInEx and MonoMod runtime assemblies. To avoid redistributing third-party DLLs in this repository and to keep compile-time dependencies aligned with the target game environment, Git does not track `src/FMMatchLens.Plugin/lib/`. Before the first build, open PowerShell at the repository root and copy the dependencies from the BepInEx installation where the plugin will run. Replace `$bepInExCore` below with the actual path on your computer:

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

After the script finishes without errors, install the frontend dependencies:

```powershell
cd frontend
npm ci
cd ..
```

### Start the frontend development server

Run from the repository root:

```powershell
cd frontend
npm run dev
```

Vite prints the local URL. The frontend connects directly to the plugin API at `127.0.0.1:16726`; start both the game and plugin when live data is required. Archive replay can be developed independently by dragging a `.fmlens` file into the dashboard.

### Build and validate

Run from the repository root:

```powershell
dotnet build src/FMMatchLens.Plugin/FMMatchLens.Plugin.csproj -c Release

cd frontend
npm run typecheck
npm run lint
npm run build
```

Build outputs:

| Component | Output directory |
| --- | --- |
| Plugin | `src/FMMatchLens.Plugin/bin/Release/net6.0/` |
| Dashboard | `frontend/dist/` |

### Install a local development build

After completing a Release build, copy the plugin DLL into the existing BepInEx installation:

```powershell
$gameRoot = "C:\Path\To\Football Manager 2026"
$pluginRoot = Join-Path $gameRoot "BepInEx\plugins\FMMatchLens"
New-Item -ItemType Directory -Force -Path $pluginRoot
Copy-Item "src\FMMatchLens.Plugin\bin\Release\net6.0\FMMatchLens.Plugin.dll" $pluginRoot -Force
```

Start the game and search the BepInEx log for `FMMatchLens` to confirm that it loaded. Set `Logging.Mode` to `debug` and restart the game when investigating Hook or data collection problems.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution and version-maintenance guidelines.

## Project structure

```text
FMMatchLens/
├─ src/FMMatchLens.Plugin/   # BepInEx / IL2CPP plugin and local API
├─ frontend/                 # React + TypeScript + Vite dashboard
├─ config/                   # Safe-to-commit plugin configuration example
├─ .github/                  # Issue templates, PR template, CI, and release automation
├─ Directory.Build.props     # Project version and shared metadata
└─ global.json               # .NET SDK version policy
```

## Support and feedback

| Channel | Use case | Link |
| --- | --- | --- |
| 🐛 Bug report | Reproducible plugin, API, archive, or dashboard problems | [Create a bug report](https://github.com/osnsyc/FMMatchLens/issues/new?template=bug-report.yml) |
| ✨ Feature request | New collected data, analysis views, or engineering improvements | [Submit a feature request](https://github.com/osnsyc/FMMatchLens/issues/new?template=feature-request.yml) |
| ✉️ Contact the author | Other matters that should not be discussed publicly | [osnsyc@gmail.com](mailto:osnsyc@gmail.com) |
| 🌐 Author's blog | Project updates and other work | [osnsyc.top](https://osnsyc.top/) |

Before opening an issue, prepare the FMMatchLens, Football Manager, and BepInEx versions. Logs may contain local usernames or paths; remove personal information before uploading them publicly.

### Support the project

If FMMatchLens is useful to you, you can support its continued development here:

<p align="center">
  <a href="https://ko-fi.com/osnsyc"><img alt="Support on Ko-fi" src="https://img.shields.io/badge/Ko--fi-Support-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white"></a>
</p>

## Disclaimer

FMMatchLens is an unofficial community project and is not affiliated with, authorized by, or endorsed by Sports Interactive or SEGA. Football Manager and related marks belong to their respective owners. You are responsible for the risks associated with using third-party plugins and reading game runtime data, and for complying with the game's terms and applicable local laws.
