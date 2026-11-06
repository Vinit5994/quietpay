# @quietpay/shared (temporary)

This is a **temporary** stand-in for Person A's `packages/shared` (task A2), written from `docs/SPEC_API.md` so the frontend and mock API can be built before A2 lands.

- Apps import it as `@quietpay/shared` (via a `link:` dependency), the same name the real package will use.
- **Catch-up when A2 merges:** in `apps/web/package.json` and `tools/mock-api/package.json`, change `"@quietpay/shared": "link:…"` to `"workspace:*"`, delete this folder, run `pnpm install`, then fix any typecheck errors.
- Person A: feel free to start A2 from these files. Additions beyond SPEC_API are listed in `docs/tasks/PERSON_B.md` under "Requests to A".
