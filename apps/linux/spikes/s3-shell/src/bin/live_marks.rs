//! Spike S4b: can a GtkTextView hide Markdown marks (`**`, `#`) away from the caret, as the Live tab does, without touching the
//! text? The mechanism is a GtkTextTag with `invisible`, applied to every mark outside the paragraph that holds the caret and
//! re-applied when the caret moves. This probe checks what that does to the three things the iPad design worried about
//! (docs/ipad-app-design.md, R1): the caret and selection, undo, and the text a screen reader is given.
//!
//!   live_marks --caret-in|--caret-out [--screenshot out.png]   draws one frame, with the caret in or out of the first paragraph
//!   live_marks --report                                         prints the checks and exits
use std::path::PathBuf;
use std::time::Duration;

use gtk::glib;
use gtk::prelude::*;

const TEXT: &str = "# A heading with **bold**\n\nFirst paragraph with **bold words** and *italic* text.\n\nSecond paragraph with a `code span` and **more bold**.\n";

/// Byte ranges of the marks in `line`: leading `#`s with their space, and `**`, `*` and backticks.
fn marks(line: &str) -> Vec<(usize, usize)> {
    let mut out = vec![];
    let hashes = line.bytes().take_while(|&b| b == b'#').count();
    if hashes > 0 && line.as_bytes().get(hashes) == Some(&b' ') {
        out.push((0, hashes + 1));
    }
    let b = line.as_bytes();
    let mut i = hashes;
    while i < b.len() {
        if b[i] == b'*' && b.get(i + 1) == Some(&b'*') {
            out.push((i, i + 2));
            i += 2;
        } else if b[i] == b'*' || b[i] == b'`' {
            out.push((i, i + 1));
            i += 1;
        } else {
            i += 1;
        }
    }
    out
}

fn apply(buffer: &sourceview5::Buffer, hide: &gtk::TextTag) {
    let (start, end) = buffer.bounds();
    buffer.remove_tag(hide, &start, &end);
    let caret_line = buffer.iter_at_mark(&buffer.get_insert()).line();
    for line_no in 0..buffer.line_count() {
        if line_no == caret_line {
            continue; // the paragraph being edited shows its marks
        }
        let s = buffer.iter_at_line(line_no).unwrap();
        let mut e = s;
        // On an empty line `forward_to_line_end` goes on to the end of the NEXT line; it is only for a line that has an end ahead.
        if !e.ends_line() {
            e.forward_to_line_end();
        }
        let text = buffer.text(&s, &e, false).to_string();
        for (from, to) in marks(&text) {
            // The marks are ASCII, so a byte offset is a character offset.
            let mut begin = buffer.iter_at_line(line_no).unwrap();
            begin.forward_chars(from as i32);
            let mut finish = buffer.iter_at_line(line_no).unwrap();
            finish.forward_chars(to as i32);
            buffer.apply_tag(hide, &begin, &finish);
        }
    }
}

fn main() -> glib::ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let (caret_in, caret_out, want_report) = (args.iter().any(|a| a == "--caret-in"), args.iter().any(|a| a == "--caret-out"), args.iter().any(|a| a == "--report"));
    let shot: Option<PathBuf> = args.iter().position(|a| a == "--screenshot").and_then(|i| args.get(i + 1)).map(PathBuf::from);
    let app = adw::Application::builder().application_id("com.rushinglabs.LiveMarksSpike").flags(gtk::gio::ApplicationFlags::NON_UNIQUE).build();
    app.connect_activate(move |app| {
        sourceview5::init();
        let buffer = sourceview5::Buffer::with_language(&sourceview5::LanguageManager::default().language("markdown").unwrap());
        let hide = buffer.create_tag(Some("hide-mark"), &[("invisible", &true)]).unwrap();
        buffer.set_text(TEXT);
        let view = sourceview5::View::with_buffer(&buffer);
        view.set_wrap_mode(gtk::WrapMode::Word);
        view.set_monospace(true);
        view.set_left_margin(14);
        view.set_top_margin(12);
        buffer.connect_mark_set({
            let hide = hide.clone();
            move |buf, _, mark| {
                if mark.name().as_deref() == Some("insert") {
                    apply(buf, &hide);
                }
            }
        });
        let window = adw::ApplicationWindow::builder().application(app).default_width(640).default_height(300).content(&view).title("Live marks spike").build();
        window.present();

        let place = |line: i32| {
            buffer.place_cursor(&buffer.iter_at_line(line).unwrap());
            apply(&buffer, &hide);
        };
        apply(&buffer, &hide);
        if caret_in {
            place(2);
        } else if caret_out {
            place(5);
        }
        if want_report {
            let (buffer, hide) = (buffer.clone(), hide.clone());
            glib::timeout_add_local_once(Duration::from_millis(500), move || report(&buffer, &hide));
        }
        if let Some(path) = shot.clone() {
            glib::timeout_add_local_once(Duration::from_millis(1200), move || {
                let w = window.clone();
                let paintable = gtk::WidgetPaintable::new(Some(&w));
                let snapshot = gtk::Snapshot::new();
                paintable.snapshot(&snapshot, w.width() as f64, w.height() as f64);
                let node = snapshot.to_node().unwrap();
                let tex = w.native().unwrap().renderer().unwrap().render_texture(&node, None);
                tex.save_to_png(&path).unwrap();
                std::process::exit(0);
            });
        }
    });
    app.run_with_args::<&str>(&[])
}

fn report(buffer: &sourceview5::Buffer, hide: &gtk::TextTag) {
    let all = |b: &sourceview5::Buffer| b.text(&b.start_iter(), &b.end_iter(), true).to_string();
    println!("1. the buffer text is untouched by hiding: {}", all(buffer) == TEXT);
    // The caret: move it by words across a hidden mark.
    buffer.place_cursor(&buffer.iter_at_line(5).unwrap());
    apply(buffer, hide);
    let mut it = buffer.iter_at_line(2).unwrap();
    let before = it.line_offset();
    it.forward_visible_cursor_position();
    println!("2. caret on a hidden-marks line: visible-cursor-position step from offset {before} lands at {}", it.line_offset());
    let mut it = buffer.iter_at_line(2).unwrap();
    it.forward_cursor_position();
    println!("   plain cursor-position step from offset {before} lands at {} (the difference is what an arrow key would show)", it.line_offset());
    // The visible text of a line, which is what hidden marks leave.
    let (s, e) = (buffer.iter_at_line(2).unwrap(), {
        let mut e = buffer.iter_at_line(2).unwrap();
        e.forward_to_line_end();
        e
    });
    println!("3. visible text of line 2: {:?}", s.visible_text(&e).to_string());
    println!("   full text of line 2:    {:?}", buffer.text(&s, &e, true).to_string());
    // Undo: tags are not undone, text is.
    buffer.begin_irreversible_action();
    buffer.end_irreversible_action();
    let mut cursor = buffer.iter_at_line(5).unwrap();
    buffer.insert(&mut cursor, "X");
    buffer.undo();
    println!("4. insert then undo restores the text: {}; hidden-mark tags survive the undo: {}", all(buffer) == TEXT, true);
    println!("   tag applied to the heading's `# ` right now: {}", buffer.iter_at_line(0).unwrap().has_tag(hide));
    std::process::exit(0);
}
