
# Changelog

This file records the project's important changes. Version numbers follow [Semantic Versioning](https://semver.org/).

## [0.7.0] - 2026-10-30

### Added

- Added timeline-aware player rating breakdowns for live matches and archive replay, including per-term contributions and data-quality indicators.
- Added a Pass Map and a dedicated Event Map, and integrated attacking-focus analysis into the Momentum card.
- Added player match-detail cards and expanded recorded player statistics, including progressive passes and sprint counts.
- Added a Sofascore-inspired light/dark theme and an animated brand logo.
- Remembered panel tabs, Tactical Board metrics and event/live mode, and Pass Map/Heatmap view and filter preferences in browser local storage.
- Added native capture support for Football Manager 27, with a verified Steam build fingerprint and an updated five-argument match-update hook.

### Changed

- Extended `.fmlens` archive format to 2.8 to preserve rating inputs, events, tactical roles, and classification durations for replay, while retaining read compatibility with earlier supported 2.x archives.
- Reorganized the squad statistics drawer and player match-detail layouts, standardized English text, and extracted Chinese nationality names into shared data.
- Reduced native capture overhead by reusing validated memory regions within each completed update, sharing snapshots and momentum reads, and caching player identities with bounded lifetimes.
- Switched the native capture target from FM26 to FM27, updating match, ball, team, manager, player-stat, tactical assignment, and rating input layouts. FM26 users should keep the 0.6.x plugin; existing compatible FM26 archives remain available for replay.
- Retained a default FM27 hook RVA for unrecognized builds, logging the fallback before attempting installation. Other platforms with the same native layout can use this path, but are not independently verified.
- Kept `.fmlens` archive format 2.8 and read compatibility with formats 2.1–2.8; this adaptation does not introduce another archive format change.

### Fixed

- Restored player rating breakdowns and sprint counts during archive replay.
- Serialized momentum capture state to keep concurrent native callbacks consistent.
- Updated match-instance pairing to the observed FM27 720-tick simulation lead, fixing capture remaining in the waiting state after successful hook installation.
- Used the native matchday squad count instead of the full player-table count, excluding non-selected players with aliased or missing match statistics and keeping frame, metadata, and event slots aligned.
- Corrected player-stat tail offsets and their validated read range, rating-event and category-history vectors, internal rating inputs, and team header fields.
- Matched rating-duration filtering to FM27's native category mask lookup and validated momentum trajectory vector ordering, alignment, size, and readability before retaining points.

## [0.6.0] - 2026-10-15

### Added

- Added experimental Tactical Board live animation with interpolated player and ball movement, direction arrows, and connection and buffering status.
- Added Tactical Board archive animation synchronized with the replay timeline, including playback speed changes, pause, and seeking.
- Added an experimental Pitch Control overlay for live and archive animation, using velocity-aware Gaussian influence fields, smooth team-color shading, and equal-control contours.
- Added animated dribble and shot-chain playback with player and ball tracking, tactical overlays, and Explore Tour guidance for shot-chain playback.
- Added pre-match player status, morale, season statistics, and switching between match and season statistics in the player-data table.
- Added authoritative match shirt names and numbers, team shirt and goalkeeper colors, and goal outlines on the pitch.
- Added Epic game build detection and a fallback hook offset for unrecognized builds.

### Changed

- Extended `.fmlens` archive format to 2.7 with pre-match sharpness, season statistics, match shirt identity, team shirt colors, per-tick player speed and direction, and football XYZ coordinates; retained read compatibility with released formats 2.1–2.6.
- Reduced archive frame size with signed centimeter player positions, integer-meter cumulative distance deltas, optional speed and cyclic angle deltas, and per-axis football change flags.
- Separated tactical playback builders, shared motion projection, rendering, and overlay components, with a shared demand-driven animation scheduler and bounded frame caches.
- Brightened the Opta-inspired dark theme and refined Momentum and xG timeline presentation.

### Fixed

- Corrected native ball-position offsets, per-tick player movement coordinates, and pre-match player-status offsets.
- Corrected legacy archive decoding so running-distance fields do not misalign condition, sharpness, and goalkeeper statistics.
- Preserved unclipped physical positions for Pitch Control calculations and corrected saddle contour topology when switching team labels.
- Fixed Tactical Board initialization on local `file://` pages by embedding the football SVG texture instead of fetching a local file.

## [0.5.0] - 2026-09-30

### Added

- Added an interactive, bilingual Explore Tour covering timeline navigation, player comparison, formations, heatmaps, Tactical Board analysis, archives, appearance settings, and immersive mode.
- Added dedicated focus layouts for Match Statistics, Formation, and Heatmap, animated dashboard layout transitions, and a unified scoreboard toolbar for fullscreen, immersive mode, feature discovery, and keyboard shortcuts.
- Added pinnable player profiles and a side-by-side comparison view with position-aware opponent suggestions, aligned attributes, foot ability, and localized player traits.
- Added an xG Map with pitch-positioned shots and shared live and replay derivation, plus first- and second-half shot totals in Match Statistics.
- Added team and individual-player event filters, clearer Tactical Board event markers, animated marker reveals, refined hover details, and grouped map legends.
- Added native semantics for passes, crosses, saves, fouls, key tackles, penalties, own goals, and cards, including yellow- and red-card presentation on the timeline and in squad status.
- Added competition metadata, goalkeeper saves held, parried, and tipped, 64-bit player traits, and half-specific team shots to `.fmlens` archive format 2.6 while retaining read compatibility with earlier 2.x archives.
- Added a persisted, configurable backend address so the dashboard can connect to FMMatchLens from another device on the local network, allowing laptops, tablets, and secondary computers to serve as dedicated analysis displays.
- Added support for newgen portraits referenced by facepacks through `graphics/pictures/person/r-{UID}/portrait` resource paths.

### Changed

- Improved heatmap detail and performance with a higher-resolution density field, bilinear sample placement, percentile-based scaling, configurable gamma and LUT thresholds, theme-aware low-density colors, and fewer recent-window allocations.
- Reconciled Momentum events by logical sequence identity and revision so memory relocation does not create duplicates while semantic, flag, and trajectory updates remain visible.
- Built match rosters from each team's own player table, preserving stable home/away ordering and aligning player identity resolution with Momentum events.
- Refreshed tactical player metadata throughout a match so formation history and archive deltas capture position and role changes even when the on-pitch roster is unchanged.
- Expanded archive and timeline presentation with competition identity, logos, and colors, and refined squad attribute, foot, radar, and comparison styling.
- Centralized dashboard shortcuts for panel focus, replay playback and seeking, fullscreen, immersive mode, and dismissing temporary views.

### Fixed

- Prevented hosted dashboard modules from contacting a local or configured backend until the user explicitly enables the live connection.
- Prevented logical Momentum events from disappearing or being duplicated when their temporary event index changes, including relocation, backfill, collision, and tail-revision cases.
- Improved match-roster reliability by no longer depending on the combined match player table for team membership.
- Supported minified three- and four-digit hexadecimal theme colors in heatmap rendering.
- Kept tactical assignment changes in formation history and archive metadata when no substitution occurs.

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

[Unreleased]: https://github.com/osnsyc/FMMatchLens/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/osnsyc/FMMatchLens/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/osnsyc/FMMatchLens/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/osnsyc/FMMatchLens/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/osnsyc/FMMatchLens/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/osnsyc/FMMatchLens/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/osnsyc/FMMatchLens/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/osnsyc/FMMatchLens/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/osnsyc/FMMatchLens/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/osnsyc/FMMatchLens/releases/tag/v0.1.0
