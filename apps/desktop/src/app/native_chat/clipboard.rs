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
        let answer = self
            .async_answer_input
            .as_ref()
            .filter(|(_, input)| input.read(cx).focus_handle(cx).is_focused(window))
            .cloned();
        if !self.composer_ready
            || (answer.is_none()
                && !self
                    .input
                    .as_ref()
                    .is_some_and(|input| input.read(cx).focus_handle(cx).is_focused(window)))
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
        let external_paths = clipboard
            .entries
            .iter()
            .filter_map(|entry| match entry {
                ClipboardEntry::ExternalPaths(paths) => Some(&paths.0),
                _ => None,
            })
            .flatten()
            .map(|path| path.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        if images.is_empty() && external_paths.is_empty() {
            cx.propagate();
            return;
        }
        cx.stop_propagation();
        if answer.is_some()
            && (self.snapshot["asyncQuestions"]["submitting"] == true
                || self.snapshot["asyncQuestions"]["loading"] == true)
        {
            return;
        }
        let selection = answer.as_ref().map(|(_, input)| {
            let state = input.read(cx);
            let text = state.value().to_string();
            let selected = state.selected_range();
            let start = text[..selected.start].encode_utf16().count();
            let end = text[..selected.end].encode_utf16().count();
            (text, start, end)
        });
        if answer.is_some() {
            self.async_answer_echo.pending += 1;
            self.async_answer_echo.error = None;
            self.invoke(
                json!({"type":"asyncQuestionImagesPending","pending":true}),
                cx,
            );
            cx.notify();
        } else {
            if images.is_empty() {
                self.invoke(json!({"type":"attachPaths","paths":external_paths}), cx);
                return;
            }
            self.invoke(json!({"type":"attachmentsStarted"}), cx);
        }
        let config = self.config.clone();
        let task = cx.background_executor().spawn(async move {
            if images.is_empty() {
                return match super::attachments::import_paths(&config.remote, &json!({"paths":external_paths,"projectId":config.project_id,"sessionId":config.session_id})) {
                    Ok(paths) => (paths.as_array().cloned().unwrap_or_default(), None),
                    Err(error) => (Vec::new(), Some(error)),
                };
            }
            let mut paths = Vec::new();
            for (index, image) in images.into_iter().enumerate() {
                let result = super::rpc::request(config.remote.clone(), "/api/saveSessionChatImage", &json!({
                    "projectId":config.project_id, "sessionId":config.session_id,
                    "base64Data":base64::engine::general_purpose::STANDARD.encode(image.bytes()),
                    "suggestedName":format!("clipboard-image-{}.{}", index+1, image.format().extension()),
                })).await;
                match result {
                    Ok(value) if value["path"].is_string() => paths.push(value["path"].clone()),
                    Ok(_) => return (paths, Some("The session machine did not return an image path".to_owned())),
                    Err(error) => return (paths, Some(error["message"].as_str().unwrap_or("The image could not be attached").to_owned())),
                }
            }
            (paths, None)
        });
        cx.spawn_in(window, async move |chat, cx| {
            let (paths, error) = task.await;
            let _ = chat.update_in(cx, |chat, window, cx| {
                if let Some((key, input)) = answer {
                    chat.finish_answer_attachments(
                        key,
                        input,
                        selection.unwrap(),
                        paths,
                        error,
                        window,
                        cx,
                    );
                    return;
                }
                chat.invoke(
                    json!({"type":"attachmentsFinished","paths":paths,"error":error}),
                    cx,
                )
            });
        })
        .detach();
    }
}
