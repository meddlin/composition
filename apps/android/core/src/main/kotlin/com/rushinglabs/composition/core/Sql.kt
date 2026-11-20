package com.rushinglabs.composition.core

import androidx.sqlite.SQLITE_DATA_BLOB
import androidx.sqlite.SQLITE_DATA_FLOAT
import androidx.sqlite.SQLITE_DATA_INTEGER
import androidx.sqlite.SQLITE_DATA_NULL
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.driver.bundled.SQLITE_OPEN_CREATE
import androidx.sqlite.driver.bundled.SQLITE_OPEN_READONLY
import androidx.sqlite.driver.bundled.SQLITE_OPEN_READWRITE
import androidx.sqlite.driver.bundled.SQLITE_OPEN_URI
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

// What GRDB gives the iPad core, over AndroidX's bundled SQLite: one connection per file, statements with bound arguments,
// rows by column name, transactions, and scripts of several statements. The bundled SQLite is built multi-threaded (a
// connection must not be shared between threads at once), so every use of the connection goes through one lock, as a GRDB
// `DatabaseQueue` does. Concurrent readers (the iPad's `DatabasePool`) are a later step.

/** One row of a result, by column name, in the order SQLite gave the columns. Values are Long, Double, String, ByteArray or null. */
class Row(val columns: LinkedHashMap<String, Any?>) {
    operator fun get(column: String): Any? = columns[column]
    fun long(column: String): Long = columns[column] as Long
    fun longOrNull(column: String): Long? = columns[column] as Long?
    fun string(column: String): String = columns[column] as String
    fun stringOrNull(column: String): String? = columns[column] as String?
    override fun toString(): String = columns.toString()
}

/** An open connection, valid inside one `read`, `write` or `writeWithoutTransaction`. */
class Db internal constructor(private val connection: SQLiteConnection) {
    /** Runs one or more statements (a schema block, say). Arguments bind to the only statement there may then be. */
    fun execute(sql: String, vararg arguments: Any?) {
        val statements = SqlScript.split(sql)
        require(arguments.isEmpty() || statements.size == 1) { "arguments need exactly one statement" }
        for (text in statements) {
            connection.prepare(text).use { statement ->
                bind(statement, arguments)
                while (statement.step()) { /* a statement that returns rows, such as a PRAGMA, is run to the end */ }
            }
        }
    }

    fun rows(sql: String, vararg arguments: Any?): List<Row> =
        connection.prepare(sql).use { statement ->
            bind(statement, arguments)
            val result = ArrayList<Row>()
            while (statement.step()) {
                val columns = LinkedHashMap<String, Any?>()
                for (index in 0 until statement.getColumnCount()) columns[statement.getColumnName(index)] = value(statement, index)
                result.add(Row(columns))
            }
            result
        }

    fun row(sql: String, vararg arguments: Any?): Row? = rows(sql, *arguments).firstOrNull()

    /** The first column of the first row, or null when there is no row (or the value is NULL). */
    fun value(sql: String, vararg arguments: Any?): Any? =
        connection.prepare(sql).use { statement ->
            bind(statement, arguments)
            if (statement.step()) value(statement, 0) else null
        }

    fun long(sql: String, vararg arguments: Any?): Long? = value(sql, *arguments) as Long?
    fun string(sql: String, vararg arguments: Any?): String? = value(sql, *arguments) as String?

    fun longs(sql: String, vararg arguments: Any?): List<Long> = rows(sql, *arguments).map { it.columns.values.first() as Long }
    fun strings(sql: String, vararg arguments: Any?): List<String> = rows(sql, *arguments).map { it.columns.values.first() as String }

    val lastInsertedRowId: Long get() = long("SELECT last_insert_rowid()")!!
    val changesCount: Long get() = long("SELECT changes()")!!

    /** `BEGIN IMMEDIATE` … `COMMIT`, or `ROLLBACK` when `body` throws. */
    fun <T> inImmediateTransaction(body: () -> T): T {
        execute("BEGIN IMMEDIATE")
        val result = try {
            body()
        } catch (error: Throwable) {
            runCatching { execute("ROLLBACK") }
            throw error
        }
        execute("COMMIT")
        return result
    }

    private fun bind(statement: SQLiteStatement, arguments: Array<out Any?>) {
        arguments.forEachIndexed { offset, argument ->
            val index = offset + 1
            when (argument) {
                null -> statement.bindNull(index)
                is Long -> statement.bindLong(index, argument)
                is Int -> statement.bindLong(index, argument.toLong())
                is Boolean -> statement.bindLong(index, if (argument) 1 else 0)
                is Double -> statement.bindDouble(index, argument)
                is String -> statement.bindText(index, argument)
                is ByteArray -> statement.bindBlob(index, argument)
                else -> throw IllegalArgumentException("can't bind ${argument::class}")
            }
        }
    }

