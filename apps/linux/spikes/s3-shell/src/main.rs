//! A libadwaita window over the headless core: notes and search from `composition-core-spike`, a GtkSourceView editor, and
//! the desktop's own note preview in a WebKitGTK view that is served from `app://composition/`, the same address the
//! Electron app uses, so the web app's image URLs work unchanged.
//!
//! A spike, not an app: no autosave, no frontmatter parsing, no menus beyond About. It exists to find out what GTK, libadwaita
//! and WebKitGTK actually do (see RESULT.md).

use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::Duration;

use adw::prelude::*;
use composition_core_spike::backup::is_image_name;
use composition_core_spike::pass;
use composition_core_spike::search::{SearchIndex, Tolerance};
use gtk::{gdk, gio, glib, graphene};
use sourceview5::prelude::*;
use webkit6::prelude::*;

struct Args {
    data_dir: PathBuf,
    preview_dir: PathBuf,
    note: Option<i64>,
    screenshot: Option<PathBuf>,
    scheme: Option<String>,
    layout: String,
    size: (i32, i32),
    quit_after: Option<u64>,
    query: Option<String>,
    no_preview: bool,
    scroll: i32,
}

fn parse_args() -> Args {
    let mut a = Args {
        data_dir: PathBuf::from(std::env::var("COMPOSITION_DATA_DIR").unwrap_or_else(|_| "/data".into())),
        preview_dir: PathBuf::from(std::env::var("COMPOSITION_PREVIEW_DIR").unwrap_or_else(|_| "/preview".into())),
        note: None,
        screenshot: None,
        scheme: None,
        layout: "split".into(),
        size: (1180, 760),
        quit_after: None,
        query: None,
        no_preview: false,
        scroll: 0,
    };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let mut value = || it.next().unwrap_or_default();
        match flag.as_str() {
            "--data-dir" => a.data_dir = value().into(),
            "--preview-dir" => a.preview_dir = value().into(),
            "--note" => a.note = value().parse().ok(),
            "--screenshot" => a.screenshot = Some(value().into()),
            "--scheme" => a.scheme = Some(value()),
            "--layout" => a.layout = value(),
            "--size" => {
                let v = value();
                if let Some((w, h)) = v.split_once('x') {
                    a.size = (w.parse().unwrap_or(1180), h.parse().unwrap_or(760));
                }
            }
            "--quit-after-ms" => a.quit_after = value().parse().ok(),
            "--query" => a.query = Some(value()),
            "--no-preview" => a.no_preview = true,
            "--scroll" => a.scroll = value().parse().unwrap_or(0),
            other => eprintln!("ignoring {other}"),
        }
    }
    a
}

#[derive(Clone)]
struct NoteRow {
    id: i64,
    title: String,
    updated_at: String,
}

fn strip_frontmatter(content: &str) -> &str {
    // The real thing is the port of frontmatter.ts (js-yaml rules); a spike only needs the body.
    if let Some(rest) = content.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---\n") {
            return &rest[end + 5..];
        }
    }
    content
}

fn content_type(name: &str) -> &'static str {
    match name.rsplit('.').next().map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

/// `app://composition/<path>`: the preview's own files, and the stored images at `app_data/<name>`. Only a name the core would
/// itself accept (`is_image_name`) is ever read from the data folder.
fn serve(request: &webkit6::URISchemeRequest, preview_dir: &Path, data_dir: &Path) {
    let path = request.path().map(|p| p.to_string()).unwrap_or_default();
    let path = path.trim_start_matches('/');
    let file = if path.is_empty() || path == "index.html" {
        Some(preview_dir.join("index.html"))
    } else if let Some(name) = path.strip_prefix("app_data/") {
        is_image_name(name).then(|| data_dir.join("app_data").join(name))
    } else if matches!(path, "preview.js" | "preview.css") {
        Some(preview_dir.join(path))
    } else {
        None
    };
    match file.and_then(|f| std::fs::read(&f).ok().map(|bytes| (f, bytes))) {
        Some((f, bytes)) => {
            let len = bytes.len() as i64;
            let stream = gio::MemoryInputStream::from_bytes(&glib::Bytes::from_owned(bytes));
            request.finish(&stream, len, Some(content_type(&f.to_string_lossy())));
        }
        None => request.finish_error(&mut glib::Error::new(gio::IOErrorEnum::NotFound, &format!("not found: {path}"))),
    }
}

