import Foundation
import GRDB

@testable import CompositionCore

// Shared by the conformance tests that replay a script against the desktop's record of it (the Trash Can and the store).

/// JSON as the TypeScript wrote it, compared structurally.
enum JSON: Codable, Equatable {
    case null
    case bool(Bool)
    case int(Int64)
    case double(Double)
    case string(String)
    case array([JSON])
    case object([String: JSON])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Int64.self) { self = .int(value) }
        else if let value = try? container.decode(Double.self) { self = .double(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSON].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSON].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .int(let value): try container.encode(value)
        case .double(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    init(_ value: DatabaseValue) {
        switch value.storage {
        case .null: self = .null
        case .int64(let value): self = .int(value)
        case .double(let value): self = .double(value)
        case .string(let value): self = .string(value)
        case .blob(let value): self = .string(value.base64EncodedString())
        }
    }

    init(_ row: Row) {
        self = .object(Dictionary(uniqueKeysWithValues: row.map { (column, value) in (column, JSON(value)) }))
    }

    /// Every `uuid` that is not one the starting database had is replaced by "new", after checking it is a uuid: a restore
    /// that cannot keep a uuid draws a random one, which cannot be equal on two machines.
    func normalizingUuids(known: Set<String>) -> JSON {
        switch self {
        case .object(let fields):
            return .object(fields.reduce(into: [:]) { result, field in
                if field.key == "uuid", case .string(let uuid) = field.value {
                    result[field.key] = known.contains(uuid) ? field.value : .string(isUuid(uuid) ? "new" : "NOT A UUID: \(uuid)")
                } else {
                    result[field.key] = field.value.normalizingUuids(known: known)
                }
            })
        case .array(let items): return .array(items.map { $0.normalizingUuids(known: known) })
        default: return self
        }
    }

    /// Where two values first differ, as a path and both sides, or nil if equal.
    func difference(from other: JSON, path: String = "") -> String? {
        switch (self, other) {
        case (.object(let a), .object(let b)):
            for key in Set(a.keys).union(b.keys).sorted() {
                guard let x = a[key], let y = b[key] else { return "\(path).\(key): present on one side only" }
                if let found = x.difference(from: y, path: "\(path).\(key)") { return found }
            }
            return nil
        case (.array(let a), .array(let b)):
            if a.count != b.count { return "\(path): \(a.count) entries here, \(b.count) there" }
            for (index, pair) in zip(a, b).enumerated() {
                if let found = pair.0.difference(from: pair.1, path: "\(path)[\(index)]") { return found }
            }
            return nil
        default:
            return self == other ? nil : "\(path): \(self) here, \(other) there"
        }
    }
}

extension Data {
    /// The script's top-level "about" is prose; drop it so the rest decodes as a dictionary of step lists.
    func strippingAbout() throws -> Data {
        guard var object = try JSONSerialization.jsonObject(with: self) as? [String: Any] else { return self }
        object["about"] = nil
        return try JSONSerialization.data(withJSONObject: object)
    }
}
