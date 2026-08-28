$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$propsPath = Join-Path $repositoryRoot "Directory.Build.props"
[xml]$props = Get-Content -LiteralPath $propsPath -Raw -Encoding UTF8

$buildVersion = [string]$props.Project.PropertyGroup.BepInExBuildVersion
$downloadUrl = [string]$props.Project.PropertyGroup.BepInExBuildUrl
$expectedHash = [string]$props.Project.PropertyGroup.BepInExBuildSha256

if ([string]::IsNullOrWhiteSpace($buildVersion) -or
    [string]::IsNullOrWhiteSpace($downloadUrl) -or
    [string]::IsNullOrWhiteSpace($expectedHash)) {
  throw "Directory.Build.props does not contain complete BepInEx build metadata."
}

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "fmmatchlens-bepinex-$([guid]::NewGuid().ToString('N'))"
$archivePath = Join-Path $temporaryRoot "bepinex.zip"
$extractPath = Join-Path $temporaryRoot "extracted"
$pluginLib = Join-Path $repositoryRoot "src/FMMatchLens.Plugin/lib"

try {
  New-Item -ItemType Directory -Force -Path $temporaryRoot, $extractPath, $pluginLib | Out-Null

  Write-Host "Downloading BepInEx $buildVersion"
  Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath

  $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
  if ($actualHash -ne $expectedHash) {
    throw "BepInEx archive hash mismatch: expected $expectedHash, got $actualHash"
  }

  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath
  $bepInExCore = Join-Path $extractPath "BepInEx/core"
  $dependencies = @(
    "BepInEx.Core.dll",
    "BepInEx.Unity.IL2CPP.dll",
    "MonoMod.RuntimeDetour.dll",
    "MonoMod.Utils.dll"
  )

  foreach ($dependency in $dependencies) {
    $source = Join-Path $bepInExCore $dependency
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
      throw "BepInEx build $buildVersion does not contain $dependency"
    }
    Copy-Item -LiteralPath $source -Destination $pluginLib -Force
  }

  Write-Host "Prepared $($dependencies.Count) plugin compile-time dependencies."
}
finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
