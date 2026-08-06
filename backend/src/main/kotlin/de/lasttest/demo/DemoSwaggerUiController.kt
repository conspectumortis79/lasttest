package de.lasttest.demo

import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

/**
 * Serves a Swagger UI page that loads its specification through the
 * existing demo route `/api/demo-specification`. This lets us test
 * the "URL to Swagger UI" workflow end-to-end without needing an
 * external system.
 *
 * The Swagger UI library is loaded at runtime from the unpkg CDN. If
 * the build has to run offline, the URL can be overridden via
 * `lasttest.swagger-ui-cdn`.
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
