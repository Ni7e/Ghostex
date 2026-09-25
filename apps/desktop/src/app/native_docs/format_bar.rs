//! The floating formatting bar (the Docs "meo toolbar"): 37px, 10px radius, centred 14px above
//! the bottom of a Markdown document, collapsing to one pill. Its buttons edit the Markdown source
//! around the caret or selection, the same edits the web toolbar made.
//!
//! Adapted from the Docs prototype (`docs/2026-09-24/docs-gpui-editor-research/demo/src/format.rs`).

use std::ops::Range;

use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Context, Entity, InteractiveElement as _, IntoElement, MouseButton,
    ParentElement as _, StatefulInteractiveElement as _, Styled as _, Window, div, px, svg,
};
use zorite_editor::EditorState;

use super::palette::DocsPalette;
use super::state::{DocsFileKind, DocsMarkdownMode};
use crate::GhostexGpuiApp;
use crate::app::helpers::titlebar_tooltip;

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum DocsFormatMenu {
    #[default]
    None,
    Heading,
    Table,
}

impl GhostexGpuiApp {
    /// Runs a source edit on the open live editor, then gives it focus back.
    fn native_docs_edit(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
        f: impl FnOnce(&mut EditorState, &mut Context<EditorState>),
    ) {
        let Some(editor) = self
            .native_docs
            .active_document()
            .and_then(|document| document.live.clone())
        else {
            return;
        };
        editor.update(cx, |editor, cx| {
            f(editor, cx);
            editor.focus(window, cx);
        });
    }

