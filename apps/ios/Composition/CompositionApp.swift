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

    var body: some View {
        let look = model.appearance.look(system: systemScheme)
        RootView(model: model)
            .environment(\.look, look)
            .tint(look.brand)
            .preferredColorScheme(model.appearance.scheme == .system ? nil : look.colorScheme)
    }
}