    private fun value(statement: SQLiteStatement, index: Int): Any? =
        when (statement.getColumnType(index)) {
            SQLITE_DATA_NULL -> null
            SQLITE_DATA_INTEGER -> statement.getLong(index)
            SQLITE_DATA_FLOAT -> statement.getDouble(index)
            SQLITE_DATA_BLOB -> statement.getBlob(index)
            else -> statement.getText(index)
        }
}

/** A database file and its one connection. */
class SqliteFile private constructor(private val connection: SQLiteConnection) : AutoCloseable {
    private val lock = ReentrantLock()
    private var closed = false

    /**
     * Fires after every write this file commits: what a list on screen re-reads on (the counterpart of GRDB's `ValueObservation`).
     * Only this process writes the file on Android, so its own writes are all there is to watch. Extra signals are dropped, not
     * queued: a reader that is behind re-reads once.
     */
    val changes = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    fun <T> read(body: (Db) -> T): T = lock.withLock { check(!closed) { "closed" }; body(Db(connection)) }

    /** A write transaction (`BEGIN IMMEDIATE`), rolled back if `body` throws. */
    fun <T> write(body: (Db) -> T): T = lock.withLock {
        check(!closed) { "closed" }
        val db = Db(connection)
        db.inImmediateTransaction { body(db) }
    }.also { changes.tryEmit(Unit) }

    /** No transaction around `body`: for `VACUUM INTO`, schema passes that manage their own, and the like. */
    fun <T> writeWithoutTransaction(body: (Db) -> T): T =
        lock.withLock { check(!closed) { "closed" }; body(Db(connection)) }.also { changes.tryEmit(Unit) }

    /** Closing the last connection checkpoints the write-ahead log into the main file and removes it. */
    override fun close() = lock.withLock {
        if (!closed) {
            closed = true
            connection.close()
        }
    }

    companion object {
        private val driver = BundledSQLiteDriver()

        /** Opens (creating if needed) a database in WAL mode, as the desktop's `db.ts` and the iPad's GRDB pool do. */
        fun open(path: String): SqliteFile {
            val connection = driver.open(path, SQLITE_OPEN_READWRITE or SQLITE_OPEN_CREATE)
            Db(connection).apply {
                execute("PRAGMA busy_timeout = 5000")
                execute("PRAGMA journal_mode = WAL")
            }
            return SqliteFile(connection)
        }

        /**
         * Opens a database file nothing else is using, read-only and `immutable=1`, as the iPad core opens a backup's database: a
         * file whose header says WAL cannot otherwise be read without creating side files. The URI flag is passed explicitly, so
         * this does not depend on the SQLite having been built with `SQLITE_USE_URI` (Apple's has; see the design doc).
         */
        fun openImmutable(path: String): SqliteFile {
            val uri = "file:" + java.net.URI(null, null, path, null).rawPath + "?immutable=1"
            return SqliteFile(driver.open(uri, SQLITE_OPEN_READONLY or SQLITE_OPEN_URI))
        }
    }
}

/**
 * Splits a block of SQL into statements at the semicolons that end them, keeping each statement's text as written (SQLite keeps
 * a trigger's text verbatim in `sqlite_master`). Quotes, comments and a trigger's `BEGIN … END` body are not split. The
 * bundled driver prepares one statement at a time, where GRDB's `execute` runs a whole block.
 */
object SqlScript {
    private val triggerStart = Regex("""^CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b""", RegexOption.IGNORE_CASE)
    private val endsWithEnd = Regex("""\bEND\s*$""", RegexOption.IGNORE_CASE)

    fun split(sql: String): List<String> {
        val statements = ArrayList<String>()
        val current = StringBuilder()
        var index = 0
        while (index < sql.length) {
            val char = sql[index]
            when {
                char == '-' && sql.startsWith("--", index) -> {
                    val end = sql.indexOf('\n', index).let { if (it < 0) sql.length else it }
                    current.append(sql, index, end); index = end; continue
                }
                char == '/' && sql.startsWith("/*", index) -> {
                    val end = sql.indexOf("*/", index + 2).let { if (it < 0) sql.length else it + 2 }
                    current.append(sql, index, end); index = end; continue
                }
                char == '\'' || char == '"' || char == '`' || char == '[' -> {
                    val close = if (char == '[') ']' else char
                    var end = index + 1
                    while (end < sql.length) {
                        if (sql[end] == close) {
                            if (close != ']' && end + 1 < sql.length && sql[end + 1] == close) { end += 2; continue }
                            break
                        }
                        end++
                    }
                    end = minOf(end + 1, sql.length)
                    current.append(sql, index, end); index = end; continue
                }
                char == ';' -> {
                    val text = current.toString().trim()
                    if (text.isEmpty()) { current.clear() } else if (!triggerStart.containsMatchIn(text) || endsWithEnd.containsMatchIn(text)) {
                        statements.add(text); current.clear()
                    } else current.append(char)
                    index++; continue
                }
            }
            current.append(char)
            index++
        }
        current.toString().trim().takeIf { it.isNotEmpty() }?.let { statements.add(it) }
        return statements
    }
}
