# AWS deployment freeze

Effective 2026-07-18, ChallanSe AWS provisioning and deployment are frozen pending revised client requirements and written funding approval.

## Preserved

- AWS account ownership and any future account structure
- Terraform and enrichment source code
- Local PostgreSQL and LocalStack test workflows
- Cloudflare DNS, Access, routing, and the public Constrovet website
- GitHub CI validation and synthetic test data

## Prohibited while frozen

- `terraform apply`
- `scripts/zero-cost-readiness.sh aws-org-bootstrap`
- `scripts/go-live.sh configure-aws`
- `scripts/go-live.sh configure-enrichment`
- `scripts/go-live.sh configure-tunnel-origin`
- `scripts/go-live.sh rotate-enrichment-keys`
- `scripts/go-live.sh deploy`
- `scripts/go-live.sh replay-dlq`
- `scripts/go-live.sh seed`
- Production database migrations or real client uploads

The required GitHub state is:

```text
PILOT_DEPLOY_ENABLED=false
AWS_ENRICHMENT_BOOTSTRAPPED=false
AWS_DEPLOYMENT_FROZEN=true
```

Verify it with:

```bash
./scripts/zero-cost-readiness.sh freeze-status
```

## Reactivation

Reactivation requires approved client requirements, written cloud-spending approval, confirmed AWS account and billing ownership, reviewed Terraform cost evidence, passing signing and CI security gates, and an authorized change of `AWS_DEPLOYMENT_FROZEN` to `false`. The guarded CLI typed confirmation remains mandatory after the freeze is removed.
