//! The Live tab on GTK, as a spike: one GtkSourceView that shows a note as it will read, with the Markdown marks hidden away from the
//! caret (`invisible` text tags), headings drawn large (`scale`), and pictures and rules drawn as overlay widgets that leave the
//! buffer's text alone. Driven from outside through stdin commands and real key events (see ../../container/live_drive.py).
//!
//! The rule is the web Live editor's (docs/ui/live-editor.md): a construct shows its marks, dimmed, while the selection touches it, ends
//! included; every other construct hides them. Only the constructs that change are re-tagged, so a caret move costs the same in a
//! 5,000-line note as in a short one.

mod parse;

use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use adw::prelude::*;
use gtk::{gdk, gio, glib, graphene, pango};
use parse::{parse_line, Construct, Kind};
use sourceview5::prelude::*;

/// How rules are drawn: as overlay widgets (S8), by a text tag (a tiny font on a coloured paragraph), or by the draw-time layer.
#[derive(Clone, Copy, PartialEq, Debug)]
enum RuleMode {
    Overlay,
    Tag,
    Layer,
}

const PICTURE_HEIGHT: i32 = 150;
const IMAGE_SPACE: i32 = PICTURE_HEIGHT + 10;

/// A widget laid over the editor that draws pictures and rules itself, at paint time, from the layout's own coordinates.
mod layer {
    use gtk::glib;
    use gtk::prelude::*;
    use gtk::subclass::prelude::*;
    use std::cell::RefCell;

    mod imp {
        use super::*;

        #[derive(Default)]
        pub struct DrawLayer {
            pub draw: RefCell<Option<Box<dyn Fn(&gtk::Widget, &gtk::Snapshot)>>>,
        }

        #[glib::object_subclass]
        impl ObjectSubclass for DrawLayer {
            const NAME: &'static str = "SpikeDrawLayer";
            type Type = super::DrawLayer;
            type ParentType = gtk::Widget;
        }

        impl ObjectImpl for DrawLayer {}

        impl WidgetImpl for DrawLayer {
            fn snapshot(&self, snapshot: &gtk::Snapshot) {
                if let Some(draw) = &*self.draw.borrow() {
                    draw(self.obj().upcast_ref(), snapshot);
                }
            }
        }
    }

    glib::wrapper! {
        pub struct DrawLayer(ObjectSubclass<imp::DrawLayer>) @extends gtk::Widget, @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
    }

    impl DrawLayer {
        pub fn new() -> Self {
            glib::Object::new()
        }
        pub fn set_draw(&self, f: impl Fn(&gtk::Widget, &gtk::Snapshot) + 'static) {
            *self.imp().draw.borrow_mut() = Some(Box::new(f));
        }
    }
}

struct Tags {
    hid: gtk::TextTag,
    dim: gtk::TextTag,
    heading: Vec<gtk::TextTag>,
    bold: gtk::TextTag,
    italic: gtk::TextTag,
    strike: gtk::TextTag,
    code: gtk::TextTag,
    mark: gtk::TextTag,
    frontmatter: gtk::TextTag,
    image_space: gtk::TextTag,
    rule_space: gtk::TextTag,
    rule_line: gtk::TextTag,
}