    /// CDXC:Docs 2026-09-15 DECISION:
    /// User: the formatting bar floats near the bottom of the document with padding and rounded corners, so the Docs view no longer carries a tall stacked header, and it collapses to a single pill. The collapsed state is remembered across documents and restarts; Find keeps working from the pill because the panel stays mounted inside the bar.
    pub(crate) fn render_native_docs_format_bar(
        &mut self,
        p: &DocsPalette,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let document = self.native_docs.active_document()?;
        if document.kind != DocsFileKind::Markdown || document.live.is_none() {
            return None;
        }
        let live = document.mode == DocsMarkdownMode::Live;
        let path = document.path.clone();
        let collapsed = self.native_docs.format_bar_collapsed;
        let menu = self.native_docs.format_menu;
        let find_visible = self.native_docs_find_visible();
        let (constrain, numbers, git) = (
            self.native_docs.constrain_width,
            self.native_docs.line_numbers,
            self.native_docs.git_changes,
        );
        let (hover, text, muted, surface) = (p.control_hover, p.text, p.muted, p.row_surface);
        let button =
            move |id: &'static str, icon: &'static str, tooltip: &'static str, active: bool| {
                div()
                    .id(id)
                    .size(px(27.0))
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .rounded(px(4.0))
                    .cursor_pointer()
                    .when(active, |b| b.bg(surface))
                    .hover(move |b| b.bg(hover))
                    .child(svg().path(icon).size(px(18.0)).text_color(if active {
                        text
                    } else {
                        muted
                    }))
                    .tooltip(move |window, cx| titlebar_tooltip(tooltip, window, cx))
            };
        let separator = || {
            div()
                .w(px(1.0))
                .h(px(18.0))
                .mx(px(4.0))
                .flex_none()
                .bg(p.border)
        };
        let toggle = button(
            "docs-bar-toggle",
            if collapsed {
                "docs/l-type-17.svg"
            } else {
                "docs/l-chevron-down-17.svg"
            },
            if collapsed {
                "Show formatting bar"
            } else {
                "Hide formatting bar"
            },
            false,
        )
        .on_click(cx.listener(|this, _, _, cx| {
            this.native_docs.format_bar_collapsed = !this.native_docs.format_bar_collapsed;
            this.native_docs.format_menu = DocsFormatMenu::None;
            this.native_docs_persist_format_bar(cx);
            this.native_docs_notify(cx);
        }));
        let shell = div()
            .id("native-docs-format-bar")
            .relative()
            .h(px(37.0))
            .p(px(3.0))
            .flex()
            .items_center()
            .gap(px(8.0))
            .rounded(px(10.0))
            .bg(p.floating)
            .border_1()
            .border_color(p.border)
            .shadow_lg()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation());
        let shell = if collapsed {
            shell.child(toggle)
        } else {
            let format_group = div()
                .flex()
                .items_center()
                .gap(px(1.0))
                .child(
                    button(
                        "docs-fmt-heading",
                        "docs/l-heading-17.svg",
                        "Heading",
                        menu == DocsFormatMenu::Heading,
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.native_docs.format_menu =
                            if this.native_docs.format_menu == DocsFormatMenu::Heading {
                                DocsFormatMenu::None
                            } else {
                                DocsFormatMenu::Heading
                            };
                        this.native_docs_notify(cx);
                    })),
                )
                .child(
                    button(
                        "docs-fmt-bullet",
                        "docs/l-list-17.svg",
                        "Bullet List",
                        false,
                    )
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.native_docs_edit(window, cx, |e, cx| {
                            toggle_list(e, ListKind::Bullet, cx)
                        })
                    })),
                )
                .child(
                    button(
                        "docs-fmt-numbered",
                        "docs/l-list-ordered-17.svg",
                        "Numbered List",
                        false,
                    )
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.native_docs_edit(window, cx, |e, cx| {
                            toggle_list(e, ListKind::Numbered, cx)
                        })
                    })),
                )
                .child(
                    button("docs-fmt-task", "docs/l-list-todo-17.svg", "Task", false).on_click(
                        cx.listener(|this, _, window, cx| {
                            this.native_docs_edit(window, cx, |e, cx| {
                                toggle_list(e, ListKind::Task, cx)
                            })
                        }),
                    ),
                )
                .child(separator())
                .child(
                    button(
                        "docs-fmt-table",
                        "docs/l-table-2-17.svg",
                        "Table",
                        menu == DocsFormatMenu::Table,
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.native_docs.format_menu =
                            if this.native_docs.format_menu == DocsFormatMenu::Table {
                                DocsFormatMenu::None
                            } else {
                                DocsFormatMenu::Table
                            };
                        this.native_docs.table_hover = (0, 0);
                        this.native_docs_notify(cx);
                    })),
                )
                .child(
                    button("docs-fmt-code", "docs/l-code-17.svg", "Code Block", false).on_click(
                        cx.listener(|this, _, window, cx| {
                            this.native_docs_edit(window, cx, code_block)
                        }),
                    ),
                )
                .child(
                    button("docs-fmt-link", "docs/l-link-17.svg", "Link", false).on_click(
                        cx.listener(|this, _, window, cx| {
                            this.native_docs_edit(window, cx, |e, cx| {
                                wrap_link(e, LinkKind::Link, cx)
                            })
                        }),
                    ),
                )
                .child(
                    button(
                        "docs-fmt-wiki",
                        "docs/l-brackets-17.svg",
                        "Wiki Link",
                        false,
                    )
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.native_docs_edit(window, cx, |e, cx| wrap_link(e, LinkKind::Wiki, cx))
                    })),
                )
                .child(
                    button("docs-fmt-image", "docs/l-image-17.svg", "Image", false).on_click(
                        cx.listener(|this, _, window, cx| {
                            this.native_docs_edit(window, cx, |e, cx| {
                                wrap_link(e, LinkKind::Image, cx)
                            })
                        }),
                    ),
                )
                .child(
                    button("docs-fmt-quote", "docs/l-quote-17.svg", "Quote", false).on_click(
                        cx.listener(|this, _, window, cx| {
                            this.native_docs_edit(window, cx, toggle_quote)
                        }),
                    ),
                )
                .child(
                    button(
                        "docs-fmt-rule",
                        "docs/l-minus-17.svg",
                        "Horizontal Rule",
                        false,
                    )
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.native_docs_edit(window, cx, horizontal_rule)
                    })),
                );
            let right_group = div()
                .flex()
                .items_center()
                .gap(px(1.0))
                .child(
                    button(
                        "docs-fmt-find",
                        "docs/l-search-17.svg",
                        "Find and Replace",
                        find_visible,
                    )
                    .on_click(cx.listener(|this, _, window, cx| {
                        if this.native_docs_find_visible() {
                            this.native_docs_hide_find(window, cx);
                        } else {
                            this.native_docs_show_find(window, cx);
                        }
                    })),
                )
                .child(
                    button(
                        "docs-fmt-width",
                        "docs/l-panel-left-right-dashed-17.svg",
                        if constrain {
                            "Use Full Content Width"
                        } else {
                            "Constrain Content Width"
                        },
                        constrain,
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.native_docs.constrain_width = !this.native_docs.constrain_width;
                        this.native_docs_notify(cx);
                    })),
                )
                .child(
                    button(
                        "docs-fmt-lines",
                        "docs/l-hash-17.svg",
                        if numbers {
                            "Hide Line Numbers"
                        } else {
                            "Show Line Numbers"
                        },
                        numbers,
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.native_docs.line_numbers = !this.native_docs.line_numbers;
                        this.native_docs_notify(cx);
                    })),
                )
                .child(
                    button(
                        "docs-fmt-git",
                        "docs/l-git-compare-17.svg",
                        if git {
                            "Hide Git Changes"
                        } else {
                            "Show Git Changes"
                        },
                        git,
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.native_docs.git_changes = !this.native_docs.git_changes;
                        this.native_docs_notify(cx);
                    })),
                );
            let mode = div()
                .id("docs-fmt-mode")
                .h(px(27.0))
                .min_w(px(76.0))
                .px(px(8.0))
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(4.0))
                .bg(p.row_surface)
                .border_1()
                .border_color(p.border_strong)
                .text_size(px(12.0))
                .text_color(p.text)
                .cursor_pointer()
                .child(if live { "Live" } else { "Source" })
                .tooltip(move |window, cx| {
                    titlebar_tooltip(
                        if live {
                            "Switch to Source"
                        } else {
                            "Switch to Live"
                        },
                        window,
                        cx,
                    )
                })
                .on_click(
                    cx.listener(move |this, _, _, cx| this.native_docs_toggle_live(&path, cx)),
                );
            shell
                .child(format_group)
                .child(right_group)
                .child(mode)
                .child(toggle)
        };
        let shell = shell
            .when(menu == DocsFormatMenu::Heading && !collapsed, |bar| {
                bar.child(self.render_native_docs_heading_menu(p, cx))
            })
            .when(menu == DocsFormatMenu::Table && !collapsed, |bar| {
                bar.child(self.render_native_docs_table_menu(p, cx))
            })
            .children(self.render_native_docs_find(p, cx));
        Some(
            div()
                .absolute()
                .bottom(px(14.0))
                .left_0()
                .right_0()
                .flex()
                .justify_center()
                .child(shell)
                .into_any_element(),
        )
    }

    fn render_native_docs_heading_menu(
        &mut self,
        p: &DocsPalette,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        const ICONS: [&str; 6] = [
            "docs/l-heading-1-17.svg",
            "docs/l-heading-2-17.svg",
            "docs/l-heading-3-17.svg",
            "docs/l-heading-4-17.svg",
            "docs/l-heading-5-17.svg",
            "docs/l-heading-6-17.svg",
        ];
        let (hover, text) = (p.control_hover, p.text);
        popover(p)
            .flex()
            .flex_col()
            .gap(px(3.0))
            .w(px(170.0))
            .children((1..=6u8).map(|level| {
                div()
                    .id(("docs-heading-level", level as usize))
                    .h(px(30.0))
                    .px(px(9.0))
                    .flex()
                    .items_center()
                    .gap(px(9.0))
                    .rounded(px(6.0))
                    .cursor_pointer()
                    .text_size(px(12.5))
                    .text_color(text.opacity(0.88))
                    .hover(move |row| row.bg(hover))
                    .child(
                        svg()
                            .path(ICONS[level as usize - 1])
                            .size(px(15.0))
                            .text_color(text.opacity(0.72)),
                    )
                    .child(format!("Heading {level}"))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.native_docs.format_menu = DocsFormatMenu::None;
                        this.native_docs_edit(window, cx, |e, cx| set_heading(e, level, cx));
                    }))
            }))
            .into_any_element()
    }

    fn render_native_docs_table_menu(
        &mut self,
        p: &DocsPalette,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let (hover_c, hover_r) = self.native_docs.table_hover;
        let label = if hover_c == 0 {
            "Insert table".to_string()
        } else {
            format!("{hover_c} x {hover_r}")
        };
        let text = p.text;
        let mut grid = div().flex().flex_col().gap(px(2.0));
        for r in 1..=5usize {
            let mut row = div().flex().gap(px(2.0));
            for c in 1..=5usize {
                let lit = c <= hover_c && r <= hover_r;
                row = row.child(
                    div()
                        .id(("docs-table-cell", r * 10 + c))
                        .size(px(16.0))
                        .rounded(px(3.0))
                        .border_1()
                        .border_color(text.opacity(if lit { 0.5 } else { 0.16 }))
                        .when(lit, |cell| cell.bg(text.opacity(0.14)))
                        .cursor_pointer()
                        .on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
                            if *hovered {
                                this.native_docs.table_hover = (c, r);
                                this.native_docs_notify(cx);
                            }
                        }))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.native_docs.format_menu = DocsFormatMenu::None;
                            this.native_docs_edit(window, cx, |e, cx| insert_table(e, c, r, cx));
                        })),
                );
            }
            grid = grid.child(row);
        }
        popover(p)
            .left(px(100.0))
            .flex()
            .flex_col()
            .gap(px(6.0))
            .child(grid)
            .child(div().text_size(px(11.0)).text_color(p.muted).child(label))
            .into_any_element()
    }
}

