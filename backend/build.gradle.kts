import org.gradle.testing.jacoco.tasks.JacocoReportBase

plugins {
    kotlin("jvm") version "2.3.21"
    kotlin("plugin.spring") version "2.3.21"
    id("org.springframework.boot") version "4.1.0"
    id("io.spring.dependency-management") version "1.1.7"
    id("org.jlleitschuh.gradle.ktlint") version "14.0.1"
    jacoco
}

group = "de.lasttest"
version = "0.1.0"
description = "OpenAPI-driven k6 load testing"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    implementation("tools.jackson.module:jackson-module-kotlin")
    implementation("io.swagger.parser.v3:swagger-parser:2.1.37")

    testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
    testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

kotlin {
    compilerOptions {
        freeCompilerArgs.addAll("-Xjsr305=strict", "-Xannotation-default-target=param-property")
    }
}

tasks.withType<Test> {
    useJUnitPlatform()
    finalizedBy(tasks.jacocoTestReport)
}

jacoco {
    toolVersion = "0.8.14"
}

val coverageIncludes =
    listOf(
        "de/lasttest/api/LastTestController.class",
        "de/lasttest/config/StartupMessageLogger.class",
        "de/lasttest/demo/DemoProductController.class",
        "de/lasttest/demo/DemoSpecificationProvider.class",
        "de/lasttest/demo/DemoSwaggerUiController.class",
        "de/lasttest/domain/DefaultK6ScriptGenerator.class",
        "de/lasttest/domain/HttpRemoteSpecificationFetcher.class",
        "de/lasttest/domain/JdkRemoteSpecificationClient.class",
        "de/lasttest/domain/LocalK6TestRunService.class",
        "de/lasttest/domain/SwaggerSpecificationImporter.class",
    )

fun JacocoReportBase.includeProductionLogic() {
    classDirectories.setFrom(
        sourceSets.main.get().output.asFileTree.matching {
            coverageIncludes.forEach(::include)
        },
    )
}

tasks.processResources {
    from(layout.projectDirectory.dir("../demo")) {
        include("openapi-demo.yaml")
        into("demo")
    }
}

tasks.jacocoTestReport {
    dependsOn(tasks.test)
    includeProductionLogic()
    reports {
        html.required = true
        xml.required = true
    }
}

tasks.jacocoTestCoverageVerification {
    dependsOn(tasks.test)
    includeProductionLogic()
    violationRules {
        rule {
            listOf("INSTRUCTION", "LINE", "BRANCH").forEach { counterName ->
                limit {
                    counter = counterName
                    minimum = "1.0".toBigDecimal()
                }
            }
        }
    }
}

tasks.check {
    dependsOn(tasks.jacocoTestCoverageVerification)
}
