# Contributing

Thank you for helping improve FMMatchLens. The project is still in its early stages, and game updates, memory layouts, and different installation environments may affect compatibility.

## Reporting Issues

- For feature bugs, use the Bug Report template and include the game version, plugin version, BepInEx version, and any relevant logs.
- Switch the logging mode to `debug` before reproducing the issue and include only the relevant log excerpt. Do not upload complete logs containing usernames, full local paths, or other private information.
- For game crashes or Hook compatibility issues, state whether other plugins are installed.

## Local Development

```powershell
dotnet build src/FMMatchLens.Plugin/FMMatchLens.Plugin.csproj -c Release -p:FMInteropDir="C:/FM27/BepInEx/interop"
dotnet test tests/FMMatchLens.Sdk.Tests -c Release

cd frontend
npm ci
npm run lint
npm run build
```

The Data SDK targets verified FM27 builds. See [SDK development](README.md#data-sdk-fm27)
and the validation steps below. Without game interop references,
use `-p:EnableUnityIntegration=false` for a capture-only compile; that output has no SDK
provider and cannot be formally released as a validated SDK. Packaging requires Python 3.

## SDK validation and packaging

Build the host and the independent consumer against FM27's generated interop assemblies:

```powershell
./.github/scripts/prepare-plugin-dependencies.ps1
dotnet build src/FMMatchLens.Plugin -c Release -p:FMInteropDir="C:/FM27/BepInEx/interop"
dotnet build examples/MinimalUnityHud -c Release -p:FMInteropDir="C:/FM27/BepInEx/interop"
dotnet test tests/FMMatchLens.Sdk.Tests -c Release
python -m unittest discover -s tests/packaging -v
python scripts/create-windows-validation.py
```

The last command creates a pending record under ignored `dev/`, with the current commit, versions,
exact binary hashes, required checks and empty performance measurements. Use a clean committed
checkout and do not rebuild the tested binaries afterward. No files under local `docs/` are required
by these scripts or included in SDK bundles.

In the game, verify one shared Contracts assembly and two independently built consumers with different
GUIDs, callbacks on Unity Update, pause/resume, match end, menu/next match, disable/reload, operation
without a Web client, callback exception isolation, finite slow-callback disablement, bounded burst
queues, Web/archive regression and no additional native Hook. Compare SDK disabled/enabled with zero
and 1/5/20 consumers in the same scene. Record dispatch p50/p95/p99, queue peak/drops and baseline/SDK
frame-time p95. Never use an infinite blocking callback for validation.

Complete every generated check only after observing it. Set `gameFingerprint` to a verified capture
catalog hash, `testedAtUtc` to the UTC test time and `status` to `passed`. Formal packaging verifies
these values, the source commit, versions and all three binary hashes. Public CI builds capture-only
previews and cannot establish Unity/game acceptance.

```powershell
# Preview; build the frontend first.
python scripts/package-release.py
# Formal packaging after completing the Windows validation record.
python scripts/package-release.py --validation dev/windows-validation.json
# Publish only when explicitly intended and the matching version tag already exists.
python scripts/package-release.py --validation dev/windows-validation.json --publish
```

Inspect the plugin/dashboard/SDK ZIPs and checksum file before publishing. The developer SDK contains
one Contracts reference plus HUD source and build instructions; it contains no game/BepInEx/Unity DLLs.
Opt-in managed benchmarks (`SDK_BENCHMARK=1` when running SDK tests) write to
`artifacts/sdk/module-benchmarks.json` and do not establish in-game performance.

## Pull Requests

1. Create a short-lived branch from `main`, such as `feat/archive-filter` or `fix/hook-retry`.
2. Do not commit game files, personal configuration, logs, save files, or new closed-source binary dependencies.
3. Maintain project metadata centrally in `Directory.Build.props`. Do not duplicate the project version, game version, or API port in code; use `tools/Set-Version.ps1` to update manifest files when bumping versions.
4. Keep changes focused and update related documentation and the `Unreleased` section of `CHANGELOG.md`.
5. Before submitting, make sure the .NET build, frontend lint, and frontend production build pass.

Conventional Commits are recommended, for example:

```text
feat: add archive filtering
fix: prevent duplicate frames after a match ends
docs: improve installation instructions
```

Submitting a Pull Request means that you have the right to submit the relevant content and agree that the project may use this contribution under a license selected in the future. Before a license is formally established, please contact the maintainers through an Issue if you have any concerns.
