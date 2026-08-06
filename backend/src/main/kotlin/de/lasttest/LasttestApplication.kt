package de.lasttest

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.properties.ConfigurationPropertiesScan
import org.springframework.boot.runApplication

@SpringBootApplication
@ConfigurationPropertiesScan
class LasttestApplication

fun main(args: Array<String>) {
    runApplication<LasttestApplication>(*args)
}