impl Tags {
    fn new(buffer: &sourceview5::Buffer) -> Tags {
        let make = |name: &str, props: &[(&str, &dyn gtk::glib::value::ToValue)]| buffer.create_tag(Some(name), props).expect("tag");
        let scales = [1.7f64, 1.45, 1.25, 1.1, 1.0, 1.0];
        Tags {
            hid: make("hid", &[("invisible", &true)]),
            dim: make("dim", &[("foreground-rgba", &gdk::RGBA::new(0.55, 0.55, 0.55, 1.0))]),
            heading: scales.iter().enumerate().map(|(i, s)| make(&format!("h{}", i + 1), &[("scale", s), ("weight", &700i32)])).collect(),
            bold: make("bold", &[("weight", &700i32)]),
            italic: make("italic", &[("style", &pango::Style::Italic)]),
            strike: make("strike", &[("strikethrough", &true)]),
            code: make("code", &[("family", &"monospace"), ("background-rgba", &gdk::RGBA::new(0.5, 0.5, 0.5, 0.18))]),
            mark: make("markhl", &[("background-rgba", &gdk::RGBA::new(0.95, 0.75, 0.1, 0.35))]),
            frontmatter: make("fm", &[("family", &"monospace"), ("scale", &0.85f64), ("foreground-rgba", &gdk::RGBA::new(0.55, 0.55, 0.55, 1.0))]),
            image_space: make("imgspace", &[("pixels-below-lines", &IMAGE_SPACE)]),
            rule_space: make("rulespace", &[("pixels-below-lines", &14i32)]),
            rule_line: make("ruleline", &[("scale", &0.12f64), ("paragraph-background-rgba", &gdk::RGBA::new(0.55, 0.55, 0.55, 0.7)), ("foreground-rgba", &gdk::RGBA::new(0.0, 0.0, 0.0, 0.0)), ("pixels-above-lines", &10i32), ("pixels-below-lines", &10i32)]),
        }
    }

    fn all(&self) -> Vec<&gtk::TextTag> {
        let mut v = vec![&self.hid, &self.dim, &self.bold, &self.italic, &self.strike, &self.code, &self.mark, &self.frontmatter, &self.image_space, &self.rule_space, &self.rule_line];
        v.extend(self.heading.iter());
        v
    }
}

struct Overlay {
    line: usize,
    widget: gtk::Widget,
    rule: bool,
    /// Where it was last put (buffer coordinates); a move is only made when the layout says otherwise.
    at: Cell<(i32, i32)>,
}

#[derive(Default)]
struct State {
    lines: Vec<Vec<Construct>>,
    touched: Vec<(usize, usize)>,
    overlays: Vec<Overlay>,
    frontmatter_end: Option<usize>,
    /// The lines that hold a picture or a rule, in order: all the draw-time layer needs to look at.
    special: Vec<usize>,
}

struct Live {
    buffer: sourceview5::Buffer,
    view: sourceview5::View,
    tags: Tags,
    st: RefCell<State>,
    enabled: bool,
    data_dir: PathBuf,
    dirty: Cell<bool>,
    watch_len: Cell<Option<(i32, Instant)>>,
    overlays_on: bool,
    rules: RuleMode,
    pictures_in_layer: bool,
    textures: RefCell<std::collections::HashMap<String, gdk::Texture>>,
    frame_ms: RefCell<Vec<f64>>,
}

impl Live {
    fn selection(&self) -> (i32, i32) {
        match self.buffer.selection_bounds() {
            Some((a, b)) => (a.offset(), b.offset()),
            None => {
                let o = self.buffer.iter_at_mark(&self.buffer.get_insert()).offset();
                (o, o)
            }
        }
    }

    fn iter(&self, line: usize, col: usize) -> gtk::TextIter {
        let mut it = self.buffer.iter_at_line(line as i32).expect("line");
        it.forward_chars(col as i32);
        it
    }

    fn line_text(&self, line: usize) -> String {
        let s = self.buffer.iter_at_line(line as i32).expect("line");
        let mut e = s;
        if !e.ends_line() {
            e.forward_to_line_end();
        }
        self.buffer.text(&s, &e, true).to_string()
    }

    fn touches(c: &Construct, line_start: i32, a: i32, b: i32) -> bool {
        a <= line_start + c.end as i32 && b >= line_start + c.start as i32
    }

    fn apply_style(&self, line: usize, c: &Construct) {
        let tag = match &c.kind {
            Kind::Heading(n) => Some(&self.tags.heading[*n as usize - 1]),
            Kind::Bold => Some(&self.tags.bold),
            Kind::Italic => Some(&self.tags.italic),
            Kind::Strike => Some(&self.tags.strike),
            Kind::Code => Some(&self.tags.code),
            Kind::Mark => Some(&self.tags.mark),
            Kind::Image { .. } => Some(&self.tags.image_space),
            Kind::Rule if self.rules == RuleMode::Tag => None,
            Kind::Rule => Some(&self.tags.rule_space),
        };
        if let Some(tag) = tag {
            let (from, to) = if matches!(c.kind, Kind::Image { .. } | Kind::Rule) { (c.start, c.end) } else { c.content };
            if to > from {
                self.buffer.apply_tag(tag, &self.iter(line, from), &self.iter(line, to));
            }
        }
    }

