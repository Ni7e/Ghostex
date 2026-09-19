use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::ErrorKind,
    net::TcpStream,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};
use tungstenite::{Error as SocketError, Message};

pub(crate) struct Network {
    sender: mpsc::Sender<Value>,
    pub(crate) receiver: mpsc::Receiver<Value>,
    sockets: HashMap<u64, mpsc::Sender<Option<String>>>,
    requests: HashMap<u64, Arc<AtomicBool>>,
}
impl Network {
    pub(crate) fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        Self {
            sender,
            receiver,
            sockets: HashMap::new(),
            requests: HashMap::new(),
        }
    }
    pub(crate) fn dispatch(&mut self, message: &Value) -> bool {
        let id = message["id"].as_u64().unwrap_or(0);
        match message["kind"].as_str().unwrap_or_default() {
            "http" => {
                let request = message.clone();
                let sender = self.sender.clone();
                let cancelled = Arc::new(AtomicBool::new(false));
                self.requests.insert(id, cancelled.clone());
                thread::spawn(move || {
                    let result = fetch(&request);
                    if !cancelled.load(Ordering::Relaxed) {
                        let reply = match result {
                            Ok((status, body)) => {
                                json!({"kind":"http", "id":id,"status":status,"body":body})
                            }
                            Err(error) => json!({"kind":"http","id":id,"error":error.to_string()}),
                        };
                        let _ = sender.send(reply);
                    }
                });
            }
            "httpCancel" => {
                if let Some(cancelled) = self.requests.remove(&id) {
                    cancelled.store(true, Ordering::Relaxed);
                }
            }
            "socketOpen" => {
                let (sender, receiver) = mpsc::channel();
                self.sockets.insert(id, sender);
                let events = self.sender.clone();
                let url = message["url"].as_str().unwrap_or_default().to_owned();
                thread::spawn(move || {
                    if socket(&url, id, &events, receiver).is_err() {
                        let _ = events.send(json!({"kind":"socket","id":id,"type":"error"}));
                    }
                    let _ = events.send(json!({"kind":"socket","id":id,"type":"close"}));
                });
            }
            "socketSend" => {
                if let Some(sender) = self.sockets.get(&id) {
                    let _ = sender.send(Some(
                        message["data"].as_str().unwrap_or_default().to_owned(),
                    ));
                }
            }
            "socketClose" => {
                if let Some(sender) = self.sockets.remove(&id) {
                    let _ = sender.send(None);
                }
            }
            _ => return false,
        }
        true
    }
    pub(crate) fn completed(&mut self, message: &Value) {
        let id = message["id"].as_u64().unwrap_or(0);
        if message["kind"] == "http" {
            self.requests.remove(&id);
        }
        if message["kind"] == "socket" && message["type"] == "close" {
            self.sockets.remove(&id);
        }
    }
}
impl Drop for Network {
    fn drop(&mut self) {
        for flag in self.requests.values() {
            flag.store(true, Ordering::Relaxed);
        }
        for socket in self.sockets.values() {
            let _ = socket.send(None);
        }
    }
}

fn fetch(request: &Value) -> Result<(u16, String)> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .max_redirects(0)
        .timeout_global(Some(Duration::from_secs(60)))
        .build()
        .into();
    let method = request["method"].as_str().unwrap_or("GET");
    let url = request["url"]
        .as_str()
        .ok_or_else(|| anyhow!("Missing request URL"))?;
    let mut http = ureq::http::Request::builder().method(method).uri(url);
    if let Some(headers) = request["headers"].as_object() {
        for (name, value) in headers {
            if let Some(value) = value.as_str() {
                http = http.header(name.as_str(), value);
            }
        }
    }
    let body = request["body"]
        .as_str()
        .unwrap_or_default()
        .as_bytes()
        .to_vec();
    let mut response = agent.run(http.body(body)?)?;
    let status = response.status().as_u16();
    let body = response
        .body_mut()
        .with_config()
        .limit(128 * 1024 * 1024)
        .read_to_string()?;
    Ok((status, body))
}
fn socket(
    url: &str,
    id: u64,
    events: &mpsc::Sender<Value>,
    commands: mpsc::Receiver<Option<String>>,
) -> Result<()> {
    let parsed = url::Url::parse(url)?;
    if parsed.scheme() != "ws" {
        return Err(anyhow!(
            "Native service sockets require the app's local tunnel endpoint"
        ));
    }
    let stream = TcpStream::connect((
        parsed
            .host_str()
            .ok_or_else(|| anyhow!("Missing socket host"))?,
        parsed.port_or_known_default().unwrap_or(80),
    ))?;
    stream.set_read_timeout(Some(Duration::from_millis(50)))?;
    stream.set_write_timeout(Some(Duration::from_secs(10)))?;
    let (mut socket, _) = tungstenite::client(url, stream)?;
    events.send(json!({"kind":"socket","id":id,"type":"open"}))?;
    loop {
        loop {
            match commands.try_recv() {
                Ok(Some(data)) => socket.send(Message::Text(data.into()))?,
                Ok(None) | Err(mpsc::TryRecvError::Disconnected) => {
                    let _ = socket.close(None);
                    return Ok(());
                }
                Err(mpsc::TryRecvError::Empty) => break,
            }
        }
        match socket.read() {
            Ok(Message::Text(data)) => {
                events
                    .send(json!({"kind":"socket","id":id,"type":"message","data":data.as_str()}))?;
            }
            Ok(Message::Close(_))
            | Err(SocketError::ConnectionClosed)
            | Err(SocketError::AlreadyClosed) => return Ok(()),
            Err(SocketError::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) => return Err(error.into()),
            _ => {}
        }
    }
}
