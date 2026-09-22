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

## Capabilities

See the [capability overview](CAPABILITY_MATRIX.md) for a short description of
the available user-facing functions.

## Security

The bridge operates with the local user's permissions. Give it access only to
workspaces you trust. Read-only mode is not an operating-system sandbox. Keep
network access local and do not expose the service to untrusted networks.

See the repository's [security policy](../../SECURITY.md).

## License

MIT; see the repository [LICENSE](../../LICENSE).
