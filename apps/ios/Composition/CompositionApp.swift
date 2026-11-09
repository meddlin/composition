import SwiftUI

@main
struct CompositionApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ThemedRoot(model: model)
                .task { await model.start() }
        }
    }
}

/// Puts the colour scheme in force on everything under it (build plan Step 10): the tokens for the views (`\.look`), the accent colour, and, for a scheme that is dark or light whatever the iPad is showing, the system's own controls (the keyboard, sheets, alerts).
/// With **System** nothing is forced and the scheme follows the iPad: the colour scheme read here is then the iPad's.
struct ThemedRoot: View {
    let model: AppModel
    @Environment(\.colorScheme) private var systemScheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.scenePhase) private var scenePhase

    /// The system's Increase Contrast. (`-increaseContrast 1` is the UI tests' stand-in for Settings, Accessibility, Display & Text Size, Increase Contrast.)
    private var effectiveContrast: ColorSchemeContrast {
        #if DEBUG || EDITOR_TEST_HOOKS
        if UserDefaults.standard.bool(forKey: "increaseContrast") { return .increased }
        #endif
        return contrast
    }

    var body: some View {
        // The view below is the same one whichever scheme is chosen (choosing Follow the sun in the Appearance sheet must not rebuild the screen under it).
        TimelineView(SunTicks(running: model.appearance.scheme == .sun)) { context in
            let sunLevel = model.appearance.scheme == .sun ? model.sun.level(at: context.date) : 1
            let look = model.appearance.look(system: systemScheme, contrast: effectiveContrast, sunLevel: sunLevel)
            RootView(model: model)
                .environment(\.look, look)
                .environment(\.writing, model.writing)
                .tint(look.brand)
                .preferredColorScheme(model.appearance.scheme == .system ? nil : look.colorScheme)
        }
        .onChange(of: scenePhase) { _, phase in if phase == .active { model.sun.resume() } }
    }
}

/// Follow the sun moves along the fade as the day goes, so while it is the scheme in force it is looked at again every half minute (the desktop's
/// `SunThemeSync` ticks every 30 seconds). With any other scheme the view is drawn once and left alone.
private struct SunTicks: TimelineSchedule {
    let running: Bool

    func entries(from start: Date, mode: TimelineScheduleMode) -> AnyIterator<Date> {
        var next = start
        var first = true
        return AnyIterator {
            if first {
                first = false
                return start
            }
            guard running else { return nil }
            next = next.addingTimeInterval(30)
            return next
        }
    }
}
