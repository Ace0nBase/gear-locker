# War Box

War Box is a private inventory for the gear you already own. This copy of the site is the one that gets published. The checks below use a separate practice locker on your computer. They cannot open the live locker or spend the live lookup key.

War Box is operated by Six Ridge Labs LLC. The site is [getwarbox.com](https://getwarbox.com). Questions go to support@getwarbox.com.

## Gear categories

Magazines holds magazines only, such as a PMAG, a Glock mag, or a Lancer. That shelf is weight-only. War Box never fills a price or a store link for it.

Belts holds battle belts, duty belts, and rigger's belts. Those keep normal prices.

Armor & Carriers holds plate carriers, chest rigs, and armor plates.

Older lockers used the ids Magazines & Belts and Belts & Rigs. Those ids still map to Magazines and Belts, including when another device syncs the old id. War Box does not move a chest rig or a plate carrier by reading its name. A one-time prompt lists the Belts rows that came from Belts & Rigs, and the Magazines rows that came from Magazines & Belts. Move a chest rig or a plate carrier to Armor & Carriers, move a mag pouch to Pouches, or move something else to Belts or Ammo Storage & Loaders. Dismiss the prompt to leave the row where it is. That answer is saved on the account and applied before the old id is renamed.

## Later iPhone wrap

Capacitor is not in this project yet. When the iPhone app is added, use bundle id `com.sixridgelabs.warbox` and target iPhone only. Copy `design/warbox-icon/ios/AppIcon.appiconset/` over `ios/App/App/Assets.xcassets/AppIcon.appiconset/` after `npx cap add ios`.

## Run the local privacy check

You need Node.js 22 or newer and Java 21 or newer. The local lookup stub will not start on Node 20. The Firebase emulators need Java.

From this folder, after `npm install`:

```
npm run qa
```

Then open:

http://127.0.0.1:5500/?env=emulator

The emulator screen is at http://127.0.0.1:4000. Stop everything with Ctrl+C.

`npm run qa` starts three things, all on this computer:

1. The Firebase emulators for sign-in, the locker database, and file storage, using the rules in this folder. The project name is `demo-gear-locker`.
2. A pretend lookup service on port 8787. It returns sample prices. It does not call Claude and it refuses the live project.
3. The app itself on port 5500.

The address must include `?env=emulator`, and it only works on this computer. Opening that flag on the published site turns the app off instead of showing the live locker. A file named `config.local.js` can change the local ports, but if it contains the live project it is refused. Copy `config.local.example.js` only if you need that. Do not put the live project id or the live lookup address in it.

The published `config.js` is unchanged by this mode. A plain `firebase deploy` from this folder also stays on `demo-gear-locker`. Updating the live locker is a separate command and is listed in the pull request checklist. Do not run it as part of this check.

## Two throwaway accounts

Use made-up emails. Do not type a real account.

1. Open http://127.0.0.1:5500/?env=emulator. Create account A with a password of at least 12 characters.
2. Stay on this page. Do not follow a confirmation link out to the live site. Tap **Mark email confirmed**. Loans and lookups can use that address as soon as the button finishes. You do not need to sign out.
3. Add a piece of gear and type a serial number on it.
4. Open Share for that item and create a link. The link stays on this computer and keeps `?env=emulator`, so it does not jump to the live locker.
5. Copy the link, open a private window, and paste it. You should see the name, brand, color, and weight. You should not see the serial number or the notes.
6. Back in account A, add a loan and type account B's sign-in email exactly.
7. In a second browser profile, create account B on the same local address. Tap **Mark email confirmed**. Open the Loans tab. Account B should see the loaned item's name, not account A's inventory and not the serial number.
8. Before account B is marked confirmed, the loan should not appear.
9. In either account, tap **Check storage privacy**. It should say your own test file saved, and that another account and a signed-out check were blocked.
10. Sign out. The sign-in screen should be back, and the inventory should not stay on screen.

If the page says emulator mode will not open the live locker, you are not on localhost or the local file pointed at the live project. Fix that before continuing. Do not remove the block.

## Lookup service settings

The lookup worker reads these from the Cloudflare dashboard. Leave a setting blank to keep the default. Do not put secret values in this file.

- `BETA_ONLY` — set to `true` to require `ALLOWED_EMAILS` again. Leave it unset so any confirmed email can use lookups.
- `ALLOWED_EMAILS` — comma-separated emails. Used only when `BETA_ONLY` is true. An empty list then turns lookups off.
- `REVIEW_EMAILS` — comma-separated emails that skip the free spend cap and the monthly lookup quota. They still have a small daily limit.
- `REVIEW_DAILY_LIMIT` — daily lookups for those review emails. Default 8.
- `FREE_SPEND_CAP_USD` — free-tier spend that pauses free lookups. Default 25. The counter, and the per-person daily and monthly quotas, live in one SQLite Durable Object (`UsageLedger`, binding `USAGE`). The migration in `api/wrangler.toml` creates it when Workers Builds deploys main, including on the Workers Free plan. Do not add a KV-backed class. No new secret.
- `FREE_DAILY_SPEND_CAP_USD` — per-account daily spend for the free plan. Default 0.75. A lookup reserves its per-item estimate at admission and the batch is trimmed or refused when today's spend plus that estimate would go over the cap. When the call finishes, the reserve is replaced with the actual cost, including a fallback call. Attempts still count against `DAILY_AI_LIMIT` and are never refunded. A failed lookup can refund the monthly counter the person sees, up to 5 times per UTC month.
- `SPEND_RESERVE_USD` — optional extra hold for a lookup. Leave it unset. Each free item reserves one search round and one answer round: the prompt, the web-search count, and max output, at the primary rates, plus the same shape at the fallback rates. That hold is cents per item, so several Free lookups can run together under `FREE_SPEND_CAP_USD`. After the call the reserve is replaced with the real cost from the response.
- `PLAN_LIMIT_FREE`, `PLAN_LIMIT_PRO`, `PLAN_LIMIT_ARMORY` — lookups per UTC month. Defaults 10, 100, and 500. Paid plans are placeholders until billing is connected. Every account is on the free plan today.
- `SPEND_INPUT_PER_MILLION`, `SPEND_OUTPUT_PER_MILLION`, `SPEND_SEARCH_EACH` — estimates used to record a primary-model call. Defaults 1, 5, and 0.01.
- `FALLBACK_INPUT_PER_MILLION`, `FALLBACK_OUTPUT_PER_MILLION`, `FALLBACK_SEARCH_EACH` — estimates for the fallback model. Defaults 3, 15, and 0.01. The hold uses whichever of the primary and fallback rates is higher. A fallback call is recorded at the fallback rates.
- `FIREBASE_SERVER_API_KEY` — dashboard secret, used only to delete the Firebase Auth user. Create a second Google API key with application restriction None and API restriction Identity Toolkit API only. Leave the browser key's HTTP referrer restriction as it is. The worker does not send a Referer. Set the new key in the Cloudflare dashboard (Worker → Settings → Variables and Secrets). It is not in `api/wrangler.toml`. `keep_vars` plus that secret means a deploy from main will not wipe it. Do not paste the key in this file or anywhere in the repo. If the secret is missing, usage counters stay and the person is told the sign-in is still here so they can try again.
- `FIREBASE_SA_JSON` — dashboard secret. Paste the JSON key of a Google service account on project `gear-locker-c248c` whose only role is Cloud Datastore User (`roles/datastore.user`). The worker signs a short-lived token with that key and clears the deleted email from other people's loans. Do not put the JSON in the client, this file, or `api/wrangler.toml`. If the secret is missing, account deletion still finishes, the redaction job stays queued, and the hourly job retries until the secret is added or the job expires after 30 days.
- `EMAIL_HMAC_KEY` — dashboard secret. A long random string. The worker stores a 30-day hold under an HMAC of the deleted email so a later save of that address is cleared again. Clients cannot read the hold. A verified sign-in with that email removes it. If the secret is missing, deletion still finishes and the queued job still runs until it expires.

Account deletion removes that person's shares, locker, and the lends they created. It does not read lends that name them. Before the sign-in is deleted, the worker queues a usage-counter cleanup and a redaction job for the uid and the lowercased email. If either queue write fails, the response is an error and the sign-in stays. The Auth user is deleted only after those queues succeed. The hourly job clears usage counters from `cleanup:{uid}` (one record, 24 attempts or 7 days). With `FIREBASE_SA_JSON` set, the same hourly job pages loans by `friendEmailLower` and lends by `borrowerEmailLower`, clears a matching loan with `updatedAt` and `serverUpdatedAt` set to `REQUEST_TIME`, and deletes the lend. Real loans are cleared before forged lends. Each pass stays under the worker subrequest limit and resumes on the next hour. The job expires after 30 days. The `deletedUsers/{uid}` marker stores `expireAt` 30 days after deletion. The hourly job pages that collection with the service account and deletes markers whose `expireAt` is in the past, up to a fixed number per run. A marker with no `expireAt` expires 30 days after its deletion time, or after `createTime` when that field is missing. The log line is `tombstones: N` and does not include ids. Deploy the indexes in `firestore.indexes.json` so the loan queries can run. TTL is not used, because that project has billing disabled. A loan save stores `friendEmailLower`. One lender can create 40 lends naming the same email. RevenueCat is not connected, so there is no customer to delete yet.

A call to `accounts:delete` with the public web key and no Referer returns `API_KEY_HTTP_REFERRER_BLOCKED`. The same call from `https://ace0nbase.github.io/` reaches Identity Toolkit and rejects a bad token (`INVALID_ID_TOKEN`), so that API is on and the browser key is fine for the site. The person's own rows are deleted with their sign-in token and the security rules. Redaction of other people's loans uses `FIREBASE_SA_JSON`, not `FIREBASE_SERVER_API_KEY`. A bogus-token Firestore call was not referrer-blocked.

These existing limits stay: `DAILY_AI_LIMIT` 40, `ALERT_DAILY_CAP` 6, `WATCH_BATCH` 6.
