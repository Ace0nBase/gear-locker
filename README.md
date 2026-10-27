# War Box

War Box is a private inventory for the gear you already own. This copy of the site is the one that gets published. The checks below use a separate practice locker on your computer. They cannot open the live locker or spend the live lookup key.

War Box is operated by Six Ridge Labs LLC. The site is [getwarbox.com](https://getwarbox.com). Questions go to support@getwarbox.com.

## Gear categories

Magazines holds magazines only, such as a PMAG, a Glock mag, or a Lancer. That shelf is weight-only. War Box never fills a price or a store link for it. Belted ammunition stays on Ammunition, which is not priced.

Belts holds battle belts, duty belts, and rigger's belts. Those keep normal prices.

Armor & Carriers holds plate carriers, chest rigs, and armor plates.

Older lockers used the ids Magazines & Belts and Belts & Rigs. Those ids still map to Magazines and Belts, including when another device syncs the old id. War Box does not move a chest rig or a plate carrier by reading its name. A one-time prompt lists the Belts rows that came from Belts & Rigs, and the Magazines rows that came from Magazines & Belts. Move a chest rig or a plate carrier to Armor & Carriers, move a non-magazine to Belts or Ammo Storage & Loaders, or dismiss the prompt and leave the row where it is. That answer is saved on the account.

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
