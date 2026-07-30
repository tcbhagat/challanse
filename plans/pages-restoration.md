# GitHub Pages Restoration Procedure

**Status**: ☐ Pending — Execute after CI passes on merged PR

## Prerequisites

- [ ] All 6 required GitHub checks pass on the recovery PR
- [ ] PR merged to `main` at the recovery commit
- [ ] CI run on `main` is green

## Step 1: Verify CI on main

- Confirm the `deploy-pages` job runs and succeeds
- Check that all security matrix jobs ran independently

## Step 2: Verify Custom Domain (CNAME)

The `CNAME` file at the repository root (`./CNAME`) contains `challanse.constrovet.com`.

During deployment, the `deploy-landing` job in [`ci-pages.yml`](../.github/workflows/ci-pages.yml) builds the landing page to `dist/landing` and uploads it via `actions/upload-pages-artifact` with `path: dist/landing`.

**Important**: The `CNAME` file must be present in the deployment artifact (`dist/landing/`) for GitHub Pages to verify and serve the custom domain. The `actions/configure-pages` step detects a `CNAME` at the repository root and configures the Pages custom domain setting, but the file itself should also be in the artifact as a best practice.

### Required workflow change

Add a step **after** `npm run build:landing` and **before** `actions/upload-pages-artifact` to copy the `CNAME` file into the artifact directory:

```yaml
      - run: npm run build:landing
        env:
          CHALLANSE_API_BASE_URL: https://api.challanse.constrovet.com
          TURNSTILE_SITE_KEY: ${{ vars.TURNSTILE_SITE_KEY }}
          CHALLANSE_CUSTOM_DOMAIN: challanse.constrovet.com
      - name: Copy CNAME into Pages artifact
        run: cp CNAME dist/landing/CNAME
      - uses: actions/configure-pages@...
```

This change should be included in the same PR that adds the `CNAME` file. It is safe to merge — the `deploy-landing` job only runs on `main` when `PILOT_DEPLOY_ENABLED == 'true'`, which is currently gated.

### Verification

After the workflow change is deployed, check the artifact contents via a CI run to confirm:

```
CNAME
index.html
assets/...
```

## Step 3: Wait for TLS Certificate

- GitHub Provisions a certificate for `challanse.constrovet.com` via Let's Encrypt
- Check `https://challanse.constrovet.com` — may show SSL error initially
- Wait up to 24 hours for certificate provisioning
- Verify with: `curl -vI https://challanse.constrovet.com 2>&1 | grep -i 'SSL certificate\|CN='`
- Expected: Valid certificate for `challanse.constrovet.com`

## Step 4: Enable HTTPS Enforcement

1. Navigate to GitHub: **Settings → Pages → Custom domain**
2. ☑ Enable **Enforce HTTPS**
3. Wait for GitHub to confirm HTTPS is active (green checkmark)

> **Note**: The Enforce HTTPS toggle may take several minutes to become available after TLS certificate provisioning completes.

## Step 5: Verify HTTP → HTTPS Redirect

- Test: `curl -sI http://challanse.constrovet.com | grep -i location`
- Expected: `302` or `301` redirect to `https://challanse.constrovet.com/`

## Step 6: Verify Landing Page Content

- Visit `https://challanse.constrovet.com`
- Confirm it returns HTTP 200
- Confirm the page content is the updated landing page (no simulated invoice upload)
- Verify the page reflects the "Local Synthetic Pilot" description (if visible)

## Post-Restoration Verification Checklist

| Check | Command | Expected |
|-------|---------|----------|
| HTTPS reachable | `curl -sI https://challanse.constrovet.com` | HTTP 200 |
| SSL certificate | `curl -vI https://challanse.constrovet.com 2>&1` | Valid cert, CN=`challanse.constrovet.com` |
| HTTP redirect | `curl -sI http://challanse.constrovet.com` | 301/302 → `https://challanse.constrovet.com/` |
| CNAME in artifact | (via CI artifact download) | `dist/landing/CNAME` exists |
| Landing page content | `curl -s https://challanse.constrovet.com` | Contains expected HTML |

## Rollback

If any step fails:

1. Disable the custom domain in **GitHub Pages settings** (clear the Custom domain field)
2. Revert to the default `<org>.github.io` domain
3. Fix the issue and repeat from **Step 1**

## Notes

- **DNS records** for reviewer and API services are intentionally **not configured**
- **AWS deployment** remains frozen
- The public landing page is **informational only**
- The `CNAME` file at the repository root (added in [`CNAME`](../CNAME)) is safe to merge now — it does not activate Pages on its own
- The `deploy-landing` job is further gated behind `PILOT_DEPLOY_ENABLED == 'true'`, ensuring no accidental deployment occurs
