
# Changelog

This file records the project's important changes. Version numbers follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `.fmlens` archives now use 16-bit coordinate quantization, per-frame delta encoding, independent zlib/Deflate + CRC data blocks, a final index, and valid-prefix recovery after abnormal termination.
- The backend only decompresses data blocks within the requested Tick range, and browsers can open local archives directly.
- Added configuration for compression, block size, maximum block delay, and a bounded background queue.
- Metadata uses an initial complete player static snapshot followed by Formation deltas. Static data such as attributes, height, and salary is stored only once for existing players; subsequent records contain only tactical changes and new players.

### Planned

- Continue validating memory-offset compatibility after Football Manager 2026 updates.
- Improve the installer, user documentation, and automated tests.

## [0.1.1] - 2026-08-30

### Fixed

- Avoid checking resource files one by one while indexing large image packages and record the duration of each indexing stage to prevent long startup stalls.

## [0.1.0] - 2026-08-27

### Added

- Real-time collection of Football Manager 2026 match data and a local API.
- Visualization of match statistics, xG, momentum, formations, heatmaps, lineups, and tactics.
- Local incremental `.fmlens` archives and browser replay.
- Two plugin logging modes: release and debug.
- Centralized project metadata, CI checks, and an automated tag-based release pipeline.

[Unreleased]: https://github.com/osnsyc/FMMatchLens/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/osnsyc/FMMatchLens/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/osnsyc/FMMatchLens/releases/tag/v0.1.0
