import CompositionCore
import SwiftUI
import UIKit
import WebKit

// The page of the Reading List link that is open, in the third column. The desktop shows it in an Electron `<webview>` in a partition
// of its own (docs/reading-list-plan.md, R1, R2, R8); here it is a `WKWebView` with the same rules:
//
// - Its own persistent website data store, apart from anything else in the app, so sign-ins to paywalled sites last until Clear Browsing
//   Data (in More ▸ Plugins) wipes them. The app's own pages never share it.
// - No script message handlers and no injected scripts: the page cannot reach the app.
// - Only web pages in the main frame (`http:` and `https:`); anything else it tries to open is refused.
// - A link that asks for a new window (`target=_blank`, `window.open`) opens in Safari. Nothing opens a window of ours.
// - Every permission (camera, microphone, motion) is refused, and a file to download is not downloaded.
//
// This is the one web view in the app besides the `<YouTube>` player (docs/ipad-app-design.md, C8): it shows web pages, which is the point
// of the plugin, and is not used to draw any of the app's own interface.

/// One open page: the web view, and what the bar above it shows. A new one is made for each link, so each starts with a history of its own.
@MainActor @Observable
final class ReadingPage: NSObject {
    /// Where the page is now: changes as links inside it are followed.
    private(set) var address: URL?
    private(set) var canGoBack = false
    private(set) var canGoForward = false
    private(set) var isLoading = false
    private(set) var progress = 0.0
    /// Why the page could not be shown, until the next one is.
    private(set) var failure: String?

    /// Called with the page's title each time it names itself (the link keeps only the first; AppModel.fillReadingTitle).
    @ObservationIgnored var onTitle: ((String) -> Void)?
    @ObservationIgnored private let start: URL?
    @ObservationIgnored private var observations: [NSKeyValueObservation] = []
    @ObservationIgnored private var made: WKWebView?

    /// The Reading List's own website data: a persistent store with a fixed identifier, used for nothing else (iOS 17).
    static let dataStore = WKWebsiteDataStore(forIdentifier: UUID(uuidString: "6F1B7E2A-2C55-4C1E-9D3A-5E0B6A7C4D21")!)

    init(url: String) {
        start = URL(string: url)
        address = start
        super.init()
    }

    /// Made the first time it is shown, and loaded with the link then.
    var webView: WKWebView {
        if let made { return made }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = Self.dataStore
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.preferences.isFraudulentWebsiteWarningEnabled = true
        configuration.upgradeKnownHostsToHTTPS = true
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = true
        view.isOpaque = false
        view.backgroundColor = .clear
        observations = [
            view.observe(\.title, options: [.new]) { [weak self] view, _ in
                MainActor.assumeIsolated {
                    guard let title = view.title, !title.isEmpty else { return }
                    self?.onTitle?(title)
                }
            },
            view.observe(\.url, options: [.new]) { [weak self] view, _ in
                MainActor.assumeIsolated { if let url = view.url { self?.address = url } }
            },
            view.observe(\.canGoBack, options: [.new]) { [weak self] view, _ in MainActor.assumeIsolated { self?.canGoBack = view.canGoBack } },
            view.observe(\.canGoForward, options: [.new]) { [weak self] view, _ in MainActor.assumeIsolated { self?.canGoForward = view.canGoForward } },
            view.observe(\.isLoading, options: [.new]) { [weak self] view, _ in MainActor.assumeIsolated { self?.isLoading = view.isLoading } },
            view.observe(\.estimatedProgress, options: [.new]) { [weak self] view, _ in MainActor.assumeIsolated { self?.progress = view.estimatedProgress } },
        ]
        made = view
        if let start, Self.isWeb(start) {
            view.load(URLRequest(url: start))
        } else {
            failure = "This link cannot be opened here."
        }
        return view
    }

    func goBack() { made?.goBack() }
    func goForward() { made?.goForward() }

    func reloadOrStop() {
        guard let made else { return }
        if made.isLoading {
            made.stopLoading()
        } else {
            failure = nil
            if made.url == nil, let start { made.load(URLRequest(url: start)) } else { made.reload() }
        }
    }

    /// Wipes what pages stored in the Reading List (cookies, local storage, the cache). The links are not touched.
    static func clearBrowsingData() async {
        await dataStore.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
    }

    static func isWeb(_ url: URL) -> Bool {
        let scheme = url.scheme?.lowercased()
        return scheme == "http" || scheme == "https"
    }

    /// The reason a load failed, or nil when it only stopped (another link was followed, or a navigation was refused here).
    private func reason(_ error: Error) -> String? {
        let error = error as NSError
        if error.domain == NSURLErrorDomain, error.code == NSURLErrorCancelled { return nil }
        // WebKit's "frame load interrupted": what a refused navigation or a download leaves behind.
        if error.domain == "WebKitErrorDomain", error.code == 102 { return nil }
        return error.localizedDescription
    }
}

