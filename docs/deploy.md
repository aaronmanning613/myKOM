# Deploying myKOM

Production is the only environment. It runs as one Cloud Run service in `northamerica-northeast1`
(Montréal), with Supabase Postgres in `ca-central-1`. Every push to `main` runs
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), which does these steps in order:

1. typecheck, lint and test;
2. `pnpm db:migrate` against the production database;
3. build the image and push it to Artifact Registry;
4. `gcloud run deploy`.

Everything below is one-time setup that needs your accounts. [`scripts/setup-deploy.sh`](../scripts/setup-deploy.sh)
walks you through it stage by stage (opening each page, running the commands, and setting the GitHub
secret and variables); it's safe to re-run. Or do it by hand, top to bottom. It's
free as long as usage stays in the free tiers, and the budget alert emails you at $1.

The commands use these shell variables. Set them first and keep the terminal open:

```sh
PROJECT_ID=mykom-xxxx          # pick a globally unique id
REGION=northamerica-northeast1
REPO=aaronmanning613/myKOM     # the GitHub repository
```

## 1. Supabase

- [ ] Create a **Free** project in **`ca-central-1`** (Canada Central). Save the database password.
- [ ] In **Connect**, copy the **Session pooler** connection string (it's IPv4; the direct
      connection is IPv6-only, which neither GitHub Actions nor Cloud Run can reach). Put your
      password in it and add `?sslmode=require`. It looks like
      `postgres://postgres.<ref>:<password>@aws-0-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=require`.
      This is `DATABASE_URL` below.

There are no backups. Everything except pinned Benchmarks, preferences and Search/Mapped Areas
regenerates from Strava.

## 2. GCP project and budget alert

- [ ] Create the project and link a billing account:

  ```sh
  gcloud projects create "$PROJECT_ID"
  gcloud config set project "$PROJECT_ID"
  gcloud billing accounts list
  gcloud billing projects link "$PROJECT_ID" --billing-account=<BILLING_ACCOUNT_ID>
  PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
  ```

- [ ] Turn on the APIs:

  ```sh
  gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
    secretmanager.googleapis.com cloudscheduler.googleapis.com iamcredentials.googleapis.com \
    sts.googleapis.com billingbudgets.googleapis.com
  ```

- [ ] Create the **$1 budget alert**. It emails the billing account's admins when actual spend
      reaches $1. It's only an alert: nothing gets shut down.

  ```sh
  gcloud billing budgets create --billing-account=<BILLING_ACCOUNT_ID> \
    --display-name="myKOM \$1" --budget-amount=1USD \
    --filter-projects="projects/$PROJECT_ID" --threshold-rule=percent=1.0
  ```

## 3. Artifact Registry

- [ ] Create the Docker repository, with a cleanup policy that keeps the last 3 images:

  ```sh
  gcloud artifacts repositories create mykom --repository-format=docker --location="$REGION"
  cat > /tmp/mykom-cleanup.json <<'EOF'
  [
    { "name": "keep-last-3", "action": { "type": "Keep" }, "mostRecentVersions": { "keepCount": 3 } },
    { "name": "delete-older", "action": { "type": "Delete" }, "condition": { "tagState": "any" } }
  ]
  EOF
  gcloud artifacts repositories set-cleanup-policies mykom --location="$REGION" \
    --policy=/tmp/mykom-cleanup.json --no-dry-run
  ```

## 4. Service accounts

There are three service accounts:

- **deploy** is what GitHub Actions acts as;
- **runtime** is what the Cloud Run service runs as;
- **scheduler** is the identity whose OIDC token `POST /internal/tick` accepts.

- [ ] Create them:

  ```sh
  for name in mykom-deploy mykom-runtime mykom-scheduler; do
    gcloud iam service-accounts create "$name"
  done
  DEPLOY_SA=mykom-deploy@$PROJECT_ID.iam.gserviceaccount.com
  RUNTIME_SA=mykom-runtime@$PROJECT_ID.iam.gserviceaccount.com
  SCHEDULER_SA=mykom-scheduler@$PROJECT_ID.iam.gserviceaccount.com
  ```

- [ ] Let **deploy** deploy Cloud Run services, push images, and run the service as **runtime**:

  ```sh
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOY_SA" --role=roles/run.admin
  gcloud artifacts repositories add-iam-policy-binding mykom --location="$REGION" \
    --member="serviceAccount:$DEPLOY_SA" --role=roles/artifactregistry.writer
  gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
    --member="serviceAccount:$DEPLOY_SA" --role=roles/iam.serviceAccountUser
  ```

**scheduler** needs no roles. The service allows unauthenticated requests, and the app checks the
token itself (its audience, issuer and email).

## 5. Secret Manager

