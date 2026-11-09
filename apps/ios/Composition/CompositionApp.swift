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

    /// The system's Increase Contrast. (`-increaseContrast 1` is the UI tests' stand-in for Settings, Accessibility, Display & Text Size, Increase Contrast.)
    private var effectiveContrast: ColorSchemeContrast {
        #if DEBUG || EDITOR_TEST_HOOKS
        if UserDefaults.standard.bool(forKey: "increaseContrast") { return .increased }
        #endif
        return contrast
    }

    var body: some View {
        let look = model.appearance.look(system: systemScheme, contrast: effectiveContrast)
        RootView(model: model)
            .environment(\.look, look)
            .tint(look.brand)
            .preferredColorScheme(model.appearance.scheme == .system ? nil : look.colorScheme)
    }
}
