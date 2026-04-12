# Hub Installer Verification

Run the narrowest useful set first, then broaden before completion:

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e-dry-run
pnpm verify
```

Use targeted tests first when only one installer or registry area changed, then finish with `pnpm verify` before calling the round complete.
