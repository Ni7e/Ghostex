use super::process_identity::read_omp_terminal_session_identity_from_agent_dir;
use std::{
    fs,
    time::{Duration, SystemTime},
};

#[test]
fn omp_npm_entrypoint_is_recognized_by_the_live_scan() {
    let name = "omp-test".to_string();
    let identities = super::parse_zmx_session_process_identities(
        "100 1 ?? /bin/zmx run omp-test -d\n101 100 ttys006 /bin/bun /install/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js",
        std::slice::from_ref(&name),
        "name=omp-test\tpid=100\tclients=1\tstart_dir=/repo",
    );
    let identity = identities.get(&name).unwrap();
    assert_eq!(identity.agent_id.as_deref(), Some("omp"));
    assert_eq!(identity.process_id, Some(101));
}

#[test]
fn omp_recycled_tty_rejects_stale_records_even_in_the_same_project() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    let other = temp.path().join("other-project");
    let records = temp.path().join("terminal-sessions");
    for dir in [&project, &other, &records] {
        fs::create_dir_all(dir).unwrap();
    }
    let transcript = other.join("2026-09-14_old-session.jsonl");
    fs::write(&transcript, "{}\n").unwrap();
    let record = records.join("ttys006");
    let start =
        SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000) + Duration::from_millis(500);
    let read = || {
        read_omp_terminal_session_identity_from_agent_dir(
            temp.path(),
            "ttys006",
            temp.path(),
            &project,
            start,
        )
    };
    for cwd in [&other, &project] {
        fs::write(
            &record,
            format!("{}\n{}\n", cwd.display(), transcript.display()),
        )
        .unwrap();
        fs::File::options()
            .write(true)
            .open(&record)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(start - Duration::from_micros(1)))
            .unwrap();
        assert!(
            read().is_none(),
            "even a same-second stale record must be rejected"
        );
    }
    fs::write(
        &record,
        format!("{}\n{}\n", other.display(), transcript.display()),
    )
    .unwrap();
    fs::File::options()
        .write(true)
        .open(&record)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(start + Duration::from_secs(1)))
        .unwrap();
    assert!(
        read().is_none(),
        "a fresh record for another cwd must be rejected"
    );
    fs::write(
        &record,
        format!("{}\n{}\nfresh\n", project.display(), transcript.display()),
    )
    .unwrap();
    fs::File::options()
        .write(true)
        .open(&record)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(start + Duration::from_secs(1)))
        .unwrap();
    assert_eq!(
        read().unwrap().0,
        "old-session",
        "a current process may deliberately resume an old transcript"
    );
}

#[test]
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn omp_process_context_reads_live_cwd_and_subsecond_start() {
    let before = SystemTime::now();
    let temp = tempfile::tempdir().unwrap();
    let mut child = std::process::Command::new("sleep")
        .arg("10")
        .current_dir(temp.path())
        .spawn()
        .unwrap();
    let result = super::process_context::process_context(i64::from(child.id()));
    let _ = child.kill();
    let _ = child.wait();
    let (cwd, start) = result.unwrap();
    assert_eq!(
        fs::canonicalize(cwd).unwrap(),
        fs::canonicalize(temp.path()).unwrap()
    );
    assert!(start >= before);
    assert!(start <= SystemTime::now() + Duration::from_millis(20));
}
