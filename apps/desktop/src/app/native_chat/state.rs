use crate::app::{helpers::*, model::*};
use ghostex_chat_runtime::ChatRuntime;
use gpui::{AppContext as _, Context, Entity, EventEmitter, Focusable as _, Subscription, Window};
use gpui_component::input::{InputEvent, InputState};
use serde_json::{Value, json};
use std::{collections::HashSet, sync::Arc, time::Duration};

#[derive(Clone)]
pub(crate) struct NativeChatConfig {
    pub(crate) project_id: String,
    pub(crate) session_id: String,
    pub(crate) sidebar_session_id: String,
    pub(crate) shell_session_id: TerminalSessionId,
    pub(crate) client_id: String,
    pub(crate) remote: Option<GpuiRemoteGxserverRequestTarget>,
    pub(crate) app: gpui::WeakEntity<crate::GhostexGpuiApp>,
    pub(crate) parent_native_view: *mut std::ffi::c_void,
    pub(crate) initial_snapshot: Option<Value>,
    pub(crate) initial_presentation: Option<Value>,
}

#[derive(Clone)]
pub(crate) enum NativeChatEvent {
    Broker(Value),
    Host(Value),
    DraftState(bool),
}

pub(crate) struct NativeChatView {
    pub(crate) config: NativeChatConfig,
    pub(crate) runtime: Option<ChatRuntime>,
    pub(crate) snapshot: Arc<Value>,
    pub(crate) items: Arc<Vec<Value>>,
    pub(crate) error: Option<String>,
    pub(crate) input: Option<Entity<InputState>>,
    input_subscription: Option<Subscription>,
    input_observer: Option<Subscription>,
    pub(super) suggestions: super::suggestions::SuggestionWindowState,
    pub(super) composer_bounds: std::rc::Rc<std::cell::Cell<gpui::Bounds<gpui::Pixels>>>,
    pub(super) suggestion_selection: Option<(String, usize)>,
    input_window: Option<gpui::WindowId>,
    pub(super) option_menu: Option<Entity<super::option_menu::ChatOptionMenu>>,
    pub(super) context_editor_window: super::context_editor::ContextEditorWindowState,
    pub(super) model_picker_window: super::model_picker::window::ModelPickerWindowState,
    pub(crate) maximized_window: Option<gpui::WindowHandle<gpui_component::Root>>,
    pub(crate) main_window: Option<gpui::AnyWindowHandle>,
    pub(crate) window_subscription: Option<Subscription>,
    pub(crate) send_hold_task: Option<gpui::Task<()>>,
    pub(crate) send_hold_fired: bool,
    pub(crate) stop_cooldown_task: Option<gpui::Task<()>>,
    pub(super) context_status_measurements: Option<Value>,
    pub(crate) composer_measurements: Option<Value>,
    pub(super) composer_held_key: Option<String>,
    pub(crate) bounds: std::rc::Rc<std::cell::Cell<gpui::Bounds<gpui::Pixels>>>,
    input_needs_sync: bool,
    input_undoable: bool,
    input_caret: Option<usize>,
    pub(crate) answer_input: Option<(String, Entity<InputState>)>,
    pub(crate) answer_subscription: Option<Subscription>,
    pub(super) terminal_dialog_input: Option<super::terminal_dialog::TerminalDialogInput>,
    pub(super) terminal_dialog_key_focus: gpui::FocusHandle,
    pub(crate) note_input: Option<Entity<InputState>>,
    pub(crate) note_subscription: Option<Subscription>,
    pub(crate) draft: String,
    pub(crate) draft_revision: u64,
    pub(crate) draft_id: String,
    pub(crate) pending_send: bool,
    pub(crate) composer_ready: bool,
    pub(crate) expanded: HashSet<String>,
    pub(crate) collapsed: HashSet<String>,
    pub(crate) list: gpui::ListState,
    pub(crate) pane_focused: bool,
    pub(crate) focus_requested: bool,
    pub(crate) subscriptions: Vec<Subscription>,
    pump_task: Option<gpui::Task<()>>,
}

impl EventEmitter<NativeChatEvent> for NativeChatView {}

