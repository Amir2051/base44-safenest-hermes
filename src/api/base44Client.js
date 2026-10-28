// @ts-nocheck
/**
 * SafeNestT browser base44 client bootstrap
 *
 * Real SDK bootstrap for the SafeNestT frontend.
 *
 * The @base44/vite-plugin ships a compat layer in node_modules/@base44/vite-plugin/compat/
 * (entities.cjs, functions.cjs, integrations.cjs). Importing those files is the decisive
 * step: functions.cjs requires base44Client.cjs, which calls createClient({ appId, serverUrl })
 * and instantiates the SINGLE real SDK client that every compat file shares.
 *
 * This file replaces the hand-written no-op proxy that used to ship in this file, so that
 * every base44.* call in the frontend resolves to the live Base44 SDK instead of stub data.
 *
 * Flow:
 *   react component -> base44.functions.invoke('hermesStart', {...})
 *     -> compat functions.cjs -> base44.functions.invoke(prop, ...args)
 *     -> real SDK functions.invoke -> POST /apps/${appId}/functions/${functionName}
 *     -> Base44 function gateway -> hermesStart (base44/functions/hermesStart/entry.ts)
 *
 * The vite-plugin's legacySDKImports mode routes import specifiers containing "/functions",
 * "/entities", "/integrations", "/agents" to these compat/*.cjs files. Importing this module
 * therefore boots the real client as a side effect of the compat re-export.
 *
 * Auth: the browser SDK attaches the app session cookie / X-App-Id automatically via
 * createClient(). Secrets (HERMES_BASE_URL, HERMES_API_KEY) live ONLY on the server-side
 * Base44 function (base44/functions/hermesStart/entry.ts reads them via Deno.env.get); never
 * exposed here.
 *
 * The SDK's authenticate() may kick off an OIDC popup/gateway request. We do NOT call it at
 * module scope: that would block the SPA on first paint and present a login modal to users
 * who only need read-only pages (e.g. /cases). Components that need identity (useAuth, etc.)
 * call base44.auth.me() / loginWithRedirect at the appropriate time.
 *
 * The SDK bootstrap fails explicitly if the compat layer does not expose a client,
 * rather than silently returning fake data that makes investigations appear successful.
 */

// Import the compat proxies. Vite's base44 plugin (legacySDKImports mode) maps imports
// containing "/functions", "/entities", "/integrations" to these compat/*.cjs files, which are
// CommonJS. Vite's CJS interop handles their internal require('./base44Client.cjs').
// This static import is a side effect that boots the real SDK client.
import "@base44/vite-plugin/compat/functions.cjs";
import "@base44/vite-plugin/compat/entities.cjs";
import "@base44/vite-plugin/compat/integrations.cjs";
import * as credentialsCompat from "@base44/vite-plugin/compat/base44Client.cjs";
import { customAuthApi } from "@/lib/customAuthApi";
import { createCustomEntityAdapter } from "@/lib/customEntityApi";

// snapshot the namespaces our compat peers attach to module.exports.base44

// The single real SDK client shared by the whole compat layer (created once in
// base44Client.cjs: createClient({ appId, serverUrl }) -> module.exports.base44).
const base44Client = credentialsCompat.base44 ?? credentialsCompat.default?.base44;

if (!base44Client) {
  throw new Error("SafeNestT: Base44 SDK client failed to initialize. Check @base44/vite-plugin compatibility and VITE_BASE44_APP_ID / VITE_BASE44_BACKEND_URL configuration.");
}

// Compatibility bridge: preserve the existing Base44 SDK for entities/functions while
// moving identity/session operations to the independent custom backend. This is a staged
// migration; data entities and server functions are intentionally not replaced here.
base44Client.auth.me = () => customAuthApi.me();
base44Client.auth.updateMe = (values) => customAuthApi.updateMe(values);
base44Client.auth.logout = (returnTo) => customAuthApi.logout(Boolean(returnTo));
base44Client.auth.redirectToLogin = (returnTo) => customAuthApi.redirectToLogin(returnTo);
base44Client.auth.loginViaEmailPassword = (emailOrPayload, password) => {
  const email = typeof emailOrPayload === 'string' ? emailOrPayload : emailOrPayload?.email;
  const secret = typeof emailOrPayload === 'string' ? password : emailOrPayload?.password;
  return customAuthApi.login(email, secret);
};
base44Client.auth.register = (emailOrPayload, password, displayName) => {
  const email = typeof emailOrPayload === 'string' ? emailOrPayload : emailOrPayload?.email;
  const secret = typeof emailOrPayload === 'string' ? password : emailOrPayload?.password;
  const name = typeof emailOrPayload === 'string' ? displayName : (emailOrPayload?.display_name || emailOrPayload?.displayName);
  return customAuthApi.register(email, secret, name);
};
base44Client.auth.isAuthenticated = async () => {
  try { await customAuthApi.me(); return true; } catch { return false; }
};

// Migrate the two core case entities through the independent API first. Other
// entity families remain on the legacy adapter until their own parity/security
// tests pass; service-role access is deliberately not overridden here.
const legacyEntities = base44Client.entities;
const customCaseEntities = {
  MyCase: createCustomEntityAdapter("MyCase"),
  InvestigationCase: createCustomEntityAdapter("InvestigationCase"),
};
base44Client.entities = new Proxy({}, {
  get: (_, entityName) => customCaseEntities[entityName] || legacyEntities[entityName],
});

// Mount the full compat namespace (entities + functions + integrations + auth) onto
// window.base44 so React components and hooks that import the named exports resolve
// to the live SDK. This is the correct production client, not a no-op stub.
if (typeof window !== "undefined") {
  // Expose the actual SDK client. The compat modules are CommonJS proxies whose
  // ESM namespace wrappers are not themselves the SDK's functions/entities APIs.
  // Assigning those wrappers here breaks calls such as window.base44.functions.invoke().
  window.base44 = base44Client;
}

export { base44Client as base44 };
export default base44Client;

/**
 * Deferred loader keeps first paint free. Components that need the full namespace can
 * call requireBase44(), after which the compat proxies resolve to the real SDK.
 */
let realBase44Promise;
export async function requireBase44() {
  if (!realBase44Promise) {
    realBase44Promise = Promise.all([
      import("@base44/vite-plugin/compat/entities.cjs"),
      import("@base44/vite-plugin/compat/functions.cjs"),
      import("@base44/vite-plugin/compat/integrations.cjs"),
    ]).then(([entitiesModule, functionsModule, integrationsModule]) => ({
      entities: entitiesModule.default ?? entitiesModule,
      functions: functionsModule.default ?? functionsModule,
      integrations: integrationsModule.default ?? integrationsModule,
      client: base44Client,
    }));
  }
  return realBase44Promise;
}
