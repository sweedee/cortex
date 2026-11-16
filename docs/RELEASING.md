# Releasing

Cortex is a web app: there is no installer. A release is the built output plus `package.json`.

```
npm run build      # typecheck, bundle the renderer to out/renderer and the server to out/server/index.js
npm start          # run it: node out/server/index.js, prints the URL to open (PORT defaults to 4317)
```

What ships: `out/`, `package.json`, `scripts/jira-mock/` (a child process, used when `jira.cli` is `mock`) and the runtime dependencies (`npm install --omit=dev` on the target;
`cross-spawn`, `ws` and `zod` are the only ones the server imports at runtime, so keep it that way: a
dependency the server imports at runtime must go in `dependencies`, not `devDependencies`). The server
binds `127.0.0.1` only (see [README → Security](../README.md#security)); it runs `git`, `gh` and `claude` as
the user who starts it, so run it on the user's own machine.

Bump `version` in package.json before a release.
