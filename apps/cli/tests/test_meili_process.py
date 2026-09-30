import pytest

from composition.paths import ApplicationPaths
from composition.search import MeiliProcessManager


class _FakeProcess:
    """The bits of a Popen that MeiliProcessManager touches."""

    def poll(self):
        return None

    def terminate(self):
        pass

    def wait(self, timeout=None):
        return 0

    def kill(self):
        pass


@pytest.fixture
def spawn(monkeypatch):
    """Start a MeiliProcessManager without a real binary; return (command, kwargs)."""
    calls: list[tuple[list[str], dict]] = []

    def fake_popen(command, **kwargs):
        calls.append((list(command), kwargs))
        return _FakeProcess()

    monkeypatch.setattr("composition.search.subprocess.Popen", fake_popen)
    monkeypatch.setattr(
        "composition.search.shutil.which", lambda name: f"/fake/bin/{name}"
    )
    monkeypatch.setattr(MeiliProcessManager, "_wait_healthy", lambda *args: None)

    def start(paths: ApplicationPaths):
        manager = MeiliProcessManager(
            data_dir=paths.meili_data,
            log_path=paths.meili_log,
            key_path=paths.meili_master_key,
        )
        manager.start()
        manager.stop()
        assert len(calls) == 1
        return calls[0]

    return start


def _value_after(command: list[str], flag: str) -> str:
    return command[command.index(flag) + 1]


def test_dumps_and_snapshots_go_under_the_app_data_dir(spawn, tmp_path):
    paths = ApplicationPaths(tmp_path / "app-data")

    command, _ = spawn(paths)

    assert _value_after(command, "--db-path") == str(paths.meili_data)
    assert _value_after(command, "--dump-dir") == str(paths.root / "dumps")
    assert _value_after(command, "--snapshot-dir") == str(paths.root / "snapshots")


def test_server_runs_from_the_app_data_dir_not_the_launch_dir(
    spawn, tmp_path, monkeypatch
):
    launch_dir = tmp_path / "read-only-elsewhere"
    launch_dir.mkdir()
    monkeypatch.chdir(launch_dir)
    paths = ApplicationPaths(tmp_path / "app-data")

    _, kwargs = spawn(paths)

    assert kwargs["cwd"] == paths.root
    assert paths.root.is_dir()


def test_master_key_is_passed_in_the_environment_not_argv(spawn, tmp_path, monkeypatch):
    monkeypatch.setenv("COMPOSITION_TEST_SENTINEL", "inherited")
    paths = ApplicationPaths(tmp_path / "app-data")

    command, kwargs = spawn(paths)

    master_key = paths.meili_master_key.read_text().strip()
    assert master_key
    assert "--master-key" not in command
    assert master_key not in command
    assert kwargs["env"]["MEILI_MASTER_KEY"] == master_key
    assert kwargs["env"]["MEILI_ENV"] == "production"
    assert kwargs["env"]["COMPOSITION_TEST_SENTINEL"] == "inherited"
