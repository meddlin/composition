// Runs the Kotlin core's own test sources (core/src/test/kotlin) on an emulator or a device, through Android's test runner, so
// the same suites that run on the Mac's JVM also run on Android's runtime, its build of the bundled SQLite, and its file system.
// The suites use kotlin.test's annotations, which are JUnit 5's on the JVM and JUnit 4's here. See scripts/test-on-device.sh.
plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "com.rushinglabs.composition.devicetests"
    compileSdk {
        version = release(36) { minorApiLevel = 1 }
    }

    defaultConfig {
        // The proposed minimum Android version (D7 of docs/android-app-design.md).
        minSdk = 31
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    sourceSets {
        getByName("androidTest") {
            kotlin.directories.add("../core/src/test/kotlin")
        }
    }

    // JUnit's jars each carry the same licence notices.
    packaging {
        resources.excludes += setOf("META-INF/LICENSE.md", "META-INF/LICENSE-notice.md")
    }
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        // The suites reach the core's `internal` parts, as tests in the core's own module may: a friend path makes this module one.
        val core = project(":core").layout.buildDirectory
        freeCompilerArgs.add(core.file("libs/core.jar").map { "-Xfriend-paths=${it.asFile.path},${core.get().dir("classes/kotlin/main").asFile.path}" })
    }
}

dependencies {
    androidTestImplementation(project(":core"))
    androidTestImplementation(libs.kotlinx.serialization.json)
    androidTestImplementation(libs.commonmark)
    androidTestImplementation(kotlin("test-junit"))
    // The suites' display names and the skip in `requireConformance` come from JUnit 5's API.
    androidTestImplementation(libs.junit.jupiter.api)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
}
