pluginManagement {
    // Use local build-tools if available (dev), otherwise pull from GitHub Packages Maven (CI)
    val localBuildTools = file("../util/packages/build-tools")
    if (localBuildTools.exists()) {
        includeBuild(localBuildTools)
    }
    repositories {
        maven {
            url = uri("https://maven.pkg.github.com/zerobias-org/util")
            credentials {
                username = System.getenv("GITHUB_ACTOR") ?: "zerobias-com"
                password = System.getenv("READ_TOKEN") ?: System.getenv("NPM_TOKEN") ?: System.getenv("GITHUB_TOKEN") ?: ""
            }
        }
        gradlePluginPortal()
        mavenCentral()
    }
    // Resolve latest build-tools from Maven (used in CI when local composite build is absent)
    plugins {
        id("zb.workspace") version "1.+"
        id("zb.base") version "1.+"
        id("zb.typescript-collectorbot") version "1.+"
    }
}

rootProject.name = "collectorbots"

// Auto-discover all collectorbots under package/
// A directory is a collectorbot if it contains build.gradle.kts
// Project names mirror filesystem: package/avigilon/alta/access → :avigilon:alta:access
val packageDir = file("package")
if (packageDir.exists()) {
    packageDir.walkTopDown()
        .filter { it.name == "build.gradle.kts" }
        .forEach { buildFile ->
            val moduleDir = buildFile.parentFile
            val relativePath = moduleDir.relativeTo(packageDir).path
            val projectPath = relativePath.replace(File.separatorChar, ':')

            include(projectPath)
            project(":$projectPath").projectDir = moduleDir
        }
}