    fn apply_marks(&self, line: usize, c: &Construct, revealed: bool) {
        if c.kind == Kind::Rule && self.rules == RuleMode::Tag {
            let (s, e) = (self.iter(line, c.start), self.iter(line, c.end));
            self.buffer.remove_tag(&self.tags.rule_line, &s, &e);
            self.buffer.remove_tag(&self.tags.dim, &s, &e);
            self.buffer.apply_tag(if revealed { &self.tags.dim } else { &self.tags.rule_line }, &s, &e);
            return;
        }
        for &(a, b) in &c.marks {
            if b <= a {
                continue;
            }
            let (s, e) = (self.iter(line, a), self.iter(line, b));
            self.buffer.remove_tag(&self.tags.hid, &s, &e);
            self.buffer.remove_tag(&self.tags.dim, &s, &e);
            self.buffer.apply_tag(if revealed { &self.tags.dim } else { &self.tags.hid }, &s, &e);
        }
    }

    fn make_overlay(&self, line: usize, c: &Construct) -> Option<Overlay> {
        if !self.overlays_on {
            return None;
        }
        match &c.kind {
            Kind::Image { .. } if self.pictures_in_layer => return None,
            Kind::Rule if self.rules != RuleMode::Overlay => return None,
            _ => {}
        }
        let widget: gtk::Widget = match &c.kind {
            Kind::Image { alt, src } => {
                let path = self.data_dir.join(src);
                let picture = gtk::Picture::for_filename(path);
                picture.set_size_request(300, PICTURE_HEIGHT);
                picture.set_halign(gtk::Align::Start);
                picture.set_content_fit(gtk::ContentFit::Contain);
                picture.set_alternative_text(Some(alt));
                picture.upcast()
            }
            Kind::Rule => {
                let sep = gtk::Separator::new(gtk::Orientation::Horizontal);
                sep.set_valign(gtk::Align::Start);
                sep.upcast()
            }
            _ => return None,
        };
        self.view.add_overlay(&widget, 0, 0);
        Some(Overlay { line, widget, rule: matches!(c.kind, Kind::Rule), at: Cell::new((-1, -1)) })
    }

    fn drop_overlays(&self, st: &mut State, from: usize, to: usize) {
        st.overlays.retain(|o| {
            let drop = o.line >= from && o.line <= to;
            if drop {
                self.view.remove(&o.widget);
            }
            !drop
        });
    }

    /// Re-reads lines `from..=to`: strips our tags, finds the constructs, styles them, hides or dims their marks by the current selection.
    fn rescan(&self, from: usize, to: usize) {
        let mut st = self.st.borrow_mut();
        let (a, b) = self.selection();
        self.drop_overlays(&mut st, from, to);
        let (start, end) = (self.iter(from, 0), {
            let mut e = self.iter(to, 0);
            if !e.ends_line() {
                e.forward_to_line_end();
            }
            e
        });
        for t in self.tags.all() {
            self.buffer.remove_tag(t, &start, &end);
        }
        let mut offset = start.offset();
        for line in from..=to {
            let text = self.line_text(line);
            let len = text.chars().count();
            let in_fm = st.frontmatter_end.map(|e| line <= e).unwrap_or(false);
            let mut constructs = if in_fm { vec![] } else { parse_line(&text) };
            if in_fm {
                self.buffer.apply_tag(&self.tags.frontmatter, &self.iter(line, 0), &self.iter(line, len));
            }
            for c in constructs.iter_mut() {
                self.apply_style(line, c);
                c.revealed = Self::touches(c, offset, a, b);
                self.apply_marks(line, c, c.revealed);
                if let Some(o) = self.make_overlay(line, c) {
                    st.overlays.push(o);
                }
            }
            if line < st.lines.len() {
                st.lines[line] = constructs;
            }
            offset += len as i32 + 1;
        }
        st.special = st.lines.iter().enumerate().filter(|(_, l)| l.iter().any(|c| matches!(c.kind, Kind::Image { .. } | Kind::Rule))).map(|(i, _)| i).collect();
        self.dirty.set(true);
    }

