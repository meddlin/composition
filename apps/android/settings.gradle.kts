// The Android app (docs/android-app-design.md). Spike A1: only the Kotlin core so far, and its tests on a device.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "composition-android"

include(":core")
// Runs :core's own test sources on an emulator or device, through Android's test runner (spike A1).
include(":core-device-tests")
