# Guest Free-Tier Capacity

Verified against official Cloudflare documentation on 2026-08-09:

- Workers Free permits 100,000 requests per UTC day: <https://developers.cloudflare.com/workers/platform/limits/>.
- Workers AI includes 10,000 neurons per UTC day and requires a paid plan above that allocation: <https://developers.cloudflare.com/workers-ai/platform/pricing/>.
- Access one-time PINs are single-use and expire after ten minutes: <https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/>.

## Enforced Application Limits

| Control | Limit |
|---|---:|
| Accepted guest uploads | 50 per UTC day |
| Accepted uploads per identity | 3 per UTC day |
| Workspace attempts per IP hash | 10 per UTC day |
| Active workspaces per identity | 1 |
| Application AI budget | 9,000 neurons per UTC day |
| Reserved per accepted upload | 500 neurons |
| Image size | 5 MB |
| Workspace retention | 24 hours |

The AI reservation limits the theoretical AI-backed daily capacity to 18 accepted jobs. The lower result between the upload and AI gates wins. A reservation is intentionally conservative and is not returned for abandoned uploads; this prevents an accidental paid overrun at the cost of lower availability.

If the model does not return usable consumption metrics, or measured use exceeds the reservation, the job becomes **Needs correction**. There is no paid fallback. The Cloudflare account must remain on Workers Free; app controls are defense in depth, not a substitute for account-plan verification.

## User Message

When a pre-upload gate is closed, return only:

> Daily processing capacity reached. Please try tomorrow.
