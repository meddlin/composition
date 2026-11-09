//! Starts, supervises and stops a local Meilisearch for the app, as `meili.ts` does: a random free port, a generated master key
//! kept in a 0600 file and handed over in the environment (not argv, so `ps` does not show it), production mode (no dashboard),
//! dumps and snapshots beside the data directory with that folder as the working directory, a pid file so a crash of the app
//! leaves no orphan behind, a health poll before use, terminate then kill on stop.
//!
//! Added, and not in the desktop: on Linux the child is asked to die with its parent (`PR_SET_PDEATHSIG`), which is the
//! counterpart of the Job Object the Windows design uses. The pid file stays as the second line of defence.

use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::net::TcpListener;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
#[cfg(target_os = "linux")]
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug)]
pub struct MeiliError(pub String);

impl std::fmt::Display for MeiliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for MeiliError {}

#[derive(Clone, Debug)]
pub struct MeiliOptions {
    pub binary: PathBuf,
    /// Meilisearch's database folder; its parent is the state folder everything else goes in.
    pub data_dir: PathBuf,
    pub log_path: PathBuf,
    pub key_path: PathBuf,
    pub pid_path: PathBuf,
    pub health_timeout: Duration,
    pub stop_timeout: Duration,
    pub die_with_parent: bool,
}