    fn rescan_all(&self) {
        let lc = self.buffer.line_count() as usize;
        {
            let mut st = self.st.borrow_mut();
            st.lines = vec![vec![]; lc];
            st.touched.clear();
            // Frontmatter: a first line of `---` up to the next `---`.
            st.frontmatter_end = None;
            if self.line_text(0) == "---" {
                st.frontmatter_end = (1..lc.min(60)).find(|&l| self.line_text(l) == "---");
            }
        }
        self.rescan(0, lc - 1);
        self.refresh();
    }

    /// The constructs the selection touches now.
    fn touched_now(&self) -> Vec<(usize, usize)> {
        let (a, b) = self.selection();
        let (first, last) = (self.buffer.iter_at_offset(a).line() as usize, self.buffer.iter_at_offset(b).line() as usize);
        let st = self.st.borrow();
        let mut out = vec![];
        for line in first..=last.min(st.lines.len().saturating_sub(1)) {
            let ls = self.buffer.iter_at_line(line as i32).map(|i| i.offset()).unwrap_or(0);
            for (idx, c) in st.lines[line].iter().enumerate() {
                if Self::touches(c, ls, a, b) {
                    out.push((line, idx));
                }
            }
        }
        out
    }

    /// Moves the "marks shown" state from the constructs the selection used to touch to those it touches now. Nothing else is re-tagged.
    fn refresh(&self) {
        if !self.enabled {
            return;
        }
        let new = self.touched_now();
        let mut st = self.st.borrow_mut();
        let old = std::mem::take(&mut st.touched);
        let new_set: HashSet<_> = new.iter().copied().collect();
        for key in old.iter().chain(new.iter()) {
            let revealed = new_set.contains(key);
            let Some(c) = st.lines.get(key.0).and_then(|l| l.get(key.1)).cloned() else { continue };
            if c.revealed != revealed {
                self.apply_marks(key.0, &c, revealed);
                st.lines[key.0][key.1].revealed = revealed;
                self.dirty.set(true);
            }
        }
        st.touched = new;
    }

    /// After a text change: the caret's line and its neighbours are read again; a change in the number of lines reads everything.
    fn edited(&self) {
        if let Some((target, started)) = self.watch_len.get() {
            if self.buffer.char_count() >= target {
                self.watch_len.set(None);
                println!("LEN_REACHED {:.1}", started.elapsed().as_secs_f64() * 1000.0);
            }
        }
        if !self.enabled {
            return;
        }
        let lc = self.buffer.line_count() as usize;
        if lc != self.st.borrow().lines.len() {
            self.rescan_all();
            return;
        }
        let line = self.buffer.iter_at_mark(&self.buffer.get_insert()).line() as usize;
        self.rescan(line.saturating_sub(1), (line + 1).min(lc - 1));
        self.refresh();
    }

    /// Called every frame. A picture or a rule sits where its line is laid out, and the layout changes under it (a heading growing, a
    /// window resize, the first allocation), so the position is read again each frame and the overlay is only moved when it differs.
    /// Returns how many were moved.
    fn reposition(&self) -> usize {
        let st = self.st.borrow();
        let width = (self.view.width() - 40).max(100);
        let mut moved = 0;
        for o in &st.overlays {
            let Some(it) = self.buffer.iter_at_line(o.line as i32) else { continue };
            let r = self.view.iter_location(&it);
            let at = if o.rule { (14, r.y() + r.height() / 2) } else { (14, r.y() + r.height()) };
            if o.at.get() != at {
                if o.rule {
                    o.widget.set_size_request(width, 2);
                }
                self.view.move_overlay(&o.widget, at.0, at.1);
                o.at.set(at);
                moved += 1;
            }
        }
        moved
    }