fn popover(p: &DocsPalette) -> gpui::Div {
    div()
        .absolute()
        .bottom(px(43.0))
        .left(px(0.0))
        .p(px(6.0))
        .rounded(px(8.0))
        .bg(p.raised)
        .border_1()
        .border_color(p.border_strong)
        .shadow_lg()
}

// ---- source edits -------------------------------------------------------------------------

/// Byte range of the whole lines the selection touches (without the final newline).
fn line_span(text: &str, selection: &Range<usize>) -> Range<usize> {
    let start = text[..selection.start].rfind('\n').map_or(0, |i| i + 1);
    let end_probe = if selection.end > selection.start && text[..selection.end].ends_with('\n') {
        selection.end - 1
    } else {
        selection.end
    };
    let end = text[end_probe..]
        .find('\n')
        .map_or(text.len(), |i| end_probe + i);
    start..end.max(start)
}

/// Replaces every line in the selection with `f(line, index)`, keeping the lines selected.
fn map_lines(
    editor: &mut EditorState,
    cx: &mut Context<EditorState>,
    f: impl Fn(&str, usize) -> String,
) {
    let text = editor.text().to_string();
    let selection = editor.selected_range();
    let span = line_span(&text, &selection);
    let mapped = text[span.clone()]
        .split('\n')
        .enumerate()
        .map(|(i, line)| f(line, i))
        .collect::<Vec<_>>()
        .join("\n");
    let new_end = span.start + mapped.len();
    editor.replace_range(span.clone(), &mapped, cx);
    if selection.is_empty() {
        editor.set_cursor(new_end, cx);
    } else {
        editor.select_range(span.start..new_end, cx);
    }
}

