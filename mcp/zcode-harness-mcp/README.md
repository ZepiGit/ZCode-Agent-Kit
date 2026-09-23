# zcode-harness-mcp
**English (original)** · [Deutsch](README.de.md)

A local Model Context Protocol server that connects an MCP client to a ZCode
Desktop session. It provides workspace-scoped session and task controls,
interactive questions, and access to task results.

## Requirements

- Node.js 20 or newer
- ZCode Desktop installed and signed in
- An MCP client that supports a local stdio server

## Build and run

From this directory:

```sh
npm install
npm run build
npm run start:stdio
```

Register the `start:stdio` command with your MCP client. Each client has its
own configuration format; use the absolute path to this package where the
client requires one.

The bundled provider path is resolved from the verified runtime entrypoint, not the
working directory. Nonblank `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` takes precedence
over `ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE`, then the discovered bundle.
Only the child environment is adjusted; `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` is
preserved, the parent is unchanged, and an invalid explicit seed fails rather than
falling back. Native config materialization remains the vendor's responsibility.
See [security details](docs/SECURITY.md).

## Capabilities

See the [capability overview](CAPABILITY_MATRIX.md) for a short description of
the available user-facing functions.

Native 0.16.9: `workspace/readPresentation` returns presentation only, not defaults,
a catalog, or a settings revision. `zcode_models_list` creates and closes an owned
deferred session without a prompt; it may initialize runtime services and is blocked
by `--read-only`. Native session model/mode/reasoning selection is supported;
persistent workspace setters/reset are unsupported, with no local fallback. Runtime
preference updates affect the shared app-server process; their acknowledgement is
not independent read-back. See [API details](docs/MCP_API.md).

The current native catalog was verified to include `zai-api/GLM-5.3-Flash`; native
A native Flash request on Windows with ZCode 0.16.9 and `low` reasoning was
blocked by upstream code `1113` (insufficient balance/resource package). No native
Flash answer is claimed. Proxy success is not MCP model success;
0.16.5 observations in the technical docs are historical.

## Security

The bridge operates with the local user's permissions. Give it access only to
workspaces you trust. Read-only mode is not an operating-system sandbox. Keep
network access local and do not expose the service to untrusted networks.

See the repository's [security policy](../../SECURITY.md).

## License

MIT; see the repository [LICENSE](../../LICENSE).
