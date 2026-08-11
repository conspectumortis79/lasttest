package de.lasttest.demo

import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException

@RestController
class DemoSwaggerUiController(
    private val demoControllerToggle: DemoControllerToggle,
) {
    @GetMapping("/demo-swagger-ui", produces = [MediaType.TEXT_HTML_VALUE])
    fun swaggerUi(): String {
        if (!demoControllerToggle.isEnabled()) {
            throw ResponseStatusException(HttpStatus.NOT_FOUND, "Demo API is disabled")
        }
        return SWAGGER_UI_HTML
    }

    private companion object {
        const val SWAGGER_UI_HTML: String = """<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>lasttest Demo Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin="anonymous"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: "/api/demo-specification",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis
        ]
      });
    };
  </script>
</body>
</html>
"""
    }
}