    fn texture(&self, src: &str) -> Option<gdk::Texture> {
        let mut cache = self.textures.borrow_mut();
        if let Some(t) = cache.get(src) {
            return Some(t.clone());
        }
        let t = gdk::Texture::from_filename(self.data_dir.join(src)).ok()?;
        cache.insert(src.to_string(), t.clone());
        Some(t)
    }

    /// Draws the pictures and rules of the visible lines, from where the layout puts those lines right now. Nothing is remembered between
    /// frames, so there is nothing to go stale. Only `line_yrange` is asked of the layout (a line's top and height, wrapped lines and the
    /// spacing below it included), and only for the lines that hold a picture or a rule, found by bisection.
    fn draw_layer(&self, width: f32, snapshot: &gtk::Snapshot) {
        let started = Instant::now();
        let Ok(st) = self.st.try_borrow() else { return };
        // The scan runs inside the buffer's `changed` signal, so a frame never sees it behind; this only keeps a bug there from crashing.
        if st.lines.len() != self.buffer.line_count() as usize {
            return;
        }
        let vis = self.view.visible_rect();
        let yrange = |line: usize| {
            let it = self.buffer.iter_at_line(line as i32).expect("line");
            self.view.line_yrange(&it)
        };
        let first = st.special.partition_point(|&l| {
            let (y, h) = yrange(l);
            y + h < vis.y()
        });
        for &line in &st.special[first..] {
            let (y, h) = yrange(line);
            if y > vis.y() + vis.height() {
                break;
            }
            let top = (y - vis.y()) as f32;
            for c in &st.lines[line] {
                match &c.kind {
                    Kind::Image { src, .. } if self.pictures_in_layer => {
                        if let Some(tex) = self.texture(src) {
                            // The picture goes in the room the line's `pixels-below-lines` reserved at the bottom of its box.
                            let rect = graphene::Rect::new(14.0, top + h as f32 - IMAGE_SPACE as f32 + 5.0, 300.0, PICTURE_HEIGHT as f32);
                            snapshot.append_scaled_texture(&tex, gtk::gsk::ScalingFilter::Linear, &rect);
                        }
                    }
                    Kind::Rule if self.rules == RuleMode::Layer && !c.revealed => {
                        let rect = graphene::Rect::new(14.0, top + (h as f32 - 14.0) / 2.0, (width - 28.0).max(10.0), 1.5);
                        snapshot.append_color(&gdk::RGBA::new(0.55, 0.55, 0.55, 0.7), &rect);
                    }
                    _ => {}
                }
            }
        }
        let mut ms = self.frame_ms.borrow_mut();
        ms.push(started.elapsed().as_secs_f64() * 1000.0);
        if ms.len() > 600 {
            ms.remove(0);
        }
    }

    fn state_json(&self) -> serde_json::Value {
        let caret = self.buffer.iter_at_mark(&self.buffer.get_insert());
        let (a, b) = self.selection();
        let line = caret.line() as usize;
        let st = self.st.borrow();
        let (mut constructs, mut revealed, mut hidden) = (0, 0, 0);
        for l in &st.lines {
            for c in l {
                constructs += 1;
                if c.revealed {
                    revealed += 1;
                } else {
                    hidden += c.marks.iter().map(|(x, y)| y - x).sum::<usize>();
                }
            }
        }
        let s = self.buffer.iter_at_line(line as i32).unwrap();
        let mut e = s;
        if !e.ends_line() {
            e.forward_to_line_end();
        }
        serde_json::json!({
            "caret": caret.offset(), "line": line, "col": caret.line_offset(), "sel": [a, b],
            "chars": self.buffer.char_count(), "lines": self.buffer.line_count(),
            "constructs": constructs, "revealed": revealed, "hidden_mark_chars": hidden,
            "line_text": self.buffer.text(&s, &e, true).to_string(), "visible_line": s.visible_text(&e).to_string(),
            "live": self.enabled,
        })
    }

