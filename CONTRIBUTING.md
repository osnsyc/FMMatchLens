# Contributing

Thank you for helping improve FMMatchLens. The project is still in its early stages, and game updates, memory layouts, and different installation environments may affect compatibility.

## Reporting Issues

- For feature bugs, use the Bug Report template and include the game version, plugin version, BepInEx version, and any relevant logs.
- Switch the logging mode to `debug` before reproducing the issue and include only the relevant log excerpt. Do not upload complete logs containing usernames, full local paths, or other private information.
- For game crashes or Hook compatibility issues, state whether other plugins are installed.

## Local Development

```powershell
dotnet build src/FMMatchLens.Plugin/FMMatchLens.Plugin.csproj -c Release

cd frontend
npm ci
npm run lint
npm run build
```

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
