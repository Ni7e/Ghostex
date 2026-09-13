use super::protocol::*;
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    thread,
    time::Duration,
};

pub(crate) fn request(name: &str, operation: &str, data: Value) -> Result<Value> {
    let endpoint = endpoint(name)?;
    let mut stream = connect(&endpoint)?;
    write_frame(
        &mut stream,
        &Request {
            token: endpoint.token,
            operation: operation.into(),
            data,
        },
    )?;
    let value: Value = read_frame(&mut BufReader::new(stream))?;
    if let Some(message) = value.get("error").and_then(Value::as_str) {
        bail!("{message}");
    }
    Ok(value)
}

fn connect(endpoint: &Endpoint) -> Result<TcpStream> {
    let address = SocketAddr::from(([127, 0, 0, 1], endpoint.port));
    let stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    stream.set_nodelay(true)?;
    Ok(stream)
}

pub(crate) fn list() -> Result<Vec<Endpoint>> {
    let entries = match fs::read_dir(directory()) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut endpoints = Vec::new();
    for entry in entries {
        let path = entry?.path();
        if path.extension().is_none_or(|ext| ext != "json") {
            continue;
        }
        if let Ok(endpoint) = serde_json::from_slice::<Endpoint>(&fs::read(path)?) {
            if request(&endpoint.name, "ping", Value::Null).is_ok() {
                endpoints.push(endpoint);
            }
        }
    }
    Ok(endpoints)
}

pub(crate) fn start(launch: Launch) -> Result<()> {
    if request(&launch.name, "ping", Value::Null).is_ok() {
        return Ok(());
    }
    let encoded = STANDARD.encode(serde_json::to_vec(&launch)?);
    let child = super::launch::spawn(&encoded)?;
    for _ in 0..100 {
        if request(&launch.name, "ping", Value::Null).is_ok() {
            return Ok(());
        }
        if let Some(status) = child.exited()? {
            bail!("Native session host exited with status {status}");
        }
        thread::sleep(Duration::from_millis(50));
    }
    child.terminate();
    bail!("Native PowerShell session did not become ready");
}

struct ConsoleMode {
    input: windows_sys::Win32::Foundation::HANDLE,
    output: windows_sys::Win32::Foundation::HANDLE,
    input_mode: u32,
    output_mode: u32,
}

impl ConsoleMode {
    fn raw() -> Result<Self> {
        use windows_sys::Win32::System::Console::*;
        unsafe {
            let input = GetStdHandle(STD_INPUT_HANDLE);
            let output = GetStdHandle(STD_OUTPUT_HANDLE);
            let mut input_mode = 0;
            let mut output_mode = 0;
            if GetConsoleMode(input, &mut input_mode) == 0
                || GetConsoleMode(output, &mut output_mode) == 0
            {
                bail!("Native terminal attachment requires a Windows console");
            }
            let mode = Self {
                input,
                output,
                input_mode,
                output_mode,
            };
            if SetConsoleMode(input, ENABLE_VIRTUAL_TERMINAL_INPUT | ENABLE_EXTENDED_FLAGS) == 0
                || SetConsoleMode(output, output_mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING) == 0
            {
                bail!("Unable to enable native terminal input");
            }
            Ok(mode)
        }
    }
}

impl Drop for ConsoleMode {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::System::Console::SetConsoleMode(self.input, self.input_mode);
            windows_sys::Win32::System::Console::SetConsoleMode(self.output, self.output_mode);
        }
    }
}

/// CDXC:SessionStatus 2026-09-14 WHY:
/// gxserver observes titles independently of terminal attachments. A missing native watch-title command caused repeated failed launches and stale agent status.
pub(crate) fn watch_title(name: &str) -> Result<()> {
    let endpoint = endpoint(name)?;
    let mut stream = connect(&endpoint)?;
    stream.set_read_timeout(None)?;
    write_frame(
        &mut stream,
        &Request {
            token: endpoint.token,
            operation: "watch-title".into(),
            data: Value::Null,
        },
    )?;
    let mut reader = BufReader::new(stream);
    let mut output = std::io::stdout().lock();
    loop {
        let frame: Value = read_frame(&mut reader)?;
        if let Some(error) = frame.get("error").and_then(Value::as_str) {
            bail!("{error}");
        }
        write_frame(&mut output, &frame)?;
        output.flush()?;
    }
}

pub(crate) fn attach(name: &str) -> Result<()> {
    let _console = ConsoleMode::raw()?;
    let endpoint = endpoint(name)?;
    let mut stream = connect(&endpoint)?;
    stream.set_read_timeout(None)?;
    write_frame(
        &mut stream,
        &Request {
            token: endpoint.token,
            operation: "attach".into(),
            data: Value::Null,
        },
    )?;
    let name = name.to_string();
    let input_name = name.clone();
    let (input_tx, input_rx) = std::sync::mpsc::sync_channel(128);
    thread::spawn(move || {
        let mut input = std::io::stdin().lock();
        let mut buffer = [0u8; 8192];
        while let Ok(count) = input.read(&mut buffer) {
            if count == 0 {
                break;
            }
            if input_tx.send(buffer[..count].to_vec()).is_err() {
                break;
            }
        }
    });
    thread::spawn(move || {
        let mut filter = super::input::InputFilter::default();
        loop {
            let (bytes, sizes) = match input_rx.recv_timeout(Duration::from_millis(25)) {
                Ok(bytes) => filter.feed(&bytes),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => (filter.flush(), Vec::new()),
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            };
            for (rows, cols) in sizes {
                if request(&input_name, "resize", json!({"rows": rows, "cols": cols})).is_err() {
                    return;
                }
            }
            if !bytes.is_empty()
                && request(&input_name, "input", json!(STANDARD.encode(bytes))).is_err()
            {
                break;
            }
        }
    });
    thread::spawn(move || {
        let mut previous = None;
        loop {
            if let Ok((cols, rows)) = crossterm::terminal::size() {
                if previous != Some((cols, rows)) {
                    if request(&name, "resize", json!({"rows": rows, "cols": cols})).is_err() {
                        break;
                    }
                    previous = Some((cols, rows));
                }
            }
            thread::sleep(Duration::from_millis(100));
        }
    });
    let mut reader = BufReader::new(stream);
    let mut output = std::io::stdout().lock();
    loop {
        let frame: Value = read_frame(&mut reader)?;
        let bytes = STANDARD.decode(
            frame
                .get("output")
                .and_then(Value::as_str)
                .context("Invalid terminal output")?,
        )?;
        output.write_all(&bytes)?;
        output.flush()?;
    }
}