    fn command(self: &Rc<Self>, line: &str, window: &adw::ApplicationWindow) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        match parts.as_slice() {
            ["dump"] => println!("STATE {}", self.state_json()),
            ["goto", l, c] => {
                let it = self.iter(l.parse().unwrap_or(0), c.parse().unwrap_or(0));
                self.buffer.place_cursor(&it);
                self.view.scroll_to_mark(&self.buffer.get_insert(), 0.0, true, 0.0, 0.3);
                println!("OK goto");
            }
            ["select", a, b] => {
                let (x, y) = (self.buffer.iter_at_offset(a.parse().unwrap_or(0)), self.buffer.iter_at_offset(b.parse().unwrap_or(0)));
                self.buffer.select_range(&x, &y);
                println!("OK select");
            }
            ["text", a, b] => {
                let (x, y) = (self.buffer.iter_at_offset(a.parse().unwrap_or(0)), self.buffer.iter_at_offset(b.parse().unwrap_or(0)));
                println!("TEXT {}", serde_json::Value::String(self.buffer.text(&x, &y, true).to_string()));
            }
            ["undo"] => {
                self.buffer.undo();
                println!("OK undo");
            }
            ["expect_len", n] => {
                self.watch_len.set(Some((n.parse().unwrap_or(0), Instant::now())));
                println!("OK expect_len");
            }
            ["bench", "scan"] => {
                let times: Vec<String> = (0..3)
                    .map(|_| {
                        let t = Instant::now();
                        self.rescan_all();
                        format!("{:.1}", t.elapsed().as_secs_f64() * 1000.0)
                    })
                    .collect();
                println!("BENCH scan_ms [{}]", times.join(", "));
            }
            ["bench", mode, n] => {
                let n: usize = n.parse().unwrap_or(100);
                let lc = self.buffer.line_count() as usize;
                let t = Instant::now();
                for i in 0..n {
                    let line = (i * 37 + 11) % lc;
                    self.buffer.place_cursor(&self.iter(line, 0));
                    if *mode == "caretfull" {
                        self.rescan_all(); // what a "retag everything on every move" implementation costs
                    }
                }
                println!("BENCH {mode} n={n} avg_ms={:.2}", t.elapsed().as_secs_f64() * 1000.0 / n as f64);
            }
            ["clip"] => {
                let clipboard = self.view.clipboard();
                glib::spawn_future_local(async move {
                    match clipboard.read_text_future().await {
                        Ok(Some(t)) => println!("CLIP {}", serde_json::Value::String(t.to_string())),
                        Ok(None) => println!("CLIP null"),
                        Err(e) => println!("CLIP error {e}"),
                    }
                });
            }
            ["overlayinfo"] => {
                let st = self.st.borrow();
                let visible = self.view.visible_rect();
                let caret_line = self.buffer.iter_at_mark(&self.buffer.get_insert()).line();
                let caret_loc = self.view.iter_location(&self.buffer.iter_at_mark(&self.buffer.get_insert()));
                println!("INFO visible_rect y={} h={} caret_line={} caret iter_location y={} (window y {})", visible.y(), visible.height(), caret_line, caret_loc.y(), caret_loc.y() - visible.y());
                let mut near: Vec<&Overlay> = st.overlays.iter().collect();
                near.sort_by_key(|o| (o.line as i32 - caret_line).abs());
                println!("INFO {} overlays in all", near.len());
                for o in near.into_iter().take(4) {
                    let it = self.buffer.iter_at_line(o.line as i32).unwrap();
                    let r = self.view.iter_location(&it);
                    #[allow(deprecated)]
                    let alloc = o.widget.allocation();
                    println!("INFO overlay line={} rule={} iter_location y={} h={} placed at {:?} allocation y={} (window y of line {})", o.line, o.rule, r.y(), r.height(), o.at.get(), alloc.y(), r.y() - visible.y());
                }
            }
            ["bench", "layer"] => {
                let ms = self.frame_ms.borrow();
                let avg = ms.iter().sum::<f64>() / ms.len().max(1) as f64;
                let max = ms.iter().cloned().fold(0.0, f64::max);
                println!("BENCH layer frames={} avg_ms={avg:.3} max_ms={max:.3}", ms.len());
            }
            ["bench", "reposition"] => {
                let t = Instant::now();
                let moved = self.reposition();
                println!("BENCH reposition moved={moved} ms={:.2} overlays={}", t.elapsed().as_secs_f64() * 1000.0, self.st.borrow().overlays.len());
            }
            ["snapshot", path] => {
                match save_png(window, Path::new(path)) {
                    Ok(()) => println!("OK snapshot {path}"),
                    Err(e) => println!("ERR snapshot {e}"),
                }
            }
            ["quit"] => std::process::exit(0),
            other => println!("ERR unknown command {other:?}"),
        }
        use std::io::Write;
        std::io::stdout().flush().ok();
    }
}

