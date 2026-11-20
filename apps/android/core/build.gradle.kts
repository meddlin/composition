// The Kotlin core (docs/android-app-design.md, "The core"): a port of the iPad's CompositionCore. No Android framework
// dependency, so its tests and the conformance corpus run on the Mac's JVM, as `swift test` runs the iPad core.
plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    api(libs.androidx.sqlite)
    implementation(libs.androidx.sqlite.bundled)
    implementation(libs.kotlinx.serialization.json)
    api(libs.kotlinx.coroutines.core)

    testImplementation(kotlin("test"))
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.junit.params)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    // The committed corpus; the desktop-made fixtures come from COMPOSITION_CONFORMANCE_DIR, which the test JVM inherits.
    systemProperty("composition.corpus", rootProject.projectDir.resolve("../../fixtures/conformance").canonicalPath)
    // The desktop's fixtures live outside the build, so Gradle cannot tell when they change: the suites always run (a few seconds).
    outputs.upToDateWhen { false }
    testLogging {
        events("passed", "skipped", "failed")
        showStandardStreams = true
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
