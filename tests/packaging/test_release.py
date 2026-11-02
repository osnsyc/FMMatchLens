import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("package_release", ROOT / "scripts/package-release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseGateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.paths = {name: self.root / (name + ".dll") for name in ("plugin", "contracts", "hud")}
        for name, path in self.paths.items():
            path.write_bytes(name.encode())
        self.props = {"GameVersion": "27.0", "BepInExBuildVersion": "pinned"}
        self.record = {
            "status": "passed", "sourceCommit": "commit", "testedAtUtc": "2026-11-01T00:00:00Z",
            "gameVersion": "27.0", "bepInExVersion": "pinned", "gameFingerprint": "verified",
            "sha256": {name: release.sha256(path) for name, path in self.paths.items()},
            "checks": dict.fromkeys(release.CHECKS, True),
            "metrics": dict.fromkeys(("dispatchP50Ms", "dispatchP95Ms", "dispatchP99Ms", "queuePeak",
                                      "dropped", "baselineFrameP95Ms", "sdkFrameP95Ms"), 1),
        }

    def tearDown(self):
        self.directory.cleanup()

    def validate(self, unity=True):
        release.validate_record(self.record, self.props, "commit", self.paths,
                                {"unityIntegration": unity}, {"verified"})

    def test_complete_exact_binary_validation_passes(self):
        self.validate()

    def test_capture_only_cannot_be_formal(self):
        with self.assertRaisesRegex(ValueError, "Unity-enabled"):
            self.validate(False)

    def test_changed_binary_cannot_reuse_validation(self):
        self.paths["plugin"].write_bytes(b"rebuilt")
        with self.assertRaisesRegex(ValueError, "hash mismatch: plugin"):
            self.validate()

    def test_every_manual_check_is_required(self):
        for key in release.CHECKS:
            with self.subTest(key=key):
                self.record["checks"][key] = False
                with self.assertRaises(ValueError):
                    self.validate()
                self.record["checks"][key] = True

    def test_wrong_commit_pending_version_fingerprint_and_missing_metrics_fail(self):
        for key, value in (("sourceCommit", "other"), ("status", "pending"), ("gameVersion", "26"),
                           ("bepInExVersion", "other"), ("gameFingerprint", "unknown"), ("metrics", {})):
            with self.subTest(key=key):
                previous = self.record[key]
                self.record[key] = value
                with self.assertRaises(ValueError):
                    self.validate()
                self.record[key] = previous

    def test_nonfinite_measurements_are_not_validation_evidence(self):
        for value in (float("nan"), float("inf"), -1, True):
            with self.subTest(value=value):
                self.record["metrics"]["dispatchP99Ms"] = value
                with self.assertRaises(ValueError):
                    self.validate()

    def test_sdk_contains_one_contracts_reference_and_no_runtime_dlls(self):
        entries = release.sdk_entries(ROOT)
        dlls = [name for name in entries if name.endswith(".dll")]
        self.assertEqual(["lib/FMMatchLens.Contracts.dll"], dlls)
        self.assertTrue(any(name.endswith("MinimalUnityHud.csproj") for name in entries))
        self.assertIn("examples/MinimalUnityHud/HudViewState.cs", entries)
        self.assertIn("README.md", entries)
        self.assertIn("CONTRIBUTING.md", entries)
        self.assertFalse(any(name.startswith("docs/") for name in entries))
        self.assertFalse(any("bin/" in name or "obj/" in name for name in entries))

    def test_sdk_can_be_packaged_without_a_docs_directory(self):
        (self.root / "examples/MinimalUnityHud").mkdir(parents=True)
        entries = release.sdk_entries(self.root)
        self.assertIn("lib/FMMatchLens.Contracts.dll", entries)
        self.assertFalse(any(name.startswith("docs/") for name in entries))

    def test_pending_record_has_every_check_and_no_claimed_results(self):
        record = release.pending_record()
        self.assertEqual("pending", record["status"])
        self.assertEqual(dict.fromkeys(release.CHECKS, False), record["checks"])
        self.assertEqual(dict.fromkeys(release.METRICS), record["metrics"])
        record["checks"][release.CHECKS[0]] = True
        self.assertFalse(release.pending_record()["checks"][release.CHECKS[0]])

    def test_zip_allowlist_keeps_paths_and_content(self):
        archive = self.root / "sample.zip"
        release.write_zip(archive, {"lib/contracts.dll": self.paths["contracts"], "info.json": b"{}"})
        with zipfile.ZipFile(archive) as z:
            self.assertEqual(["info.json", "lib/contracts.dll"], z.namelist())
            self.assertEqual(b"contracts", z.read("lib/contracts.dll"))


if __name__ == "__main__":
    unittest.main()
