# Custody Note

Custody Note is an LAA-compliant desktop app for recording custody notes and police station attendances. Bright, easy-to-use form that flows logically at the station; PDF export; email PDF to yourself; hourly backup; optional signatures and speech recognition.

## Run the app

1. Install dependencies (once):

   ```bash
   cd <path-to-this-app>
   npm install
   ```

2. Start the app:

   ```bash
   npm start
   ```

## Releasing a new version

Version and changelog are automated. From the app folder:

```bash
# Patch release (1.4.6 → 1.4.7), prompts for changelog items
npm run release patch

# With changelog from command line (semicolon-separated)
npm run release patch -- --changes "Security fixes; Updated dependencies"

# Minor (1.4.6 → 1.5.0) or major (1.4.6 → 2.0.0)
npm run release minor
npm run release major
```

This script: (1) bumps version in package.json, (2) updates changelog.json, (3) syncs to the website, (4) builds the app. After deploying the website, the changelog page and download page will show the new version.

To sync changelog to the website without releasing (e.g. after editing changelog.json manually):

```bash
npm run sync-website
```

## Features

- **List** – Search and open past attendances.
- **New attendance** – Form in logical order: Arrival/Departure → Client & Matter → Custody → Disclosure → Attend on client → Interview → Outcome.
- **Settings** – Your email, DSCC PIN, backup folder. Hourly backups run automatically.
- **Backup now** – Immediate backup to your chosen folder.
- **Export PDF** – Save attendance note as PDF to Desktop.
- **Email PDF to me** – Save PDF and open your email client so you can attach it and send to the firm yourself.
- **LAA forms** – Link to GOV.UK legal aid claim forms (opens in browser).

Data is stored in a local database in the app data folder. Backups are saved every hour to the folder you set in Settings.
