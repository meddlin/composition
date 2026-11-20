package com.rushinglabs.composition.core

import java.io.File

/** Where the app keeps its data: the same layout as the desktop's data directory (ported from Backup.swift). */
data class DataLocation(val directory: File) {
    val databaseFile: File get() = File(directory, "composition.db")
    /** Pasted images. */
    val imagesDirectory: File get() = File(directory, BackupNames.IMAGE_DIRECTORY)
    /** Attached files. */
    val attachmentsDirectory: File get() = File(directory, BackupNames.ATTACHMENT_DIRECTORY)
    /** The PDFs notes own. */
    val documentsDirectory: File get() = File(directory, BackupNames.DOCUMENT_DIRECTORY)
    /** Text typed but not yet in the database. Never part of a backup. */
    val draftsDirectory: File get() = File(directory, "drafts")
    /** The settings a backup carries. */
    val settingsFile: File get() = File(directory, BackupNames.SETTINGS)
}

internal object BackupNames {
    const val FORMAT = "composition-backup"
    const val FORMAT_VERSION = 1
    const val MANIFEST = "composition-backup.json"
    const val SETTINGS = "settings.json"
    const val DATABASE = "composition.db"
    const val IMAGE_DIRECTORY = "app_data"
    const val ATTACHMENT_DIRECTORY = "attachments"
    const val DOCUMENT_DIRECTORY = "documents"
    /** SQLite's side files; present only while a connection is open, or after a crash. */
    val databaseSuffixes = listOf("-wal", "-shm", "-journal")
    /** Manifest and settings are small; anything bigger is not one. */
    const val MAX_JSON_BYTES = 1024 * 1024

    private fun isAlphanumeric(c: Char) = c in '0'..'9' || c in 'a'..'z' || c in 'A'..'Z'

    /** `^[A-Za-z0-9][A-Za-z0-9._-]*$`: one path segment, no leading dot. */
    fun isStoredName(name: String): Boolean {
        val first = name.firstOrNull() ?: return false
        if (!isAlphanumeric(first)) return false
        return name.all { isAlphanumeric(it) || it == '.' || it == '_' || it == '-' }
    }

    /** `imageRefs.ts`: `^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|gif|webp)$`, case-insensitive on the extension. */
    fun isImageName(name: String): Boolean {
        if (!isStoredName(name)) return false
        val dot = name.lastIndexOf('.')
        if (dot <= 0) return false
        return name.substring(dot + 1).lowercase() in listOf("png", "jpg", "jpeg", "gif", "webp")
    }
}
