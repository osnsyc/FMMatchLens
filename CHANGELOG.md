
# Changelog

This file records the project's important changes. Version numbers follow [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-09-18

### Added

- Added a persisted appearance system with FMMatchLens, Opta-inspired, and Wyscout-inspired presets, system/light/dark scheme preferences, colorblind-friendly visualization encodings, and a high-contrast mode.
- Added a paginated match-archive browser with separate live, local-file, and server sources; richer date, score, completion, manager-control, and player-result summaries; refresh controls; and drag-and-drop loading.
- Added a Cloudflare Pages build and online demo mode with a hosted sample archive, code-split assets, cache headers, and an explicit opt-in before attempting a local live connection.
- Added Steam and Xbox Game Pass `game_plugin.dll` build detection by SHA-256 so the plugin can select the correct match-hook address and report unsupported builds safely.
- Added venue pitch dimensions to the realtime API and `.fmlens` archive format 2.5 while retaining read compatibility with earlier 2.x archives.

### Changed

- Unified formation, heatmap, and Tactical Board pitch geometry, including regulation markings, venue-aware proportions, outer gutters, and rendering for events beyond the touchlines.
- Improved responsive panel headers and standardized pitch player badges, shirt numbers, status markers, and theme-aware number colors.
- Cached archive summaries and paginated `/api/archives` responses to keep large archive libraries responsive.
- Embedded the confirmed FM26 Momentum weighting table, removing its dependency on a version-specific in-memory global address.
- Updated frontend runtime and development dependencies.

### Fixed

- Preserved every recording when a new or completed archive would otherwise reuse an existing filename by assigning a unique suffixed path.
- Corrected penalty-area arcs, goal areas, corner arcs, pitch orientation, and Tactical Board edge clipping.
- Corrected project URL resolution in frontend builds and restricted archived remote image loading to the trusted demo asset host.

## [0.3.0] - 2026-09-11

### Added

- Expanded player profiles with birth date and age, localized nationality and flag, body type, guide value, and senior or youth international records. These fields are available in the realtime API and archive format 2.4, with read compatibility retained for older 2.x archives.
- Added a Tactical Board focus mode, toggled with the `T` shortcut, that uses the full central dashboard while preserving the board's filters, display settings, selection, and resolution-aware rendering.
- Added replay regression tests and benchmarks for forward playback, backward seeking, buffer rotation, snapshot reuse, and dashboard-facing invalidations.

### Changed

- Replaced the Tactical Board's per-event DOM rendering with a persistent, demand-rendered PixiJS scene that incrementally updates markers, shirt numbers, trajectories, shot chains, selection, and spatial hit testing.
- Rebuilt archive replay around preprocessed frame revisions, indexed tick lookup, bounded checkpoints, incremental history derivation, and animation-frame-throttled seeking to keep large archives responsive.
- Reduced dashboard rerenders by structurally reusing unchanged match snapshots and arrays, memoizing panels with data-specific equality checks, and tracking heatmap revisions explicitly.

### Fixed

- Made assist icons inherit the active theme color without CSS masks, preventing `file://` CORS errors in the standalone dashboard.

## [0.2.2] - 2026-09-10

### Added

- Added team-manager metadata, including manager UID, name, and human-control status, to the realtime API, score-header details, and archive format 2.3 while retaining compatibility with older 2.x archives.
- Added adaptive home and away team-color selection from club logo's background, foreground, and outline colors, with duplicate removal, OKLab color-distance filtering, and separate light- and dark-theme combinations.

### Changed

- Reworked match-instance discovery to require complete manager classification before candidate pairing and to support both human-vs-AI and human-vs-human matches.
- Switched player and event identity to the unique `Person.Uid`, with slot-based fallback identities when a UID cannot be read and compatibility handling for legacy archive references.
- Centralized repeated frontend colors in the theme palette and aligned formations, heatmaps, charts, timelines, squad panels, tactical markers, menus, and controls across light and dark themes.

### Fixed

- Preserved pre-lock match frames across pauses and transient memory-read failures so the opening phase is restored once the correct match instance is locked.
- Prevented duplicate non-unique legacy player-stat IDs from corrupting metadata dictionaries or linking events to the wrong player.

## [0.2.1] - 2026-09-08

### Added

- Added native momentum event trajectories, event-chain selection, and shot buildup visualization on the tactical board.
- Extended archive format 2.2 with momentum sequence, completion, and trajectory data while retaining read compatibility with 2.1 archives.
- Added match-date metadata parsed from the home team's schedule. Completed archive filenames and the archive list now include the match date and final score.
- Added Full/Half/Recent 15, Home/Away, and All/In Possession/Out of Possession heatmap controls with right-click state selection.
- Added individually normalized player heatmaps selected directly from player markers, with independent selection memory for the home and away teams.

### Changed

- Replaced `heatmap.js` with a persistent, demand-rendered PixiJS WebGL heatmap using float density textures, Gaussian blur, and LUT color mapping.
- Made heatmap derivation incremental and allocation-stable for live matches and replay, while keeping comparable home and away team views on a shared color scale.
- Improved momentum chart fills and goal markers, and replaced xG timeline goal tooltips with hover cards.
- Updated the frontend's single-file IIFE build configuration for direct `file://` deployment.

### Fixed

- Preserved replay state when loading local match archives.
- Normalized match-stat comparison bar widths so home and away values remain visually comparable.

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

[Unreleased]: https://github.com/osnsyc/FMMatchLens/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/osnsyc/FMMatchLens/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/osnsyc/FMMatchLens/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/osnsyc/FMMatchLens/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/osnsyc/FMMatchLens/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/osnsyc/FMMatchLens/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/osnsyc/FMMatchLens/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/osnsyc/FMMatchLens/releases/tag/v0.1.0
