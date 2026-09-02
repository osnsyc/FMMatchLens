
# Changelog

This file records the project's important changes. Version numbers follow [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-09-02

### Added

- `.fmlens` archives now use 16-bit coordinate quantization, per-frame delta encoding, independent zlib/Deflate + CRC data blocks, a final index, and valid-prefix recovery after abnormal termination.
- The backend only decompresses data blocks within the requested Tick range, and browsers can open local archives directly.
- Added configuration for compression, block size, maximum block delay, and a bounded background queue.
- Metadata uses an initial complete player static snapshot followed by Formation deltas. Static data such as attributes, height, and salary is stored only once for existing players; subsequent records contain only tactical changes and new players.
- Added live and replay formation history for in-possession and out-of-possession shapes, with an animated timeline and a pinnable comparison starting point.
- Added localized in-possession and out-of-possession role details, player positional familiarity, and formation hover cards.
- Added overall physical condition and match sharpness to player profiles.
- Added an optional attacking-focus overlay to the tactical map, showing each team's left, central, and right attacking shares.
- Added penalty and own-goal statistics and timeline events.
- Added an MIT license.

### Changed

- Improved the squad panel with clearer tactical roles, familiar positions, status indicators, and substitute icons.
- Improved stoppage-time clocks and aligned live and replay events to elapsed match ticks.
- Redesigned the match timeline with a half-time marker, deduplicated and collision-aware events, clearer tooltips and source controls, and working 32x and 64x replay speeds.

### Fixed

- Corrected the player-stat offsets previously interpreted as yellow and red cards; they now expose penalties and own goals.

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

[Unreleased]: https://github.com/osnsyc/FMMatchLens/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/osnsyc/FMMatchLens/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/osnsyc/FMMatchLens/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/osnsyc/FMMatchLens/releases/tag/v0.1.0
