# Keyless GitHub deploys: rollout

Replaces long-lived access keys in GitHub Actions with two short-lived, scoped roles.

| Workflow | AWS access | Can do |
|---|---|---|
| `deploy-infra.yml` | `teesh-art-github-backend-deploy`, main only | Update code, config and routes of the existing stack |
| `deploy-site.yml` | `teesh-art-github-site-deploy`, main only | Sync the site bucket, invalidate its distribution |
| `test.yml` | none | Type checks, read-only product API tests |

## Rollout

Order matters: the roles must exist before the workflows reach `main`.

1. **Create the provider and roles** as an admin, from the repo root (done 2026-11-22):

   ```powershell
   aws cloudformation deploy --template-file infra/github-oidc.yml --stack-name teesh-art-github-oidc --capabilities CAPABILITY_NAMED_IAM --region us-east-1
   ```

2. **Open a PR and merge it.** These files match neither deploy path filter, so merging deploys nothing.
3. **Run the site deploy**, then check https://teesh-art.com:

   ```powershell
   gh workflow run deploy-site.yml --ref main
   ```

4. **Run the backend deploy**, then check `/products` and one checkout:

   ```powershell
   gh workflow run deploy-infra.yml --ref main
   ```

   The first run re-uploads all three functions under a new artifact prefix. On 2026-11-22 it
   also resolved `stripe@^16.12.0` afresh; `src/functions/package-lock.json` now pins those versions.

5. **Delete the two AWS secrets as soon as both deploys pass:**

   ```powershell
   gh secret delete AWS_ACCESS_KEY_ID
   ```

   ```powershell
   gh secret delete AWS_SECRET_ACCESS_KEY
   ```

6. **Protect `main`.** A push to `main` is a production deploy.
7. **Replace the `cairn` profile** on any machine that has it. Remove its static key, then:

   ```powershell
   aws login --profile cairn
   ```

8. **Deactivate the old access key**, wait two weeks, then delete it and any inactive predecessor.

## If a deploy fails

- `Not authorized to perform sts:AssumeRoleWithWebIdentity`: the token doesn't match the trust
  policy. It must come from `main` and that exact workflow file. Renaming the repo, owner,
  workflow or branch requires a change to `infra/github-oidc.yml`.
- `AccessDenied` on an action: decide whether CI should have it. If so, add only that action and
  resource, then repeat step 1. The policies were simulated but not exercised before rollout.
- To go back before step 5, revert the workflow commit. The secrets still work until then.

## Changes CI refuses, by design

IAM (including a function's `Policies`), table settings, new or removed functions, and deleting
the API or stack. An admin deploys these by hand:

```powershell
sam build
```

```powershell
sam deploy --stack-name teesh-art --region us-east-1 --resolve-s3 --capabilities CAPABILITY_IAM --parameter-overrides "StripeSecretArn=arn:aws:secretsmanager:us-east-1:411974344834:secret:teesh-art-stripe-secrets-eanptC" "SiteUrl=https://teesh-art.com"
```

A new function also needs its role added to `PassExistingFunctionRoles`. A recreated function
role gets a new name, which must be updated there too.

## Remaining risks

- Code merged to `main` runs with the Lambda roles, which can read the Stripe secret and orders.
  Scoped deploy roles don't change that, which is why step 6 matters.
- A compromised build dependency can still alter what gets shipped. It can't get AWS credentials.
- `checkout.test.ts` and `webhook.test.ts` write to live Stripe or the live table when run by hand.
- `nodejs20.x` was deprecated on 2026-04-30. AWS blocks updates from 2027-08-31.