impl MeiliOptions {
    pub fn new(binary: impl Into<PathBuf>, state_dir: impl Into<PathBuf>) -> Self {
        let state: PathBuf = state_dir.into();
        Self {
            binary: binary.into(),
            data_dir: state.join("meili_data"),
            log_path: state.join("meili.log"),
            key_path: state.join("meili_master_key"),
            pid_path: state.join("meili.pid"),
            health_timeout: Duration::from_secs(10),
            stop_timeout: Duration::from_secs(5),
            die_with_parent: true,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Handle {
    pub url: String,
    pub master_key: String,
    pub pid: u32,
}

pub fn free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

/// Reads the key if there is one, else makes 32 random bytes as hex and keeps them in a file only the owner can read.
pub fn load_or_create_master_key(path: &PathBuf) -> std::io::Result<String> {
    if let Ok(existing) = fs::read_to_string(path) {
        let existing = existing.trim();
        if !existing.is_empty() {
            return Ok(existing.to_string());
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut bytes = [0u8; 32];
    File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    let key: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let mut file = OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
    std::io::Write::write_all(&mut file, key.as_bytes())?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(key)
}

pub fn is_alive(pid: i32) -> bool {
    // SAFETY: signal 0 only checks that the process exists.
    unsafe { libc::kill(pid, 0) == 0 }
}

fn command_line(pid: i32) -> String {
    Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}

/// Kills a Meilisearch left behind by a previous run that died without stopping it. Only a process whose command line mentions
/// our data directory is touched, so a recycled pid belonging to something else is left alone. Returns whether one was killed.
pub fn reap_orphan(pid_path: &PathBuf, data_dir: &PathBuf) -> bool {
    let pid = fs::read_to_string(pid_path).ok().and_then(|s| s.trim().parse::<i32>().ok());
    let _ = fs::remove_file(pid_path);
    let Some(pid) = pid else { return false };
    if pid <= 1 || !is_alive(pid) || !command_line(pid).contains(&data_dir.to_string_lossy().into_owned()) {
        return false;
    }
    // SAFETY: a signal to a pid we just checked is ours.
    unsafe { libc::kill(pid, libc::SIGTERM) };
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(3) && is_alive(pid) {
        std::thread::sleep(Duration::from_millis(100));
    }
    if is_alive(pid) {
        unsafe { libc::kill(pid, libc::SIGKILL) };
    }
    true
}

pub struct MeiliProcess {
    options: MeiliOptions,
    child: Option<Child>,
}

impl MeiliProcess {
    pub fn new(options: MeiliOptions) -> Self {
        Self { options, child: None }
    }

    pub fn options(&self) -> &MeiliOptions {
        &self.options
    }

    pub fn start(&mut self) -> Result<Handle, MeiliError> {
        if self.child.is_some() {
            return Err(MeiliError("Meilisearch is already running".into()));
        }
        let o = self.options.clone();
        let state_dir = o.data_dir.parent().map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
        let io = |e: std::io::Error| MeiliError(e.to_string());

        reap_orphan(&o.pid_path, &o.data_dir);
        fs::create_dir_all(&o.data_dir).map_err(io)?;
        if let Some(parent) = o.log_path.parent() {
            fs::create_dir_all(parent).map_err(io)?;
        }
        let master_key = load_or_create_master_key(&o.key_path).map_err(io)?;
        let port = free_port().map_err(io)?;
        let url = format!("http://127.0.0.1:{port}");

        let log = OpenOptions::new().create(true).append(true).open(&o.log_path).map_err(io)?;
        let mut command = Command::new(&o.binary);
        command
            .args(["--db-path"])
            .arg(&o.data_dir)
            .args(["--http-addr", &format!("127.0.0.1:{port}")])
            .arg("--dump-dir")
            .arg(state_dir.join("dumps"))
            .arg("--snapshot-dir")
            .arg(state_dir.join("snapshots"))
            .arg("--no-analytics")
            .current_dir(&state_dir)
            .stdin(Stdio::null())
            .stdout(log.try_clone().map_err(io)?)
            .stderr(log)
            .env("MEILI_MASTER_KEY", &master_key)
            .env("MEILI_ENV", "production");
        #[cfg(target_os = "linux")]
        if o.die_with_parent {
            let parent = std::process::id() as i32;
            // SAFETY: only async-signal-safe calls between fork and exec. PDEATHSIG fires when the *thread* that spawned the child
            // exits, so the app must spawn it from a thread that lives as long as the app (the main thread, or one that is joined last).
            unsafe {
                command.pre_exec(move || {
                    libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
                    if libc::getppid() != parent {
                        libc::_exit(1); // the parent died before the prctl took effect
                    }
                    Ok(())
                });
            }
        }
        let child = command.spawn().map_err(|e| MeiliError(format!("Could not start Meilisearch ({}): {e}", o.binary.display())))?;
        let pid = child.id();
        fs::write(&o.pid_path, pid.to_string()).map_err(io)?;
        self.child = Some(child);

        if let Err(e) = self.wait_until_healthy(&url) {
            self.stop();
            return Err(e);
        }
        Ok(Handle { url, master_key, pid })
    }

    fn wait_until_healthy(&mut self, url: &str) -> Result<(), MeiliError> {
        let deadline = Instant::now() + self.options.health_timeout;
        let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(1))).build().into();
        while Instant::now() < deadline {
            if let Some(child) = self.child.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    return Err(MeiliError(format!("Meilisearch exited early ({status}): {}", self.log_tail())));
                }
            }
            if agent.get(&format!("{url}/health")).call().is_ok() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Err(MeiliError(format!("Meilisearch did not become healthy within {:?}: {}", self.options.health_timeout, self.log_tail())))
    }

    fn log_tail(&self) -> String {
        let text = fs::read_to_string(&self.options.log_path).unwrap_or_default();
        let from = text.len().saturating_sub(1500);
        text.get(from..).unwrap_or("").to_string()
    }

    pub fn pid(&self) -> Option<u32> {
        self.child.as_ref().map(|c| c.id())
    }

    pub fn running(&mut self) -> bool {
        self.child.as_mut().map(|c| matches!(c.try_wait(), Ok(None))).unwrap_or(false)
    }

    /// For tests: what a crash looks like from outside. No terminate, no cleanup, the pid file left behind.
    pub fn kill_hard(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Terminate, wait, then kill, and remove the pid file.
    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            // SAFETY: the child is ours.
            unsafe { libc::kill(child.id() as i32, libc::SIGTERM) };
            let started = Instant::now();
            loop {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    break;
                }
                if started.elapsed() >= self.options.stop_timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        let _ = fs::remove_file(&self.options.pid_path);
    }
}

impl Drop for MeiliProcess {
    fn drop(&mut self) {
        self.stop();
    }
}