fn save_png(widget: &impl IsA<gtk::Widget>, path: &Path) -> Result<(), String> {
    let widget = widget.as_ref();
    let paintable = gtk::WidgetPaintable::new(Some(widget));
    let (w, h) = (widget.width() as f32, widget.height() as f32);
    let snapshot = gtk::Snapshot::new();
    paintable.snapshot(&snapshot, w as f64, h as f64);
    let node = snapshot.to_node().ok_or("nothing was drawn")?;
    let renderer = widget.native().and_then(|n| n.renderer()).ok_or("no renderer")?;
    renderer.render_texture(&node, Some(&graphene::Rect::new(0.0, 0.0, w, h))).save_to_png(path).map_err(|e| e.to_string())
}

const SAMPLE: &str = "---
title: Live spike
tags:
- demo
---
# A heading with **bold**

Plain text, then **bold words**, *italic*, ~~gone~~, `code` and <Mark color=\"green\">a highlight</Mark>.

## A second heading

A line of ordinary text, so the caret has somewhere to walk across hidden marks: **one** and **two** and *three*.

![A gradient](app_data/demo-photo-0123456789ab.png)

---

Last paragraph, with **bold at the very end**
";

/// About `lines` lines: a mix of everything, a picture every 25 blocks.
fn generate(lines: usize) -> String {
    let mut s = String::from("---\ntitle: Five thousand lines\ntags:\n- demo\n---\n");
    let mut n = 0;
    while s.lines().count() < lines {
        n += 1;
        s.push_str(&format!("## Section {n}\n\nParagraph {n} with **bold words**, *italic*, ~~gone~~, `code` and <Mark color=\"green\">highlight</Mark>.\n\nAnother line of ordinary text with a [link](https://example.com) and enough words that it wraps at a reasonable width in the window.\n\n"));
        if n % 25 == 0 {
            s.push_str("![A gradient](app_data/demo-photo-0123456789ab.png)\n\n");
        }
        s.push_str("---\n\n");
    }
    s
}

