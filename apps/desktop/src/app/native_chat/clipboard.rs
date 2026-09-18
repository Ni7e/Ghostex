use super::state::NativeChatView;
use base64::Engine as _;
use gpui::{ClipboardEntry, Context, Focusable as _, Window};
use serde_json::json;

impl NativeChatView {
    pub(super) fn paste_attachments(
        &mut self,
        _: &gpui_component::input::Paste,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.composer_ready
            || !self
                .input
                .as_ref()
                .is_some_and(|input| input.read(cx).focus_handle(cx).is_focused(window))
        {
            cx.propagate();
            return;
        }
        let Some(clipboard) = cx.read_from_clipboard() else {
            cx.propagate();
            return;
        };
        let images = clipboard
            .entries
            .iter()
            .filter_map(|entry| match entry {
                ClipboardEntry::Image(image) => Some(image.clone()),
                _ => None,
            })
            .collect::<Vec<_>>();
        if images.is_empty() {
            let paths = clipboard
                .entries
                .iter()
                .filter_map(|entry| match entry {
                    ClipboardEntry::ExternalPaths(paths) => Some(&paths.0),
                    _ => None,
                })
                .flatten()
                .map(|path| path.to_string_lossy().into_owned())
                .collect::<Vec<_>>();
            if paths.is_empty() {
                cx.propagate();
            } else {
                cx.stop_propagation();
                self.invoke(json!({"type":"attachPaths","paths":paths}), cx);
            }
            return;
        }
        cx.stop_propagation();
        self.invoke(json!({"type":"attachmentsStarted"}), cx);
        let config = self.config.clone();
        let task = cx.background_executor().spawn(async move {
            let mut paths = Vec::new();
            for (index, image) in images.into_iter().enumerate() {
                let result = super::rpc::request(config.remote.clone(), "/api/saveSessionChatImage", &json!({
                    "projectId":config.project_id, "sessionId":config.session_id,
                    "base64Data":base64::engine::general_purpose::STANDARD.encode(image.bytes()),
                    "suggestedName":format!("clipboard-image-{}.{}", index+1, image.format().extension()),
                }));
                match result {
                    Ok(value) if value["path"].is_string() => paths.push(value["path"].clone()),
                    Ok(_) => return (paths, Some("The session machine did not return an image path".to_owned())),
                    Err(error) => return (paths, Some(error["message"].as_str().unwrap_or("The image could not be attached").to_owned())),
                }
            }
            (paths, None)
        });
        cx.spawn(async move |chat, cx| {
            let (paths, error) = task.await;
            let _ = chat.update(cx, |chat, cx| {
                chat.invoke(
                    json!({"type":"attachmentsFinished","paths":paths,"error":error}),
                    cx,
                )
            });
        })
        .detach();
    }
}