fn save_png(widget: &impl IsA<gtk::Widget>, path: &Path) -> Result<(), String> {
    let widget = widget.as_ref();
    let paintable = gtk::WidgetPaintable::new(Some(widget));
    let (w, h) = (widget.width() as f32, widget.height() as f32);
    let snapshot = gtk::Snapshot::new();
    paintable.snapshot(&snapshot, w as f64, h as f64);
    let node = snapshot.to_node().ok_or("nothing was drawn")?;
    let native = widget.native().ok_or("not realized")?;
    let renderer = native.renderer().ok_or("no renderer")?;
    let texture = renderer.render_texture(&node, Some(&graphene::Rect::new(0.0, 0.0, w, h)));
    texture.save_to_png(path).map_err(|e| e.to_string())
}

fn main() -> glib::ExitCode {
    let args = Rc::new(parse_args());
    let app = adw::Application::builder().application_id("com.rushinglabs.CompositionShellSpike").flags(gio::ApplicationFlags::NON_UNIQUE).build();
    let a = args.clone();
    app.connect_activate(move |app| build(app, a.clone()));
    app.run_with_args::<&str>(&[])
}

fn build(app: &adw::Application, args: Rc<Args>) {
    sourceview5::init();
    if let Some(scheme) = &args.scheme {
        adw::StyleManager::default().set_color_scheme(match scheme.as_str() {
            "dark" => adw::ColorScheme::ForceDark,
            "light" => adw::ColorScheme::ForceLight,
            _ => adw::ColorScheme::Default,
        });
    }

    // --- The core: the database, and a search index over it ------------------------------------------------------------
    let db = Rc::new(pass::open(&args.data_dir.join("composition.db")).expect("open the database"));
    let index_path = std::env::temp_dir().join(format!("composition-spike-search-{}.db", std::process::id()));
    let _ = std::fs::remove_file(&index_path);
    let index = Rc::new(RefCell::new(SearchIndex::open(&index_path, Tolerance::Forgiving).expect("search index")));
    let indexed = index.borrow_mut().rebuild_from(&db).expect("index");
    let notes: Rc<Vec<NoteRow>> = Rc::new({
        let mut stmt = db.prepare("SELECT id, title, updated_at FROM notes ORDER BY updated_at DESC, id DESC").unwrap();
        stmt.query_map([], |r| Ok(NoteRow { id: r.get(0)?, title: r.get(1)?, updated_at: r.get(2)? })).unwrap().map(|r| r.unwrap()).collect()
    });
    eprintln!("spike: {} notes, {} indexed", notes.len(), indexed);

    // --- The preview: WebKitGTK serving the desktop's own renderer -----------------------------------------------------------
    let ucm = webkit6::UserContentManager::new();
    ucm.register_script_message_handler("composition", None);
    let webview: Option<webkit6::WebView> = if args.no_preview {
        None
    } else {
        let context = webkit6::WebContext::new();
        let (pd, dd) = (args.preview_dir.clone(), args.data_dir.clone());
        context.register_uri_scheme("app", move |request| serve(request, &pd, &dd));
        let view = webkit6::WebView::builder().web_context(&context).user_content_manager(&ucm).hexpand(true).vexpand(true).build();
        if let Some(settings) = webkit6::prelude::WebViewExt::settings(&view) {
            settings.set_enable_developer_extras(true);
            settings.set_enable_back_forward_navigation_gestures(false);
        }
        view.set_background_color(&gdk::RGBA::new(0.07, 0.07, 0.07, 1.0));
        view.load_uri("app://composition/index.html");
        Some(view)
    };
    let run_js = {
        let webview = webview.clone();
        move |script: &str| {
            if let Some(w) = &webview {
                w.evaluate_javascript(script, None, None, gio::Cancellable::NONE, |_| {});
            }
        }
    };
    let preview_widget: gtk::Widget = match &webview {
        Some(w) => w.clone().upcast(),
        None => gtk::Label::builder().label("Preview is off for this run (--no-preview).").css_classes(["dim-label"]).hexpand(true).build().upcast(),
    };

    // --- The editor: GtkSourceView -----------------------------------------------------------------------------------------
    let buffer = sourceview5::Buffer::new(None);
    buffer.set_language(sourceview5::LanguageManager::default().language("markdown").as_ref());
    buffer.set_highlight_syntax(true);
    let editor = sourceview5::View::with_buffer(&buffer);
    editor.set_monospace(true);
    editor.set_wrap_mode(gtk::WrapMode::WordChar);
    editor.set_auto_indent(true);
    editor.set_tab_width(2);
    editor.set_indent_on_tab(true);
    editor.set_top_margin(12);
    editor.set_bottom_margin(12);
    editor.set_left_margin(14);
    editor.set_right_margin(14);
    let editor_scroll = gtk::ScrolledWindow::builder().child(&editor).hexpand(true).vexpand(true).build();

    let apply_scheme = {
        let buffer = buffer.clone();
        let webview = webview.clone();
        let run_js = run_js.clone();
        move || {
            let dark = adw::StyleManager::default().is_dark();
            let scheme = sourceview5::StyleSchemeManager::default().scheme(if dark { "Adwaita-dark" } else { "Adwaita" });
            buffer.set_style_scheme(scheme.as_ref());
            let theme = if dark { "dark" } else { "light" };
            run_js(&format!("window.composition && window.composition.setTheme('{theme}')"));
            let bg = if dark { gdk::RGBA::new(0.07, 0.07, 0.07, 1.0) } else { gdk::RGBA::new(0.969, 0.969, 0.957, 1.0) };
            if let Some(w) = &webview {
                w.set_background_color(&bg);
            }
        }
    };
    apply_scheme();
    adw::StyleManager::default().connect_dark_notify({
        let apply = apply_scheme.clone();
        move |_| apply()
    });

    // Re-render the preview 150 ms after typing stops; a generation number drops a render that a newer edit has passed.
    let generation = Rc::new(Cell::new(0u64));
    let page_ready = Rc::new(Cell::new(false));
    let render = {
        let (buffer, run_js, generation, page_ready) = (buffer.clone(), run_js.clone(), generation.clone(), page_ready.clone());
        move || {
            let n = generation.get() + 1;
            generation.set(n);
            let (buffer, run_js, generation, page_ready) = (buffer.clone(), run_js.clone(), generation.clone(), page_ready.clone());
            glib::timeout_add_local_once(Duration::from_millis(150), move || {
                if generation.get() != n || !page_ready.get() {
                    return;
                }
                let text = buffer.text(&buffer.start_iter(), &buffer.end_iter(), false).to_string();
                let body = serde_json::Value::String(strip_frontmatter(&text).to_string());
                run_js(&format!("window.composition.render({body})"));
            });
        }
    };
    buffer.connect_changed({
        let render = render.clone();
        move |_| render()
    });

    // --- The sidebar: the note list and search ------------------------------------------------------------------------------
    let list = gtk::ListBox::builder().selection_mode(gtk::SelectionMode::Single).css_classes(["navigation-sidebar"]).build();
    let rows: Rc<RefCell<Vec<(i64, adw::ActionRow)>>> = Rc::new(RefCell::new(vec![]));
    for n in notes.iter() {
        let row = adw::ActionRow::builder().title(glib::markup_escape_text(&n.title)).subtitle(n.updated_at.get(..10).unwrap_or("")).activatable(true).build();
        row.set_title_lines(1);
        list.append(&row);
        rows.borrow_mut().push((n.id, row));
    }
    let search = gtk::SearchEntry::builder().placeholder_text("Search notes").hexpand(true).build();
    let visible: Rc<RefCell<Option<Vec<i64>>>> = Rc::new(RefCell::new(None));
    list.set_filter_func({
        let (rows, visible) = (rows.clone(), visible.clone());
        move |row| {
            let Some(ids) = &*visible.borrow() else { return true };
            rows.borrow().iter().any(|(id, r)| r.upcast_ref::<gtk::ListBoxRow>() == row && ids.contains(id))
        }
    });
    let run_search = {
        let (index, visible, list) = (index.clone(), visible.clone(), list.clone());
        move |query: &str| {
            let started = std::time::Instant::now();
            *visible.borrow_mut() = if query.trim().is_empty() { None } else { Some(index.borrow().search(query).unwrap_or_default()) };
            list.invalidate_filter();
            eprintln!("spike: search {query:?} in {:.2} ms", started.elapsed().as_secs_f64() * 1000.0);
        }
    };
    search.connect_search_changed({
        let run = run_search.clone();
        move |s| run(&s.text())
    });
    if let Some(q) = &args.query {
        search.set_text(q);
        run_search(q);
    }

    let sidebar_header = adw::HeaderBar::new();
    sidebar_header.set_title_widget(Some(&adw::WindowTitle::new("Notes", "")));
    let menu = gio::Menu::new();
    menu.append(Some("About Composition"), Some("win.about"));
    let menu_button = gtk::MenuButton::builder().icon_name("open-menu-symbolic").menu_model(&menu).primary(true).tooltip_text("Main Menu").build();
    sidebar_header.pack_end(&menu_button);
    let search_bar = gtk::Box::builder().margin_start(8).margin_end(8).margin_bottom(6).build();
    search_bar.append(&search);
    let sidebar_scroll = gtk::ScrolledWindow::builder().child(&list).vexpand(true).hscrollbar_policy(gtk::PolicyType::Never).build();
    let sidebar_body = gtk::Box::new(gtk::Orientation::Vertical, 0);
    sidebar_body.append(&search_bar);
    sidebar_body.append(&sidebar_scroll);
    let sidebar_toolbar = adw::ToolbarView::new();
    sidebar_toolbar.add_top_bar(&sidebar_header);
    sidebar_toolbar.set_content(Some(&sidebar_body));
    let sidebar_page = adw::NavigationPage::builder().title("Notes").child(&sidebar_toolbar).build();

    // --- The content: a title, three layouts, and the editor and preview in a pane ---------------------------------------
    let title = adw::WindowTitle::new("Composition", "");
    let content_header = adw::HeaderBar::new();
    content_header.set_title_widget(Some(&title));
    let layouts = gtk::Box::builder().css_classes(["linked"]).build();
    let (b_md, b_pre, b_split) = (gtk::ToggleButton::with_label("Markdown"), gtk::ToggleButton::with_label("Preview"), gtk::ToggleButton::with_label("Split"));
    b_pre.set_group(Some(&b_md));
    b_split.set_group(Some(&b_md));
    for b in [&b_md, &b_pre, &b_split] {
        layouts.append(b);
    }
    content_header.pack_start(&layouts);
    let paned = gtk::Paned::builder().start_child(&editor_scroll).end_child(&preview_widget).resize_start_child(true).resize_end_child(true).shrink_start_child(false).shrink_end_child(false).build();
    let set_layout = {
        let (paned, editor_scroll, preview_widget, args) = (paned.clone(), editor_scroll.clone(), preview_widget.clone(), args.clone());
        move |layout: &str| {
            editor_scroll.set_visible(layout != "preview");
            preview_widget.set_visible(layout != "markdown");
            if layout == "split" {
                // The content pane is the window less the sidebar (about 300 px); the paned has no width yet when this first runs.
                paned.set_position(((args.size.0 - 300) / 2).max(200));
            }
        }
    };
    for (button, name) in [(&b_md, "markdown"), (&b_pre, "preview"), (&b_split, "split")] {
        let set = set_layout.clone();
        button.connect_toggled(move |b| {
            if b.is_active() {
                set(name)
            }
        });
    }
    match args.layout.as_str() {
        "markdown" => b_md.set_active(true),
        "preview" => b_pre.set_active(true),
        _ => b_split.set_active(true),
    }
    let content_toolbar = adw::ToolbarView::new();
    content_toolbar.add_top_bar(&content_header);
    content_toolbar.set_content(Some(&paned));
    let content_page = adw::NavigationPage::builder().title("Note").child(&content_toolbar).build();

    let split = adw::NavigationSplitView::new();
    split.set_sidebar(Some(&sidebar_page));
    split.set_content(Some(&content_page));
    split.set_min_sidebar_width(230.0);
    split.set_max_sidebar_width(340.0);
    let window = adw::ApplicationWindow::builder().application(app).title("Composition (native spike)").default_width(args.size.0).default_height(args.size.1).content(&split).build();
    window.set_size_request(360, 300);

    // Opening a note.
    let open = {
        let (db, buffer, title) = (db.clone(), buffer.clone(), title.clone());
        move |id: i64| {
            if let Ok((t, content)) = db.query_row("SELECT title, content FROM notes WHERE id = ?1", [id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
                title.set_title(&t);
                buffer.set_text(&content);
                buffer.place_cursor(&buffer.start_iter());
            }
        }
    };
    list.connect_row_selected({
        let (rows, open, split) = (rows.clone(), open.clone(), split.clone());
        move |_, row| {
            if let Some(row) = row {
                if let Some((id, _)) = rows.borrow().iter().find(|(_, r)| r.upcast_ref::<gtk::ListBoxRow>() == row) {
                    open(*id);
                    split.set_show_content(true);
                }
            }
        }
    });

    // The page tells the shell when it is ready, and when a note link was clicked.
    let screenshot_done = Rc::new(Cell::new(false));
    ucm.connect_script_message_received(Some("composition"), {
        let (page_ready, render, run_js, window, args, screenshot_done) = (page_ready.clone(), render.clone(), run_js.clone(), window.clone(), args.clone(), screenshot_done.clone());
        move |_, value| {
            let json = value.to_json(0).map(|s| s.to_string()).unwrap_or_default();
            let message: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
            match message["type"].as_str() {
                Some("ready") => {
                    page_ready.set(true);
                    run_js(&format!("window.composition.setTheme('{}')", if adw::StyleManager::default().is_dark() { "dark" } else { "light" }));
                    render();
                }
                Some("rendered") => {
                    eprintln!("spike: preview rendered, {} headings", message["headings"]);
                    if let Some(path) = args.screenshot.clone() {
                        if !screenshot_done.replace(true) {
                            let window = window.clone();
                            if args.scroll > 0 {
                                // The first "rendered" is the empty page; scroll once the note's own render has landed.
                                let (run_js, y) = (run_js.clone(), args.scroll);
                                glib::timeout_add_local_once(Duration::from_millis(900), move || run_js(&format!("window.scrollTo(0, {y})")));
                            }
                            glib::timeout_add_local_once(Duration::from_millis(3000), move || {
                                match save_png(&window, &path) {
                                    Ok(()) => eprintln!("spike: wrote {}", path.display()),
                                    Err(e) => eprintln!("spike: screenshot failed: {e}"),
                                }
                                std::process::exit(0);
                            });
                        }
                    }
                }
                Some("open-note") => eprintln!("spike: the page asked to open note {}", message["noteId"]),
                _ => {}
            }
        }
    });

    let about = gio::SimpleAction::new("about", None);
    about.connect_activate({
        let window = window.clone();
        move |_, _| {
            adw::AboutDialog::builder().application_name("Composition").version("native spike").developer_name("Rushing Labs").comments("A spike, not an app.").build().present(Some(&window));
        }
    });
    window.add_action(&about);
    let quit = gio::SimpleAction::new("quit", None);
    quit.connect_activate({
        let app = app.clone();
        move |_, _| app.quit()
    });
    app.add_action(&quit);
    app.set_accels_for_action("app.quit", &["<Ctrl>q"]);
    app.set_accels_for_action("win.about", &["<Ctrl>comma"]);

    if let Some(id) = args.note.or_else(|| notes.first().map(|n| n.id)) {
        // Select the row, which opens the note.
        if let Some((_, row)) = rows.borrow().iter().find(|(i, _)| *i == id) {
            list.select_row(Some(row.upcast_ref::<gtk::ListBoxRow>()));
        }
    }
    if args.no_preview {
        if let Some(path) = args.screenshot.clone() {
            let window = window.clone();
            glib::timeout_add_local_once(Duration::from_millis(1500), move || {
                match save_png(&window, &path) {
                    Ok(()) => eprintln!("spike: wrote {}", path.display()),
                    Err(e) => eprintln!("spike: screenshot failed: {e}"),
                }
                std::process::exit(0);
            });
        }
    }
    if let Some(ms) = args.quit_after {
        glib::timeout_add_local_once(Duration::from_millis(ms), || std::process::exit(0));
    }
    window.connect_realize(|w| {
        let display = WidgetExt::display(w);
        let surface = w.native().and_then(|n| n.surface());
        eprintln!(
            "spike: display {}, window scale {} (surface scale {:?}), renderer {:?}, dark {}, decorated {}",
            display.type_().name(),
            w.scale_factor(),
            surface.as_ref().map(|s| s.scale()),
            w.native().and_then(|n| n.renderer()).map(|r| r.type_().name().to_string()),
            adw::StyleManager::default().is_dark(),
            w.is_decorated()
        );
    });
    window.present();
}
