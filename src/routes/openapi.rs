use axum::response::{Html, IntoResponse};
use axum::http::header;

const SPEC: &str = include_str!("../openapi.yaml");

const SWAGGER_HTML: &str = r##"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>dbv API docs</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2" />
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body  { margin: 0; }
      .swagger-ui .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      SwaggerUIBundle({
        url: "/api/openapi.yaml",
        dom_id: "#swagger-ui",
        deepLinking: true,
        persistAuthorization: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset,
        ],
        layout: "BaseLayout",
      });
    </script>
  </body>
</html>"##;

pub async fn swagger_ui() -> Html<&'static str> {
    Html(SWAGGER_HTML)
}

pub async fn openapi_spec() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/yaml")],
        SPEC,
    )
}
