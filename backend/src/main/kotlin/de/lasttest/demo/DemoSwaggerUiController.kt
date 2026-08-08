package de.lasttest.demo

import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException

/**
 * Serves a Swagger UI page that loads its specification through the
 * existing demo route `/api/demo-specification`. This lets us test
 * the "URL to Swagger UI" workflow end-to-end without needing an
 * external system.
 *
 * The Swagger UI library is loaded at runtime from the unpkg CDN. If
 * the build has to run offline, the URL can be overridden via
 * `lasttest.swagger-ui-cdn`.
 *
 * The page is only served when the bundled demo API is enabled.
 * Returning 404 here matches the behaviour of the demo controller
 * itself (it also short-circuits to 404 when the toggle is off) so
 * a user who disabled the demo and then opens
 * `http://localhost:8286/demo-swagger-ui` (e.g. via a bookmark, a
 * stale browser tab or the user guide) sees a consistent "demo is
 * off" state instead of a Swagger UI that silently loads nothing
 * because the spec endpoint behind it returns 404. The check is the
 * single source of truth for "is the demo on?" — we deliberately
 * do not duplicate the toggle state.
 *
 * SOLID notes:
 *  - S — the controller's only responsibility is serving the
 *    Swagger UI page; the "is the demo on?" check is delegated to
 *    [DemoControllerToggle].
 *  - D — depends on the [DemoControllerToggle] interface, not on a
 *    concrete implementation. A future test toggle (or a
 *    file-backed one) is a one-line constructor change.
 */
@RestController
class DemoSwaggerUiController(
    private val demoControllerToggle: DemoControllerToggle,
) {
    @GetMapping("/demo-swagger-ui", produces = [MediaType.TEXT_HTML_VALUE])
    fun swaggerUi(): String {
        if (!demoControllerToggle.isEnabled()) {
            // 404 is the canonical "this resource is not
            // available" code. A 410 (Gone) would also fit, but
            // the demo might be re-enabled later, so 404 is
            // the better fit for "currently unavailable".
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
