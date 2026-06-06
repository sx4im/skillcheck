# skillcheck NVIDIA proxy

This is the safe way to let CLI users run `skillcheck` without seeing your NVIDIA key.

Run the proxy on a server:

```bash
export NVIDIA_API_KEY=...
node examples/nvidia-proxy/server.mjs
```

Point the CLI at the proxy:

```bash
export SKILLCHECK_API_URL=https://your-proxy.example.com/v1
skillcheck check path/to/SKILL.md
```

Do not publish `NVIDIA_API_KEY` inside the npm package. If the proxy is public, put it behind rate limiting, quotas, or authentication before sharing it broadly.
