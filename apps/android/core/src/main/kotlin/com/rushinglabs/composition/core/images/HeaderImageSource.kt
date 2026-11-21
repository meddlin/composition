package com.rushinglabs.composition.core.images

import com.rushinglabs.composition.core.markdown.NoteImage
import com.rushinglabs.composition.core.yaml.JavaScriptText

/**
 * Where a note's header image comes from: the twin of the desktop's `headerImageSrc` and `headerImageName` (headerImageSource.ts),
 * ported from HeaderImageSource.swift. The frontmatter's `headerImage` is `app_data/<name>` for a stored picture, or an `https://`
 * address typed by hand. Anything else (a `data:` URI, a stray word) is not a header image, so a half-typed value shows nothing rather
 * than something broken.
 */
sealed interface HeaderImageSource {
    /** A picture in `app_data/`, by file name. */
    data class Stored(val name: String) : HeaderImageSource

    /** An `http://` or `https://` address. Whether the app fetches it is the app's decision (the iPad names it and draws nothing). */
    data class Web(val address: String) : HeaderImageSource

    companion object {
        /** What `ref` (the frontmatter's `headerImage`) points at, or null when it points at nothing a header image can be. */
        fun resolve(ref: String): HeaderImageSource? {
            NoteImage.nameFromRef(ref)?.let { return Stored(it) }
            return if (isWebAddress(ref)) Web(ref) else null
        }

        /** The stored picture's file name when `ref` is one (what the picker marks as chosen), else null. */
        fun storedName(ref: String?): String? = (ref?.let(::resolve) as? Stored)?.name

        /**
         * `/^https?:\/\/\S+$/i`: the scheme in either case (ASCII only, as JavaScript's `i` without `u` is), then at least one
         * character and none of JavaScript's white space.
         */
        private fun isWebAddress(ref: String): Boolean {
            fun startsWith(prefix: String) =
                ref.length >= prefix.length && prefix.indices.all { val c = ref[it]; (if (c in 'A'..'Z') c + 32 else c) == prefix[it] }
            val rest = when {
                startsWith("https://") -> 8
                startsWith("http://") -> 7
                else -> return false
            }
            return ref.length > rest && (rest until ref.length).none { JavaScriptText.isWhitespace(ref[it].code) }
        }
    }
}
