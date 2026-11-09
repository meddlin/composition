//! Prints what the GTK stack this binary is linked against says about itself, and which accessibility interfaces the text
//! widgets implement. Needs a display (Xvfb will do). `cargo run --bin probe`.
use gtk::glib;
use gtk::prelude::*;

fn main() {
    gtk::init().expect("a display");
    adw::init().expect("libadwaita");
    sourceview5::init();
    println!("GTK {}.{}.{}", gtk::major_version(), gtk::minor_version(), gtk::micro_version());
    println!("libadwaita {}.{}.{}", adw::major_version(), adw::minor_version(), adw::micro_version());
    println!("GtkSourceView {}.{}.{}", sourceview5::major_version(), sourceview5::minor_version(), sourceview5::micro_version());
    println!(
        "WebKitGTK {}.{}.{}",
        webkit6::functions::major_version(),
        webkit6::functions::minor_version(),
        webkit6::functions::micro_version()
    );
    let implements = |name: &str, t: glib::Type| println!("{name} implements GtkAccessibleText (AT-SPI Text): {}", t.is_a(gtk::AccessibleText::static_type()));
    implements("GtkLabel", gtk::Label::static_type());
    implements("GtkText (entries)", gtk::Text::static_type());
    implements("GtkTextView", gtk::TextView::static_type());
    implements("GtkSourceView", sourceview5::View::static_type());
    let settings = gtk::Settings::default().expect("settings");
    println!("gtk-im-module = {:?}", settings.gtk_im_module());
    println!("gtk-font-name = {:?}, gtk-theme-name = {:?}", settings.gtk_font_name(), settings.gtk_theme_name());
    let styles = sourceview5::StyleSchemeManager::default();
    println!("GtkSourceView style schemes: {:?}", styles.scheme_ids());
    println!("markdown language: {}", sourceview5::LanguageManager::default().language("markdown").is_some());
    let multi = gtk::IMMulticontext::new();
    println!("IM context in use: {:?}", multi.context_id());
}
