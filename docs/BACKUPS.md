# FleetTrack — Backup & Recovery

Three layers, increasing in automation and cost.

## Layer 1 — Code (automatic, free)

Every commit on `claude/*` or `main` pushes to GitHub. GitHub is your
canonical code backup.

**Restore any file to any past state:**

```bash
git log -- path/to/file           # find the commit
git checkout <sha> -- path/to/file
```

**Restore the entire repo to a previous commit:**

```bash
git checkout <sha>                # read-only
git reset --hard <sha>            # rewriting; don't push without review
```

## Layer 2 — Database snapshot (manual, free)

Admins can download a full database snapshot any time.

**Download:**

- Sign in as admin
- Open: `https://<your-domain>/api/export/all`
- Browser downloads `fleettrack-backup-YYYY-MM-DDTHH-MM-SS.csv`
- This is a single CSV file with every table separated by sentinel lines:

  ```
  ### TABLE: users (1 rows) ###
  id,email,name,...
  ...

  ### TABLE: drivers (19 rows) ###
  ...
  ```

**Store off-platform.** Copy to Dropbox, Google Drive, or any cloud you
trust. Recommended cadence:

- Before every schema migration
- Before every bulk CSV import
- Weekly, as an ops habit

**Restore from snapshot:** The file is human-readable CSV — split by the
sentinel lines and re-import via `/api/import/<entity>` routes. Or paste
directly into Neon SQL Console using `COPY`.

Per-entity individual exports also exist:

- `/api/export/drivers`
- `/api/export/vehicles`
- `/api/export/trips`
- `/api/export/fuel`
- `/api/export/maintenance`

## Layer 3 — Neon point-in-time recovery (automatic, paid)

Neon's Launch tier ($19/month) gives you **7-day point-in-time recovery**.
You can rewind the database to any moment in the last 7 days.

**To enable:**

1. Go to [Neon console](https://console.neon.tech)
2. Select your project → Settings → Billing
3. Upgrade to Launch

**To use in an emergency:**

1. Neon console → Branches → Create branch from point in time
2. Pick the timestamp (1 minute ago, 2 hours ago, yesterday, etc.)
3. Copy the new branch's connection string
4. Temporarily update `DATABASE_URL` in Vercel to point at the new branch
5. Verify the data is correct
6. If yes: promote the branch to main in Neon, or dump/restore selected tables
7. Revert `DATABASE_URL` when done

**Cost after 7 days:** snapshots auto-expire. For longer retention, use
Layer 2 (manual exports) and keep them off-platform.

## Layer 4 — Vercel deployment rollback (automatic, free)

Every code deployment is retained by Vercel. You can roll back in 1 click
if a deploy breaks production.

- Vercel dashboard → your project → Deployments
- Find a known-good deployment (green Ready)
- Click the ⋯ → **Promote to Production**
- Traffic switches instantly; no redeploy required

## Disaster recovery checklist

In descending severity:

| Problem | Recovery |
|---|---|
| Bad deploy | Vercel → Deployments → Promote previous Ready |
| Bad schema migration | Restore from `/api/export/all` dump run before migration |
| Accidental mass delete | Neon Launch tier PITR → restore to 5 min before |
| Corrupted table | Per-entity CSV from `/api/export/<entity>` + re-import |
| Total data loss (no PITR) | Rebuild from last Layer 2 snapshot |

## Recommended ops rhythm

- **Daily (automated later):** `/api/export/all` download → S3 / Drive
- **Before any migration:** manual dump
- **After demo data seed:** dump as "zero state" baseline
- **Weekly:** rotate a human-readable snapshot into cold storage

## Automating Layer 2

A simple GitHub Actions cron that hits the export endpoint and commits
the snapshot to a private backups repo (ask and I'll add it):

```yaml
# .github/workflows/backup.yml (not yet shipped)
on:
  schedule:
    - cron: "0 2 * * *"   # 02:00 UTC daily
jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - run: curl -H "Cookie: ft_session=$SESSION" \
          https://<domain>/api/export/all \
          -o backup-$(date +%F).csv
      - uses: actions/upload-artifact@v4
        with: { name: backup, path: backup-*.csv, retention-days: 30 }
```

## What is NOT backed up

- **Vercel env vars** (API keys, DATABASE_URL). Keep a password-manager copy.
- **Sentry events** — they age out per Sentry's own retention rules.
- **User localStorage** (preferences, preview-mode, theme) — re-set on next login.