extension ReadingPage: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
        // A new-window request: Safari, never a window of ours.
        if navigationAction.targetFrame == nil {
            if Self.isWeb(url) { UIApplication.shared.open(url) }
            return decisionHandler(.cancel)
        }
        // The page itself only ever shows web pages; a frame inside it may hold `about:blank` and the like, as in any browser.
        if navigationAction.targetFrame?.isMainFrame == true, !Self.isWeb(url) { return decisionHandler(.cancel) }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame, !navigationResponse.canShowMIMEType {
            failure = "This link is a file to download, not a page. Open it in Safari to download it."
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { failure = nil }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if let reason = reason(error) { failure = reason }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if let reason = reason(error) { failure = reason }
    }

    /// The page's process ended (memory, or a crash): show it again rather than a blank rectangle.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
}

extension ReadingPage: WKUIDelegate {
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, Self.isWeb(url) { UIApplication.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, decideMediaCapturePermissionsFor origin: WKSecurityOrigin, initiatedBy frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }

    func webView(_ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }
}

/// The web view, as SwiftUI shows it.
private struct ReadingWebView: UIViewRepresentable {
    let page: ReadingPage

    func makeUIView(context: Context) -> WKWebView { page.webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
}

/// The third column while the sidebar is on the Reading List: the open link's page, or a word on what to do.
struct ReadingPageColumn: View {
    @Bindable var model: AppModel
    @Environment(\.look) private var look

    var body: some View {
        if let item = model.openReadingItem {
            ReadingPageView(model: model, item: item).id(item.id)
        } else {
            ContentUnavailableView(
                "Pick an article", systemImage: "eyeglasses",
                description: Text(model.readingItems.isEmpty ? "Add a link to read its page here." : "Its page opens here."))
                .background(look.background)
        }
    }
}

private struct ReadingPageView: View {
    @Bindable var model: AppModel
    let item: ReadingItem
    @State private var page: ReadingPage
    @Environment(\.look) private var look
    @Environment(\.openURL) private var openURL

    init(model: AppModel, item: ReadingItem) {
        self.model = model
        self.item = item
        _page = State(initialValue: ReadingPage(url: item.url))
    }

    /// Where the page is now, else the link itself.
    private var current: URL? { page.address ?? URL(string: item.url) }

    var body: some View {
        ReadingWebView(page: page)
            .background(look.background)
            .overlay { if let failure = page.failure { failed(failure) } }
            .safeAreaInset(edge: .top, spacing: 0) { addressBar }
            .navigationTitle(item.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .topBarLeading) {
                    Button("Page Back", systemImage: "arrow.backward") { page.goBack() }
                        .disabled(!page.canGoBack)
                        .accessibilityIdentifier("page-back")
                    Button("Page Forward", systemImage: "arrow.forward") { page.goForward() }
                        .disabled(!page.canGoForward)
                        .accessibilityIdentifier("page-forward")
                    Button(page.isLoading ? "Stop" : "Reload", systemImage: page.isLoading ? "xmark" : "arrow.clockwise") { page.reloadOrStop() }
                        .keyboardShortcut("r", modifiers: .command)
                        .accessibilityIdentifier("page-reload")
                }
                ToolbarItemGroup(placement: .primaryAction) {
                    Button(item.read ? "Mark as Unread" : "Mark as Read", systemImage: item.read ? "checkmark.circle.fill" : "checkmark.circle") {
                        Task { await model.setReadingRead(item.id, !item.read) }
                    }
                    .accessibilityIdentifier("page-mark-read")
                    if let current {
                        ShareLink(item: current)
                        Button("Open in Safari", systemImage: "safari") { openURL(current) }
                            .accessibilityIdentifier("page-open-safari")
                    }
                }
            }
            .onAppear {
                let id = item.id
                page.onTitle = { [weak model] title in Task { await model?.fillReadingTitle(id, title) } }
            }
    }

    /// The address, read-only, with the load's progress under it.
    private var addressBar: some View {
        HStack(spacing: 6) {
            if current?.scheme == "https" {
                Image(systemName: "lock.fill").font(.caption2).accessibilityLabel("Secure")
            }
            Text(current?.absoluteString ?? item.url)
                .font(.caption)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
                .accessibilityLabel("Address")
                .accessibilityValue(current?.absoluteString ?? item.url)
                .accessibilityIdentifier("page-address")
        }
        .foregroundStyle(look.mutedText)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .background(look.surface)
        .overlay(alignment: .bottom) {
            if page.isLoading {
                ProgressView(value: page.progress).progressViewStyle(.linear).tint(look.brand).accessibilityHidden(true)
            } else {
                Rectangle().fill(look.border).frame(height: 1)
            }
        }
    }

    private func failed(_ reason: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle").font(.largeTitle).foregroundStyle(look.warning).accessibilityHidden(true)
            Text("This page could not be loaded.").font(.headline)
            Text(reason).font(.callout).foregroundStyle(look.mutedText).multilineTextAlignment(.center)
            if let current {
                Button("Open in Safari", systemImage: "safari") { openURL(current) }.buttonStyle(.bordered)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(look.background)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("page-failure")
    }
}
