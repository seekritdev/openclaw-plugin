# @seekrit/openclaw-plugin

seekrit as an [OpenClaw](https://docs.openclaw.ai) **SecretRef provider**. Your
gateway config names credentials instead of holding them; the values are
decrypted on your machine, by your credential, when OpenClaw starts.

```bash
openclaw plugins install npm:@seekrit/openclaw-plugin
openclaw plugins enable seekrit
seekrit openclaw init --write
```

Then any credential OpenClaw accepts a SecretRef for becomes a reference:

```json5
{ source: "exec", provider: "seekrit", id: "OPENAI_API_KEY" }
```

Full guide: **<https://seekrit.dev/docs/guides/ai-agents/openclaw>**

## What this package is

A manifest and a resolver — no tools, no channels, and no capability prompts at
install time. OpenClaw reads `secretProviderIntegrations` out of
`openclaw.plugin.json` and spawns `seekrit-secret-ref-resolver.js` when it needs
values.

The resolver is a stdio bridge onto `seekrit openclaw resolve`, so the protocol
has exactly one implementation. Decryption happens in a short-lived child
process that exits when the batch is answered: the gateway never holds a token,
a data key, or a plaintext, and the seekrit API never sees one either.

`index.js` is a runtime entrypoint that **registers nothing**. It exists only
because ClawHub classifies any package carrying an `openclaw.plugin.json` as a
*code plugin* and won't publish one without an `openclaw.extensions` entry — a
manifest-only plugin has no category in the registry today. The gateway
therefore imports one inert module of ours at startup. That doesn't move the
boundary that matters, since decryption still happens in the child process, but
it does mean "OpenClaw executes none of our code in-process" is no longer
strictly true, and it seemed better to say so than to drop the claim quietly.

## Ids

Two shapes, mirroring `op://vault/item/field`:

| id | resolves against |
| --- | --- |
| `OPENAI_API_KEY` | the environment your credential already points at |
| `billing-api/production/STRIPE_SECRET_KEY` | that application and environment |

A bare name is the common case, and the only one a service token needs — the
token is already bound to an environment.

## Credentials

The resolver runs with the environment allowlist the manifest declares, and
finds its credential there. Any of these work:

- `SEEKRIT_TOKEN` — a service token (`skt_`), scoped to one environment.
- `SEEKRIT_CLIENT_ID` + `SEEKRIT_CLIENT_SECRET` — machine credentials, from
  which the CLI mints and caches an admin token.
- a `seekrit login` session in `$HOME`, for a workstation gateway.

`SEEKRIT_CLI` overrides which CLI the resolver runs, and must be an absolute
path.

## Two things that will surprise you

**Resolution is eager.** OpenClaw reads every active ref once at startup and
config reload, into one in-memory snapshot — it does not re-resolve per request.
After you rotate a secret, run `openclaw secrets reload`, or the gateway keeps
serving the old value until it restarts.

**A `--link`ed install will not work.** OpenClaw only honours
`secretProviderIntegrations` from plugins whose origin is `bundled` or `global`,
so a locally linked development copy is installed but inert. Install from npm.

## Not a process boundary

A SecretRef keeps plaintext out of `openclaw.json`, `models.json`, and the
gateway's SQLite. It does not stop the agent from reading a resolved value —
OpenClaw says as much about its own egress sentinels. If the point is that the
agent must *never* hold the key, put it behind the
[egress proxy](https://seekrit.dev/docs/guides/agent-proxy) and give the agent a
`{{seekrit:NAME}}` placeholder instead.

## License

MIT
