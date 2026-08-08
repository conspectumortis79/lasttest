/**
 * Hardcoded lookup table for the bundled demo API
 * (`demo/openapi-demo.yaml`). The yellow callout banner in
 * `DemoCredentialsBanner.tsx` reads from here at render time so the
 * user always sees the credentials that the demo backend actually
 * accepts, with one click to populate the input fields.
 *
 * Design notes:
 *  - Lives in the frontend on purpose: the production auth flow
 *    does not change. The `Operation` type stays free of
 *    "is this a demo?" flags.
 *  - Operation IDs match the `operationId` values in the demo
 *    spec exactly. A typo here would silently leave the banner
 *    absent, which is why the unit test asserts the lookups and
 *    the unique-id invariant.
 *  - The username shown here (`alice`) is the value the user
 *    asked for in the demo. The demo backend
 *    ([DemoProductController.DEMO_BASIC_USERNAME]) verifies the
 *    exact pair and rejects everything else with 401.
 */
export type DemoBasicAuth = {
  readonly kind: 'basic'
  readonly operationIds: ReadonlyArray<string>
  readonly username: string
  readonly password: string
}

export type DemoBearerToken = {
  readonly kind: 'bearer'
  readonly operationIds: ReadonlyArray<string>
  readonly token: string
}

export type DemoApiKey = {
  readonly kind: 'apiKey'
  readonly operationIds: ReadonlyArray<string>
  /** The value the user pastes / the demo backend accepts. */
  readonly key: string
  /**
   * The HTTP header name the spec declared, e.g. `X-API-Key`. The
   * banner surfaces it so the user can sanity-check that the
   * header they see in the k6 script matches the spec.
   */
  readonly headerName: string
}

export type DemoOAuth2 = {
  readonly kind: 'oauth2'
  readonly operationIds: ReadonlyArray<string>
  /** The OAuth 2.0 access token; sent as `Authorization: Bearer <token>` on the wire. */
  readonly token: string
  /**
   * Flow metadata carried for the banner only — the k6 script
   * does not branch on the flow type. Picked from the first flow
   * the spec declares so the banner shows a concrete line.
   */
  readonly flowType: string
  readonly scopes: ReadonlyArray<string>
}

export type DemoOpenIdConnect = {
  readonly kind: 'openIdConnect'
  readonly operationIds: ReadonlyArray<string>
  /**
   * The OIDC ID token; sent as `Authorization: Bearer <id_token>`
   * on the wire. Same wire format as OAuth 2.0 / Bearer per RFC
   * 6750 — the field is split out so the banner can show the
   * discovery URL and scopes alongside the token.
   */
  readonly idToken: string
  /**
   * The OpenID Connect discovery URL the spec declared. Carried
   * for the banner only; the k6 script does not follow it (the
   * user pastes a pre-acquired ID token into the UI).
   */
  readonly discoveryUrl: string
  readonly scopes: ReadonlyArray<string>
}

type DemoCredentials = DemoBasicAuth | DemoBearerToken | DemoApiKey | DemoOAuth2 | DemoOpenIdConnect

export const DEMO_CREDENTIALS: ReadonlyArray<DemoCredentials> = [
  {
    kind: 'basic',
    operationIds: ['getAdminStats'],
    username: 'alice',
    password: 's3cret',
  },
  {
    kind: 'bearer',
    operationIds: ['searchProducts'],
    token: 'demo-bearer-token',
  },
  {
    kind: 'apiKey',
    operationIds: ['lookupProduct'],
    key: 'demo-api-key-12345',
    headerName: 'X-API-Key',
  },
  {
    kind: 'oauth2',
    operationIds: ['getMe'],
    token: 'demo-oauth2-token-12345',
    flowType: 'clientCredentials',
    scopes: ['read:products', 'write:products'],
  },
  {
    kind: 'openIdConnect',
    operationIds: ['getMyProfile'],
    idToken: 'demo-oidc-id-token-12345',
    discoveryUrl: 'http://localhost:8286/demo-api/.well-known/openid-configuration',
    scopes: ['openid', 'profile', 'email'],
  },
]

/**
 * Returns the demo entry for the given operation id, or `undefined`
 * if the operation is not part of the bundled demo. The banner
 * component uses this as the single gate; if it returns `undefined`
 * nothing is rendered and the operation card stays exactly as it
 * was for the production code path.
 */
export function findDemoCredentials(operationId: string): DemoCredentials | undefined {
  return DEMO_CREDENTIALS.find(entry => entry.operationIds.includes(operationId))
}