fn main() -> glib::ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let flag = |f: &str| args.iter().any(|a| a == f);
    let value = |f: &str| args.iter().position(|a| a == f).and_then(|i| args.get(i + 1)).cloned();
    let text = match (value("--text"), value("--generate")) {
        (Some(path), _) => std::fs::read_to_string(path).expect("--text file"),
        (_, Some(n)) => generate(n.parse().unwrap_or(5000)),
        _ => SAMPLE.to_string(),
    };
    let enabled = !flag("--no-live");
    let no_overlays = flag("--no-overlays");
    let rules = match value("--rules").as_deref() {
        Some("tag") => RuleMode::Tag,
        Some("layer") => RuleMode::Layer,
        _ => RuleMode::Overlay,
    };
    let pictures_in_layer = value("--pictures").as_deref() == Some("layer");
    let data_dir = PathBuf::from(value("--data-dir").unwrap_or_else(|| "/data".into()));
    let scheme = value("--scheme");
    let size: (i32, i32) = value("--size").and_then(|s| s.split_once('x').map(|(w, h)| (w.parse().unwrap_or(900), h.parse().unwrap_or(700)))).unwrap_or((900, 700));

    let app = adw::Application::builder().application_id("com.rushinglabs.LiveSpike").flags(gio::ApplicationFlags::NON_UNIQUE).build();
    app.connect_activate(move |app| {
        sourceview5::init();
        if let Some(s) = &scheme {
            adw::StyleManager::default().set_color_scheme(if s == "dark" { adw::ColorScheme::ForceDark } else { adw::ColorScheme::ForceLight });
        }
        let buffer = sourceview5::Buffer::new(None);
        let dark = adw::StyleManager::default().is_dark();
        buffer.set_style_scheme(sourceview5::StyleSchemeManager::default().scheme(if dark { "Adwaita-dark" } else { "Adwaita" }).as_ref());
        buffer.set_text(&text);
        buffer.place_cursor(&buffer.start_iter());
        let view = sourceview5::View::with_buffer(&buffer);
        view.set_wrap_mode(gtk::WrapMode::WordChar);
        view.set_left_margin(14);
        view.set_right_margin(14);
        view.set_top_margin(12);
        view.set_pixels_below_lines(6);
        view.set_pixels_inside_wrap(2);
        let scroll = gtk::ScrolledWindow::builder().child(&view).build();
        let stack = gtk::Overlay::new();
        stack.set_child(Some(&scroll));
        let window = adw::ApplicationWindow::builder().application(app).default_width(size.0).default_height(size.1).title("Live spike").content(&stack).build();

        let live = Rc::new(Live { tags: Tags::new(&buffer), buffer: buffer.clone(), view: view.clone(), st: RefCell::new(State::default()), enabled, data_dir: data_dir.clone(), dirty: Cell::new(false), watch_len: Cell::new(None), overlays_on: !no_overlays, rules, pictures_in_layer, textures: RefCell::new(Default::default()), frame_ms: RefCell::new(vec![]) });
        let started = Instant::now();
        if enabled {
            live.rescan_all();
        }
        let scan_ms = started.elapsed().as_secs_f64() * 1000.0;

        buffer.connect_mark_set({
            let live = live.clone();
            move |_, _, mark| {
                if matches!(mark.name().as_deref(), Some("insert") | Some("selection_bound")) {
                    live.refresh();
                }
            }
        });
        buffer.connect_changed({
            let live = live.clone();
            move |_| live.edited()
        });
        if rules == RuleMode::Layer || pictures_in_layer {
            let draw = layer::DrawLayer::new();
            draw.set_can_target(false);
            draw.set_can_focus(false);
            draw.set_overflow(gtk::Overflow::Hidden);
            draw.set_draw({
                let live = live.clone();
                move |w, snap| live.draw_layer(w.width() as f32, snap)
            });
            stack.add_overlay(&draw);
            stack.set_clip_overlay(&draw, true);
            // It draws from the live layout, so it only has to be asked to draw again whenever the picture could have changed.
            draw.add_tick_callback(|w, _| {
                w.queue_draw();
                glib::ControlFlow::Continue
            });
        }
        view.add_tick_callback({
            let live = live.clone();
            move |_, _| {
                live.reposition();
                glib::ControlFlow::Continue
            }
        });
        window.present();

        let st = live.st.borrow();
        let constructs: usize = st.lines.iter().map(|l| l.len()).sum();
        println!("READY live={enabled} scan_ms={scan_ms:.1} lines={} constructs={constructs} overlays={}", buffer.line_count(), st.overlays.len());
        drop(st);

        // Commands arrive on stdin, one per line; a thread reads them and the main loop picks them up.
        let (tx, rx) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            for line in std::io::stdin().lock().lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        let window2 = window.clone();
        glib::timeout_add_local(Duration::from_millis(15), move || {
            while let Ok(line) = rx.try_recv() {
                live.command(&line, &window2);
            }
            glib::ControlFlow::Continue
        });
    });
    app.run_with_args::<&str>(&[])
}