impl NativeChatView {
    pub(crate) fn new(config: NativeChatConfig, cx: &mut Context<Self>) -> Self {
        super::fonts::register(cx);
        super::keyboard::register(cx);
        let runtime = ChatRuntime::new(
            &json!({"clientId":config.client_id,"initialSnapshot":config.initial_snapshot,"initialPresentation":config.initial_presentation}),
        );
        let (runtime, error) = match runtime {
            Ok(value) => (Some(value), None),
            Err(error) => (None, Some(error.to_string())),
        };
        let pump_task = cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(16))
                .await;
            let _ = this.update(cx, |this, cx| this.pump(cx));
        });
        let list = gpui::ListState::new(0, gpui::ListAlignment::Bottom, gpui::px(400.0));
        list.set_follow_mode(gpui::FollowMode::Tail);
        Self {
            draft_id: format!(
                "{}-{}",
                config.client_id,
                SessionChatPageState::next_identity()
            ),
            config,
            runtime,
            error,
            snapshot: Arc::new(Value::Null),
            items: Arc::default(),
            input: None,
            input_subscription: None,
            input_observer: None,
            suggestions: Default::default(),
            composer_bounds: Default::default(),
            suggestion_selection: None,
            input_window: None,
            option_menu: None,
            model_picker_window: Default::default(),
            context_editor_window: Default::default(),
            maximized_window: None,
            main_window: None,
            window_subscription: None,
            send_hold_task: None,
            send_hold_fired: false,
            stop_cooldown_task: None,
            composer_measurements: None,
            composer_held_key: None,
            context_status_measurements: None,
            bounds: Default::default(),
            input_needs_sync: false,
            input_undoable: false,
            input_caret: None,
            answer_input: None,
            answer_subscription: None,
            terminal_dialog_input: None,
            terminal_dialog_key_focus: cx.focus_handle(),
            note_input: None,
            note_subscription: None,
            draft: String::new(),
            draft_revision: 0,
            pending_send: false,
            composer_ready: false,
            expanded: HashSet::new(),
            collapsed: HashSet::new(),
            list,
            pane_focused: false,
            focus_requested: false,
            subscriptions: Vec::new(),
            pump_task: Some(pump_task),
        }
    }

    pub(crate) fn ensure_input(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.input.is_none() {
            let draft = self.draft.clone();
            let input = cx.new(|cx| InputState::new(window, cx).multi_line(true).submit_on_enter(true).auto_grow(3, 7)
                .placeholder("Press Enter to send a message and Tab to Queue.\nUse @ to mention a file and $ for using skills.")
                .default_value(draft));
            self.input = Some(input);
        }
        if self.input_window != Some(window.window_handle().window_id()) {
            self.input_window = Some(window.window_handle().window_id());
            let input = self.input.as_ref().unwrap().clone();
            self.input_observer = Some(cx.observe_in(&input, window, |this, input, window, cx| {
                if input.read(cx).focus_handle(cx).is_focused(window) {
                    this.update_suggestion_selection(cx);
                }
            }));
            self.input_subscription = Some(cx.subscribe_in(
                &input,
                window,
                |this, input, event: &InputEvent, _, cx| match event {
                    InputEvent::Change => {
                        let draft = input.read(cx).value().to_string();
                        if draft == this.draft {
                            return;
                        }
                        this.draft = draft;
                        this.draft_revision += 1;
                        this.persist_draft(cx);
                        cx.emit(NativeChatEvent::DraftState(this.draft.is_empty()));
                        cx.notify();
                    }
                    InputEvent::Blur => this.save_draft(cx),
                    _ => {}
                },
            ));
        }
        if self.input_needs_sync {
            self.input_needs_sync = false;
            let undoable = std::mem::take(&mut self.input_undoable);
            let caret = self
                .input_caret
                .take()
                .map(|utf16| {
                    let mut offset = 0;
                    self.draft
                        .char_indices()
                        .find_map(|(index, ch)| {
                            if offset >= utf16 {
                                return Some(index);
                            }
                            offset += ch.len_utf16();
                            None
                        })
                        .unwrap_or(self.draft.len())
                })
                .unwrap_or(self.draft.len());
            if let Some(input) = &self.input {
                input.update(cx, |input, cx| {
                    if undoable {
                        input.replace_all(self.draft.clone(), window, cx);
                    } else {
                        input.set_value(self.draft.clone(), window, cx);
                    }
                    input.set_selected_range(caret..caret, cx);
                });
            }
        }
        if self.focus_requested {
            self.focus_requested = false;
            if let Some(input) = &self.input {
                input.read(cx).focus_handle(cx).focus(window, cx);
            }
        }
    }

    pub(crate) fn invoke(&mut self, mut action: Value, cx: &mut Context<Self>) {
        if action["type"] == "toggleModelPicker" {
            let scale = super::appearance::ChatAppearance::current(&self.snapshot).scale;
            let size = self.bounds.get().size;
            action["size"] =
                json!({"width":size.width.as_f32()/scale,"height":size.height.as_f32()/scale});
        }
        if let Some(runtime) = &mut self.runtime
            && let Err(error) = runtime.call("action", &[action])
        {
            self.error = Some(error.to_string());
        }
        self.pump(cx);
    }

    pub(crate) fn receive_callback(
        &mut self,
        callback: &str,
        payload: &Value,
        cx: &mut Context<Self>,
    ) {
        if callback == "onSessionChatRuntimeMessage" {
            if let Some(runtime) = &mut self.runtime
                && let Err(error) = runtime.call("brokerMessage", &[payload.clone()])
            {
                self.error = Some(error.to_string());
            }
        }
        if callback == "onSessionChatAttachmentsPicked" {
            self.invoke(json!({"type":"attachPaths","paths":payload["paths"]}), cx);
        }
        self.pump(cx);
    }

    pub(crate) fn insert_prompt(&mut self, content: &str, cx: &mut Context<Self>) {
        self.replace_draft(content, false, cx);
    }

    fn replace_draft(&mut self, content: &str, history: bool, cx: &mut Context<Self>) {
        self.draft = content.to_string();
        self.draft_revision += 1;
        self.input_needs_sync = true;
        self.input_undoable = true;
        self.focus_requested = true;
        if self.composer_ready {
            self.invoke(json!({"type":"editDraft", "text":self.draft, "draftVersion":{"draftId":self.draft_id,"revision":self.draft_revision.max(1)},"history":history}),cx);
        }
        self.save_draft(cx);
        cx.notify();
    }

    pub(crate) fn persist_draft(&mut self, cx: &mut Context<Self>) {
        if self.composer_ready {
            self.invoke(json!({"type":"editDraft", "text":self.draft, "draftVersion":{"draftId":self.draft_id,"revision":self.draft_revision.max(1)}}), cx);
        }
    }

    pub(crate) fn save_draft(&mut self, cx: &mut Context<Self>) {
        if !self.composer_ready {
            return;
        }
        self.invoke(json!({"type":"saveDraft","content":self.draft,"draftVersion":{"draftId":self.draft_id,"revision":self.draft_revision}}), cx);
    }

    pub(crate) fn host(&self, action: &str, fields: Value, cx: &mut Context<Self>) {
        let mut message = fields.as_object().cloned().unwrap_or_default();
        message.insert("type".into(), "sessionChatHostAction".into());
        message.insert("action".into(), action.into());
        cx.emit(NativeChatEvent::Host(Value::Object(message)));
    }

    pub(crate) fn pump(&mut self, cx: &mut Context<Self>) {
        let Some(runtime) = &mut self.runtime else {
            return;
        };
        let mut output = match runtime.drain() {
            Ok(value) => value,
            Err(error) => {
                self.error = Some(error.to_string());
                cx.notify();
                return;
            }
        };
        self.pump_task = output["nextWakeMs"].as_u64().map(|delay| {
            cx.spawn(async move |this, cx| {
                cx.background_executor()
                    .timer(Duration::from_millis(delay.max(1)))
                    .await;
                let _ = this.update(cx, |this, cx| this.pump(cx));
            })
        });
        if let Some(Value::Array(items)) = output
            .as_object_mut()
            .and_then(|output| output.remove("items"))
        {
            let old = self.items.as_slice();
            let next = items.as_slice();
            let prefix = old.iter().zip(next).take_while(|(a, b)| a == b).count();
            let suffix = old[prefix..]
                .iter()
                .rev()
                .zip(next[prefix..].iter().rev())
                .take_while(|(a, b)| a == b)
                .count();
            if prefix + suffix < old.len().max(next.len()) {
                self.list
                    .splice(prefix..old.len() - suffix, next.len() - prefix - suffix);
            }
            self.items = Arc::new(items);
            cx.notify();
        }
        if let Some(snapshot) = output
            .as_object_mut()
            .and_then(|output| output.remove("snapshot"))
        {
            self.snapshot = Arc::new(snapshot);
            self.sync_model_picker_window(cx);
            self.sync_context_editor_window(cx);
            self.sync_suggestion_window(cx);
            cx.notify();
        }
        for request in output["requests"].as_array().into_iter().flatten() {
            match request["kind"].as_str() {
                Some("rpc") => self.rpc(request.clone(), cx),
                Some("broker") => cx.emit(NativeChatEvent::Broker(request.clone())),
                Some("composerClearExpected") => {
                    if request["params"]["text"].as_str() == Some(self.draft.as_str()) { self.replace_draft("",false,cx); }
                }
                Some("returnedPrompt") => self.invoke(json!({"type":"applyReturned","text":request["params"]["text"],"current":self.draft}),cx),
                Some("composerInit") => {
                    let entry = &request["params"]["entry"];
                    self.config.client_id = request["params"]["clientId"].as_str().unwrap_or_default().to_string();
                    self.draft_id = entry["version"]["draftId"].as_str().unwrap_or_default().to_string();
                    self.draft_revision = entry["version"]["revision"].as_u64().unwrap_or(1);
                    self.draft = if entry["parked"] == true || entry["submitted"] == true { String::new() } else { entry["text"].as_str().unwrap_or_default().to_string() };
                    self.input_needs_sync = true;
                    self.composer_ready = true;
                    self.host("composerReady", json!({}), cx);
                    cx.emit(NativeChatEvent::DraftState(self.draft.is_empty()));
                    cx.notify();
                }
                Some("draftSubmitted") => {
                    self.pending_send = false;
                    if request["method"] == "handoff" && request["params"]["version"]["draftId"].as_str() == Some(&self.draft_id) && request["params"]["version"]["revision"].as_u64() == Some(self.draft_revision) {
                        self.draft.clear();
                        self.draft_id = request["params"]["nextVersion"]["draftId"].as_str().unwrap_or_default().to_string();
                        self.draft_revision = 1;
                        self.input_needs_sync = true;
                        self.focus_requested = true;
                        cx.emit(NativeChatEvent::DraftState(true));
                    }
                    cx.notify();
                }
                Some("submissionFailed") => {
                    self.pending_send = false;
                    self.invoke(json!({"type":"restoreSubmission","text":request["params"]["text"],"current":self.draft}),cx);
                }
                Some("draftReceived") => {
                    if request["params"]["previous"].as_str() == Some(self.draft.as_str()) {
                        self.draft = request["params"]["content"].as_str().unwrap_or_default().to_owned();
                        self.draft_id = request["params"]["version"]["draftId"].as_str().unwrap_or_default().to_owned();
                        self.draft_revision = request["params"]["version"]["revision"].as_u64().unwrap_or(1);
                        self.input_needs_sync = true;
                        self.focus_requested = true;
                        cx.emit(NativeChatEvent::DraftState(self.draft.is_empty()));
                    }
                    cx.notify();
                }
                Some("attachmentReferences") => {
                    let selection = self.input.as_ref().map(|input|input.read(cx).selected_range()).unwrap_or(self.draft.len()..self.draft.len());
                    let start = self.draft[..selection.start].encode_utf16().count();
                    let end = self.draft[..selection.end].encode_utf16().count();
                    self.invoke(json!({"type":"insertAttachments","paths":request["params"]["paths"],"text":self.draft,"start":start,"end":end}), cx);
                }
                Some("host") => self.host(request["method"].as_str().unwrap_or_default(), request["params"].clone(), cx),
                Some("actionError") => { cx.notify(); }
                Some("composer") => {
                    self.replace_draft(request["params"]["content"].as_str().unwrap_or_default(), request["method"] == "history", cx);
                    self.input_caret = request["params"]["caret"].as_u64().map(|caret|caret as usize);
                }
                _ => {}
            }
        }
    }

    fn rpc(&mut self, request: Value, cx: &mut Context<Self>) {
        let config = self.config.clone();
        let Some(method) = request["method"].as_str() else {
            return;
        };
        if method == "readNativeComposer" {
            if let Some(runtime) = &mut self.runtime
                && let Err(error) = runtime.call(
                    "resolve",
                    &[
                        request["id"].clone(),
                        self.draft.clone().into(),
                        Value::Null,
                    ],
                )
            {
                self.error = Some(error.to_string());
            }
            self.pump(cx);
            return;
        }
        let endpoint = format!("/api/{method}");
        let import_attachments = method == "importNativeAttachments";
        let mut params = request["params"].as_object().cloned().unwrap_or_default();
        params.insert("projectId".into(), config.project_id.into());
        params.insert("sessionId".into(), config.session_id.into());
        let params = Value::Object(params);
        let id = request["id"].clone();
        let task = cx.background_executor().spawn(async move {
            if import_attachments {
                return super::attachments::import_paths(&config.remote, &params)
                    .map_err(|message| json!({"message":message,"endpoint":endpoint}));
            }
            super::rpc::request(config.remote, &endpoint, &params)
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                let (value, error) = match result {
                    Ok(value) => (value, Value::Null),
                    Err(error) => (Value::Null, error),
                };
                if let Some(runtime) = &mut this.runtime
                    && let Err(error) = runtime.call("resolve", &[id, value, error])
                {
                    this.error = Some(error.to_string());
                }
                this.pump(cx);
            });
        })
        .detach();
    }
}
