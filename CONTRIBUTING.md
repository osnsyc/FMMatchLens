# 参与贡献

感谢你帮助改进 FMMatchLens。项目仍处于早期阶段，游戏更新、内存布局和不同安装环境都可能影响兼容性。

## 提交问题

- 功能缺陷请使用 Bug 报告模板，并附上游戏版本、插件版本、BepInEx 版本和必要日志。
- 请先将日志模式切换为 `debug`，复现问题后截取相关片段；不要上传包含用户名、完整本地路径或其他隐私信息的整份日志。
- 游戏崩溃或 Hook 兼容性问题请说明是否使用了其他插件。

## 本地开发

```powershell
dotnet build src/FMMatchLens.Plugin/FMMatchLens.Plugin.csproj -c Release

cd frontend
npm ci
npm run lint
npm run build
```

## Pull Request

1. 从 `main` 创建短生命周期分支，例如 `feat/archive-filter` 或 `fix/hook-retry`。
2. 不要提交游戏文件、个人配置、日志、存档或新的闭源二进制依赖。
3. 将元数据统一维护在 `Directory.Build.props`，不要在代码中复制项目版本、游戏版本或 API 端口；版本升级使用 `tools/Set-Version.ps1` 同步清单文件。
4. 保持改动范围聚焦，并同步更新相关文档和 `CHANGELOG.md` 的 `Unreleased` 部分。
5. 提交前确保 .NET 构建、前端 lint 和前端生产构建通过。

建议使用 Conventional Commits 风格，例如：

```text
feat: 增加存档筛选
fix: 修复比赛结束后的重复帧
docs: 完善安装说明
```

提交 Pull Request 即表示你有权提交相关内容，并同意项目在未来选定的许可证下使用该贡献；在许可证正式确定前，如对此有顾虑，请先通过 Issue 与维护者确认。