- [ ] Create the four secrets. Use `printf`, not `echo`, so no newline gets stored:

  ```sh
  printf '%s' '<the Supabase session-pooler URL>' | gcloud secrets create DATABASE_URL --data-file=-
  openssl rand -base64 32 | tr -d '\n' | gcloud secrets create SESSION_SECRET --data-file=-
  printf '%s' '<Strava client secret>' | gcloud secrets create STRAVA_CLIENT_SECRET --data-file=-
  openssl rand -base64 32 | tr -d '\n' | gcloud secrets create TOKEN_ENCRYPTION_KEY --data-file=-
  ```

  Never change `TOKEN_ENCRYPTION_KEY` after that. If you do, stored Strava tokens can't be read
  and every Runner has to sign in again.

- [ ] Let **runtime** read all four secrets. **deploy** only needs `TOKEN_ENCRYPTION_KEY`, because
      the migration step encrypts any plain-text tokens:

  ```sh
  for secret in DATABASE_URL SESSION_SECRET STRAVA_CLIENT_SECRET TOKEN_ENCRYPTION_KEY; do
    gcloud secrets add-iam-policy-binding "$secret" \
      --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor
  done
  gcloud secrets add-iam-policy-binding TOKEN_ENCRYPTION_KEY \
    --member="serviceAccount:$DEPLOY_SA" --role=roles/secretmanager.secretAccessor
  ```

## 6. Workload Identity Federation (GitHub → GCP, no stored keys)

- [ ] Create a pool and a GitHub provider that only accepts this repository's `main` branch. Then
      let that repository act as **deploy**:

  ```sh
  gcloud iam workload-identity-pools create github --location=global
  gcloud iam workload-identity-pools providers create-oidc github --location=global \
    --workload-identity-pool=github --issuer-uri=https://token.actions.githubusercontent.com \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository=='$REPO' && assertion.ref=='refs/heads/main'"
  gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role=roles/iam.workloadIdentityUser \
    --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
  echo "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github"
  ```

  The last line prints the value for `GCP_WORKLOAD_IDENTITY_PROVIDER`.

## 7. The service URL

Cloud Run's URL is known before the first deploy:

```sh
SERVICE_URL=https://mykom-$PROJECT_NUMBER.$REGION.run.app
```

Use exactly this URL everywhere: the `SERVICE_URL` variable, the Scheduler job and your bookmarks.
Cloud Run also serves an older-style hashed URL. Tick tokens are checked against `SERVICE_URL`,
and the Strava callback is built from whichever host you signed in on.

## 8. GitHub

In the repository's **Settings → Secrets and variables → Actions**, add:

- [ ] **Secret**
  - `DATABASE_URL`: the same Supabase session-pooler URL, used by the migration step.
- [ ] **Variables**

  | Variable                         | Value                                                          |
  | -------------------------------- | -------------------------------------------------------------- |
  | `GCP_PROJECT_ID`                 | `$PROJECT_ID`                                                  |
  | `GCP_WORKLOAD_IDENTITY_PROVIDER` | the provider path printed in step 6                            |
  | `GCP_DEPLOY_SERVICE_ACCOUNT`     | `$DEPLOY_SA`                                                   |
  | `GCP_RUNTIME_SERVICE_ACCOUNT`    | `$RUNTIME_SA`                                                  |
  | `GCP_SCHEDULER_SERVICE_ACCOUNT`  | `$SCHEDULER_SA`                                                |
  | `SERVICE_URL`                    | `$SERVICE_URL` (step 7), no trailing slash                     |
  | `STRAVA_CLIENT_ID`               | the Strava app's client ID                                     |
  | `NOMINATIM_USER_AGENT`           | the app name and a contact, e.g. `myKOM/1.0 (you@example.com)` |

The workflow uses nothing else. `TRUST_PROXY`, `MAXMIND_LICENSE_KEY` and `GEOLITE2_CITY_DB` aren't
used in production.

## 9. The first deploy

- [ ] Push to `main` (or re-run the latest **Deploy** workflow). When it's green:

  ```sh
  curl "$SERVICE_URL/api/health"   # {"ok":true,"db":"up"}
  ```

## 10. Cloud Scheduler (the tick)

- [ ] Create **one** job that calls `POST /internal/tick` every 5 minutes, with an OIDC token from
      **scheduler** whose audience is the service URL. The tick also keeps Supabase from pausing.

  ```sh
  gcloud scheduler jobs create http mykom-tick --location="$REGION" \
    --schedule="*/5 * * * *" --http-method=POST --uri="$SERVICE_URL/internal/tick" \
    --oidc-service-account-email="$SCHEDULER_SA" --oidc-token-audience="$SERVICE_URL"
  gcloud scheduler jobs run mykom-tick --location="$REGION"
  ```

  After that manual run, the Cloud Run logs should show `POST /internal/tick` with status 200
  (401 means the audience or service account doesn't match the GitHub variables).

## 11. Strava

- [ ] In [Strava's API settings](https://www.strava.com/settings/api), set the **Authorization
      Callback Domain** to the service URL's host (`mykom-<number>.northamerica-northeast1.run.app`,
      with no scheme). Strava allows one callback domain, and `localhost` is always allowed, so
      local development keeps working.
- [ ] Request the self-service upgrade to **10 athletes**.
- [ ] Sign in at `$SERVICE_URL` and run a search.
