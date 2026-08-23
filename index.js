/**
 * The plugin's runtime entrypoint.
 *
 * It registers nothing, and that is deliberate. Everything this plugin does
 * lives in `openclaw.plugin.json`: OpenClaw reads `secretProviderIntegrations`
 * out of the manifest without executing anything, and spawns
 * `seekrit-secret-ref-resolver.js` as a short-lived child process when it needs
 * values. There is no in-process work to do.
 *
 * This file exists because ClawHub classifies any package carrying an
 * `openclaw.plugin.json` (and no `.claude-plugin`/`.codex-plugin`/`.cursor-plugin`
 * bundle marker) as a *code plugin*, and refuses to publish one that doesn't
 * declare `openclaw.extensions` — a manifest-only plugin has no category in the
 * registry today. See `extractCodePluginArtifacts` in
 * openclaw/clawhub `convex/lib/packageRegistry.ts`.
 *
 * The trade that makes: the gateway now imports this module at startup, where
 * before it imported nothing of ours. The boundary that actually matters is
 * unchanged — decryption still happens in a child process that exits when the
 * batch is answered, so the gateway still never holds a token, a data key, or a
 * plaintext. But "OpenClaw runs none of our code in-process" is no longer true,
 * and the README says so rather than quietly dropping the claim.
 *
 * Keep `register` empty. Anything added here runs inside the gateway with the
 * gateway's privileges, which is the thing this design was avoiding. If a CLI
 * surface is ever wanted, weigh it against that.
 *
 * Written as plain JS with no imports on purpose: `definePluginEntry` from
 * `openclaw/plugin-sdk/plugin-entry` is a shaping helper that returns exactly
 * this object literal, and importing it would put a dependency on the host
 * runtime into a package that currently has none.
 */

/** Mirrors `emptyPluginConfigSchema()` — this plugin accepts no config keys. */
function emptyConfigSchema() {
  return {
    safeParse(value) {
      if (value === undefined) return { success: true, data: undefined };
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { success: false, error: { issues: [{ message: "expected config object" }] } };
      }
      if (Object.keys(value).length > 0) {
        return { success: false, error: { issues: [{ message: "config must be empty" }] } };
      }
      return { success: true, data: value };
    },
    jsonSchema: { type: "object", additionalProperties: false, properties: {} },
  };
}

export default {
  id: "seekrit",
  name: "seekrit",
  description:
    "Resolve OpenClaw exec SecretRefs from seekrit — end-to-end encrypted secrets, decrypted locally by a short-lived child process.",
  configSchema: emptyConfigSchema(),
  register() {
    // Intentionally empty — see the note above.
  },
};
