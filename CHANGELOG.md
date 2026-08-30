# 更新日志

本项目的重要变更记录在此文件中，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 计划

- 持续验证 Football Manager 2026 更新后的内存偏移兼容性。
- 完善安装包、用户文档与自动化测试。

## [0.1.1] - 2026-08-30

### 修复

- 避免大型图像包索引期间逐条检查资源文件，并记录各索引阶段耗时，防止首次启动长时间阻塞。

## [0.1.0] - 2026-08-27

### 新增

- Football Manager 2026 比赛数据实时采集与本地 API。
- 比赛统计、xG、动量、阵型、热区、阵容与战术可视化。
- `.fmlens` 本地增量存档和浏览器回放。
- release/debug 两级插件日志模式。
- 集中式项目元数据、CI 检查和 Tag 自动发布流水线。

[Unreleased]: https://github.com/osnsyc/FMMatchLens/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/osnsyc/FMMatchLens/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/osnsyc/FMMatchLens/releases/tag/v0.1.0