fn strip_heading(line: &str) -> (usize, &str) {
    let hashes = line.bytes().take_while(|b| *b == b'#').count();
    if (1..=6).contains(&hashes) && line[hashes..].starts_with(' ') {
        (hashes, &line[hashes + 1..])
    } else {
        (0, line)
    }
}

fn set_heading(editor: &mut EditorState, level: u8, cx: &mut Context<EditorState>) {
    map_lines(editor, cx, |line, _| {
        let (current, rest) = strip_heading(line);
        if current == level as usize {
            rest.to_string()
        } else {
            format!("{} {rest}", "#".repeat(level as usize))
        }
    });
}

#[derive(Clone, Copy, PartialEq)]
enum ListKind {
    Bullet,
    Numbered,
    Task,
}

fn strip_list(line: &str) -> (Option<ListKind>, &str, &str) {
    let indent_len = line.len() - line.trim_start().len();
    let (indent, body) = line.split_at(indent_len);
    for prefix in ["- [ ] ", "- [x] ", "- [X] "] {
        if let Some(rest) = body.strip_prefix(prefix) {
            return (Some(ListKind::Task), indent, rest);
        }
    }
    for prefix in ["- ", "* ", "+ "] {
        if let Some(rest) = body.strip_prefix(prefix) {
            return (Some(ListKind::Bullet), indent, rest);
        }
    }
    let digits = body.bytes().take_while(u8::is_ascii_digit).count();
    if digits > 0 && body[digits..].starts_with(". ") {
        return (Some(ListKind::Numbered), indent, &body[digits + 2..]);
    }
    (None, indent, body)
}

fn toggle_list(editor: &mut EditorState, kind: ListKind, cx: &mut Context<EditorState>) {
    let text = editor.text().to_string();
    let span = line_span(&text, &editor.selected_range());
    let all_same = text[span]
        .split('\n')
        .all(|line| strip_list(line).0 == Some(kind));
    map_lines(editor, cx, |line, index| {
        let (_, indent, body) = strip_list(line);
        if all_same {
            format!("{indent}{body}")
        } else {
            match kind {
                ListKind::Bullet => format!("{indent}- {body}"),
                ListKind::Numbered => format!("{indent}{}. {body}", index + 1),
                ListKind::Task => format!("{indent}- [ ] {body}"),
            }
        }
    });
}

