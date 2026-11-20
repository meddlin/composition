package com.rushinglabs.composition.core.organization

/** Where on a row a drag is hovering: above it, onto it, or below it. A port of `dropEdge.ts`, by way of DropEdge.swift. */
enum class DropEdge(val rawValue: String) {
    BEFORE("before"), INTO("into"), AFTER("after");

    companion object {
        /** The share of a row's height, at each end, that counts as its edge when it can also be dropped onto. */
        internal const val EDGE_BAND = 0.25

        fun of(rawValue: String): DropEdge? = entries.firstOrNull { it.rawValue == rawValue }

        /**
         * Which edge of a row the pointer is on, given the edges the drag may use there; null when it may use none. A row that can be
         * dropped onto keeps its middle for that and gives only the outer bands to `BEFORE` and `AFTER`; one that can only be placed
         * beside (a note) splits down the middle.
         */
        fun at(offsetY: Double, height: Double, allowed: List<DropEdge>): DropEdge? {
            if (INTO in allowed) {
                if (offsetY < height * EDGE_BAND && BEFORE in allowed) return BEFORE
                if (offsetY > height * (1 - EDGE_BAND) && AFTER in allowed) return AFTER
                return INTO
            }
            val preferred = if (offsetY < height / 2) BEFORE else AFTER
            if (preferred in allowed) return preferred
            return allowed.firstOrNull { it == BEFORE || it == AFTER }
        }
    }
}
