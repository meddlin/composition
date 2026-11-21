import CompositionCore
import CompositionPDF
import Foundation

// Scanned notes (docs/architecture/scans.md): pictures of pages become a note that owns an image-only PDF, read and written beside like any PDF;
// then Vision reads the pages in the background, a page at a time, and what it reads goes into `scan_lines` and into Search. A line Vision was
// unsure of, or that holds a word never written on a guess, is kept but held out of Search until a person checks it (`ScanText`). The reading
// picks up where it stopped when the app is opened again: a page is done once its lines are stored.

/// The scan being read now: how many of its pages are read.
struct ScanReading: Equatable, Sendable {
    let documentId: Int64
    var done: Int
    var total: Int
}

extension AppModel {
    // MARK: Making a scan

    /// Makes a scan of `pages` (in order, each turned as the person asked): an image-only PDF, owned by a new note titled `title` in the group or
    /// notebook `target` names. Opens the note, and starts reading the pages. `folder` (where the import sheet kept its copies of the pictures) is
    /// removed afterwards, whatever happens.
    func importScan(_ pages: [ScanPageSource], title: String, into target: SidebarItem?, folder: URL?) async {
        defer { if let folder { try? FileManager.default.removeItem(at: folder) } }
        guard let library, !pages.isEmpty else { return }
        var group: Int64?
        var notebook: Int64?
        switch target {
        case .group(let id)?: group = id
        case .notebook(let id)?: notebook = id
        default: (group, notebook) = newNoteTarget
        }
        busyMessage = pages.count == 1 ? "Making the scan…" : "Making the scan of \(pages.count) pages…"
        defer { busyMessage = nil }
        let name = Self.scanFileName(title)
        let (groupId, notebookId) = (group, notebook)
        var opened: Int64?
        var problems: [String] = []
        do {
            let outcome = try await Self.perform {
                let work = FileManager.default.temporaryDirectory.appendingPathComponent("scan-\(UUID().uuidString)", isDirectory: true)
                try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
                defer { try? FileManager.default.removeItem(at: work) }
                let pdf = work.appendingPathComponent(name)
                try ScanPdf.write(pages, to: pdf, title: title)
                return try library.importScan(from: pdf, title: title, pageCount: pages.count, groupId: groupId, notebookId: notebookId)
            }
            switch outcome {
            case .added(let note, _): opened = note.id
            case .refused(let message): problems.append(message)
            case .duplicate: problems.append("The scan could not be imported.")
            }
        } catch {
            problems.append(error.localizedDescription)
        }
        await finishImport(opened: opened, group: group, notebook: notebook, problems: problems)
        readScans()
    }

    /// Every picture in `folder`, in name order, as one scan (a launch argument's way in, for tests).
    func importScanFolder(_ folder: URL) async {
        let pictures = ScanImport.ordered(((try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []).filter(ScanImport.isPicture))
        guard !pictures.isEmpty else {
            errorMessage = "There are no pictures in \(folder.lastPathComponent)."
            return
        }
        await importScan(pictures.map { ScanPageSource(url: $0) }, title: ScanImport.title(forFiles: pictures), into: sidebar, folder: nil)
    }

    /// The scan's file name: its title, with what a file name cannot hold made a dash, as a PDF.
    nonisolated static func scanFileName(_ title: String) -> String {
        let cleaned = title.map { "/\\:".contains($0) ? "-" : $0 }.reduce(into: "") { $0.append($1) }
        let trimmed = String(cleaned.trimmingCharacters(in: .whitespacesAndNewlines).prefix(120))
        return (trimmed.isEmpty || trimmed.hasPrefix(".") ? ScanImport.fallbackTitle : trimmed) + ".pdf"
    }

    // MARK: Reading the pages

    /// Reads every scanned page not read yet, oldest scan first, a page at a time, unless it is already doing so. Each page's lines are stored as it
    /// is read, and the scan's text in Search is brought up to date, so a page is found as soon as it is read. A scan whose file cannot be read is
    /// left for the next time the app opens.
    func readScans() {
        guard scanTask == nil, let database = store?.database, let library else { return }
        scanTask = Task { [weak self] in
            let recognizer = VisionScanRecognizer()
            var skipped = Set<Int64>()
            while !Task.isCancelled {
                guard let pending = try? await Self.perform({ try database.pendingScanPages() }),
                    let next = pending.first(where: { !skipped.contains($0.documentId) })
                else { break }
                let documentId = next.documentId
                let pages = pending.filter { $0.documentId == documentId }.map(\.page)
                guard let url = try? await Self.perform({ try library.documentFile(id: documentId)?.url }) else {
                    skipped.insert(documentId)
                    continue
                }
                let summary = try? await Self.perform { try database.scanSummary(documentId: documentId) }
                var done = summary?.recognized ?? 0
                let total = summary?.pages ?? pages.count
                self?.scanReading = ScanReading(documentId: documentId, done: done, total: total)
                let started = ContinuousClock.now
                for page in pages {
                    if Task.isCancelled { break }
                    do {
                        // Drawing the page and reading it both run off the main thread.
                        let read = try await Task.detached(priority: .utility) { try await ScanRecognition.lines(ofPage: page, in: url, using: recognizer) }.value
                        guard let lines = read else {
                            skipped.insert(documentId)
                            break
                        }
                        try await Self.perform { try database.storeRecognition(documentId: documentId, page: page, engine: recognizer.engine, lines: lines) }
                    } catch {
                        // Vision failed on this page (the app went to the background mid-page, say): it stays unread, and is tried when the app next opens.
                        NSLog("[scan] reading page \(page + 1) of PDF \(documentId) failed: \(error)")
                        skipped.insert(documentId)
                        break
                    }
                    done += 1
                    self?.scanReading = ScanReading(documentId: documentId, done: done, total: total)
                    self?.indexScanText(documentId: documentId)
                }
                NSLog("[scan] read \(pages.count) page(s) of PDF \(documentId) in \(started.duration(to: .now))")
            }
            self?.scanReading = nil
            self?.scanTask = nil
        }
    }

    // MARK: For the reader

    /// How far reading a scan has got, and what is held back from Search; nil when the PDF is not a scan.
    func scanSummary(documentId: Int64) async -> ScanSummary? {
        guard let database = store?.database else { return nil }
        return try? await Self.perform { try database.scanSummary(documentId: documentId) }
    }

    /// The lines read on one page of a scan, in reading order.
    func scanLines(documentId: Int64, page: Int) async -> [ScanLine] {
        guard let database = store?.database else { return [] }
        return (try? await Self.perform { try database.scanLines(documentId: documentId, page: page) }) ?? []
    }
}