fn toggle_quote(editor: &mut EditorState, cx: &mut Context<EditorState>) {
    let text = editor.text().to_string();
    let span = line_span(&text, &editor.selected_range());
    let all_quoted = text[span].split('\n').all(|line| line.starts_with('>'));
    map_lines(editor, cx, |line, _| {
        if all_quoted {
            line.strip_prefix("> ")
                .or_else(|| line.strip_prefix('>'))
                .unwrap_or(line)
                .to_string()
        } else {
            format!("> {line}")
        }
    });
}

fn code_block(editor: &mut EditorState, cx: &mut Context<EditorState>) {
    let text = editor.text().to_string();
    let selection = editor.selected_range();
    if selection.is_empty() {
        let line = line_span(&text, &selection);
        let at = line.end;
        let lead = if text[line].trim().is_empty() {
            ""
        } else {
            "\n"
        };
        let insert = format!("{lead}```\n\n```");
        editor.replace_range(at..at, &insert, cx);
        editor.set_cursor(at + lead.len() + 4, cx);
    } else {
        let span = line_span(&text, &selection);
        let wrapped = format!("```\n{}\n```", &text[span.clone()]);
        editor.replace_range(span.clone(), &wrapped, cx);
        editor.set_cursor(span.start + 3, cx);
    }
}

#[derive(Clone, Copy)]
enum LinkKind {
    Link,
    Wiki,
    Image,
}

fn wrap_link(editor: &mut EditorState, kind: LinkKind, cx: &mut Context<EditorState>) {
    let selection = editor.selected_range();
    let label = editor.text()[selection.clone()].to_string();
    let (insert, select) = match kind {
        LinkKind::Link => {
            let insert = format!("[{label}](url)");
            let url = insert.len() - 4..insert.len() - 1;
            (insert, if label.is_empty() { 1..1 } else { url })
        }
        LinkKind::Wiki => {
            let insert = format!("[[{label}]]");
            let caret = 2 + label.len();
            (insert, caret..caret)
        }
        LinkKind::Image => {
            let insert = format!("![{label}](path)");
            let path = insert.len() - 5..insert.len() - 1;
            (insert, path)
        }
    };
    editor.replace_range(selection.clone(), &insert, cx);
    editor.select_range(
        selection.start + select.start..selection.start + select.end,
        cx,
    );
}

fn horizontal_rule(editor: &mut EditorState, cx: &mut Context<EditorState>) {
    let text = editor.text().to_string();
    let line = line_span(&text, &editor.selected_range());
    let at = line.end;
    let insert = if text[line].trim().is_empty() {
        "---\n".to_string()
    } else {
        "\n\n---\n".to_string()
    };
    editor.replace_range(at..at, &insert, cx);
    editor.set_cursor(at + insert.len(), cx);
}

fn insert_table(
    editor: &mut EditorState,
    columns: usize,
    rows: usize,
    cx: &mut Context<EditorState>,
) {
    let text = editor.text().to_string();
    let line = line_span(&text, &editor.selected_range());
    let at = line.end;
    let header = (1..=columns)
        .map(|c| format!("Column {c}"))
        .collect::<Vec<_>>()
        .join(" | ");
    let rule = vec!["---"; columns].join(" | ");
    let body = (0..rows.saturating_sub(1).max(1))
        .map(|_| vec!["   "; columns].join(" | "))
        .map(|row| format!("| {row} |"))
        .collect::<Vec<_>>()
        .join("\n");
    let lead = if text[line].trim().is_empty() {
        ""
    } else {
        "\n\n"
    };
    let insert = format!("{lead}| {header} |\n| {rule} |\n{body}\n");
    editor.replace_range(at..at, &insert, cx);
    editor.set_cursor(at + lead.len() + 2, cx);
}

/// Wraps the live editor's selection in inline markers (the selection toolbar's formatting mode),
/// or removes them when the selection already has them.
pub(crate) fn wrap_inline(
    editor: &Entity<EditorState>,
    before: &str,
    after: &str,
    cx: &mut gpui::App,
) {
    editor.update(cx, |editor, cx| {
        let selection = editor.selected_range();
        let selected = editor.text()[selection.clone()].to_string();
        let replacement = if selected.len() >= before.len() + after.len()
            && selected.starts_with(before)
            && selected.ends_with(after)
        {
            selected[before.len()..selected.len() - after.len()].to_string()
        } else {
            format!("{before}{selected}{after}")
        };
        let len = replacement.len();
        editor.replace_range(selection.clone(), &replacement, cx);
        editor.select_range(selection.start..selection.start + len, cx);
    });
}
