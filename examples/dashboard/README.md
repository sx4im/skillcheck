# Skillcheck dashboard

A single static file (`index.html`) where a user pastes their Skillcheck API URL and gets the commands to start using the CLI, a connection test, and an in-browser "with vs without skill" preview.

```bash
# open it directly
xdg-open index.html        # macOS: open index.html  ·  Windows: start index.html

# or serve it
npx --yes serve .
```

Nothing to build or configure — the API URL and optional token are entered at runtime and stored in the browser's localStorage.

The live preview calls `POST <apiUrl>/chat/completions`, so the API must allow the page's origin via CORS. The bundled `../nvidia-proxy` already returns `access-control-allow-origin: *`, so the preview works even from `file://`. See [`../../dashboard.md`](../../dashboard.md) for the full write-up and [`../../docs/skillcheck-cloud.md`](../../docs/skillcheck-cloud.md) for the API contract.
