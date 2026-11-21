package com.rushinglabs.composition.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File
import java.math.BigDecimal
import java.util.Base64

// Shared by the tests that replay a script against the desktop's record of it (the Trash Can and the store), as
// ConformanceJSON.swift is for the iPad core.

fun readJson(file: File): JsonElement = Json.parseToJsonElement(file.readText())

/** The `steps` of a script or of the desktop's record of it. */
fun steps(file: File): List<JsonObject> = readJson(file).jsonObject.getValue("steps").jsonArray.map { it.jsonObject }

fun json(value: Any?): JsonElement = when (value) {
    null -> JsonNull
    is Long -> JsonPrimitive(value)
    is Int -> JsonPrimitive(value)
    is Double -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is String -> JsonPrimitive(value)
    is ByteArray -> JsonPrimitive(Base64.getEncoder().encodeToString(value))
    is JsonElement -> value
    else -> error("no JSON for ${value::class}")
}

fun json(row: Row): JsonObject = JsonObject(row.columns.mapValues { json(it.value) })

fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.takeIf { !it.isString && it.content != "null" }?.content?.toLong()
fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

/**
 * Every `uuid` that is not one the starting database had is replaced by "new", after checking it is a uuid: a restore that
 * cannot keep a uuid draws a random one, which cannot be equal on two machines.
 */
fun JsonElement.normalizingUuids(known: Set<String>): JsonElement = when (this) {
    is JsonObject -> JsonObject(mapValues { (key, value) ->
        if (key == "uuid" && value is JsonPrimitive && value.isString) {
            if (value.content in known) value else JsonPrimitive(if (isUuid(value.content)) "new" else "NOT A UUID: ${value.content}")
        } else value.normalizingUuids(known)
    })
    is JsonArray -> JsonArray(map { it.normalizingUuids(known) })
    else -> this
}

/** Where two values first differ, as a path and both sides, or null if equal. Numbers compare by value. */
fun JsonElement.difference(other: JsonElement, path: String = ""): String? {
    if (this is JsonObject && other is JsonObject) {
        for (key in (keys + other.keys).sorted()) {
            val mine = this[key]
            val theirs = other[key]
            if (mine == null || theirs == null) return "$path.$key: present on one side only"
            mine.difference(theirs, "$path.$key")?.let { return it }
        }
        return null
    }
    if (this is JsonArray && other is JsonArray) {
        if (size != other.size) return "$path: $size entries here, ${other.size} there"
        for (index in indices) this[index].difference(other[index], "$path[$index]")?.let { return it }
        return null
    }
    if (this is JsonPrimitive && other is JsonPrimitive && !isString && !other.isString && this !is JsonNull && other !is JsonNull) {
        val a = content.toBigDecimalOrNull()
        val b = other.content.toBigDecimalOrNull()
        if (a != null && b != null) return if (a.compareTo(b) == 0) null else "$path: $this here, $other there"
    }
    return if (this == other) null else "$path: $this here, $other there"
}

private fun String.toBigDecimalOrNull(): BigDecimal? = runCatching { BigDecimal(this) }.getOrNull()
