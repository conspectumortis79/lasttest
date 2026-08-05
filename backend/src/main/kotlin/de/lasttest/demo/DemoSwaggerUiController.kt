package de.lasttest.demo

import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

/**
 * Liefert eine Swagger-UI-Seite, die ihre Spezifikation über die bestehende
 * Demo-Route `/api/demo-specification` lädt. Damit lässt sich der
 * "URL zur Swagger-UI"-Workflow End-to-End testen, ohne dass ein externes
 * System benötigt wird.
 *
 * Die Swagger-UI-Bibliothek wird zur Laufzeit vom unpkg-CDN geladen. Wenn
 * das Build offline laufen muss, kann die URL über `lasttest.swagger-ui-cdn`
 * überschrieben werden.
 */
@RestController
class DemoSwaggerUiController {
    @GetMapping("/demo-swagger-ui", produces = [MediaType.TEXT_HTML_VALUE])
    fun swaggerUi(): String = SWAGGER_UI_HTML

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
