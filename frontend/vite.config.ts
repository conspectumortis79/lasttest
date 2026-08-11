import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8286',
      // The bundled demo backend (DemoProductController,
      // DemoSwaggerUiController) is mounted OUTSIDE the `/api`
      // prefix in Spring — `/demo-api/**` and `/demo-swagger-ui`.
      // Without these two proxy entries, `fetch('/demo-api/...')`
      // and `fetch('/demo-swagger-ui')` calls made from the Vite
      // dev server (port 5173) never reach Spring Boot (port
      // 8286); Vite's SPA fallback answers with `index.html`
      // instead, which is indistinguishable from a real 200 OK
      // until something inspects the body. This was the exact
      // failure in the e2e suite's "imports a specification from
      // a Swagger UI URL" test: `GET /demo-swagger-ui` returned
      // Vite's `index.html` (200 OK) instead of the Swagger UI
      // page, so `expect(...).toContain('SwaggerUIBundle')`
      // failed on unrelated HTML.
      '/demo-api': 'http://localhost:8286',
      '/demo-swagger-ui': 'http://localhost:8286',
    },
  },
})
