# Boutique lead verifier: setup

Total time: about 30–45 minutes. Cost: $0. No credit card anywhere.

## What's in the folder

- `build_seed.py` builds the studio list. You run it once on your computer.
- `public/` holds the web page. `public/data/seed.json` gets filled by the script.
- `functions/api/resolve.js` is the live checker, which runs on Cloudflare.

---

## Part 1: Build the studio list (on your computer)

1. Unzip `studio-verifier.zip` somewhere easy, like your Desktop.
2. Open `build_seed.py` in any text editor (TextEdit, Notepad, VS Code).
3. Near the top, find the line `CONTACT_EMAIL = "you@example.com"`.
4. Replace `you@example.com` with your real email, then save. Studio websites see this in their logs, which is the polite way to crawl.
5. Open a terminal:
   - **Mac:** press Cmd+Space, type `Terminal`, then press Enter.
   - **Windows:** press the Windows key, type `PowerShell`, then press Enter.
6. Move into the folder. Type `cd `, with a space after it, drag the `studio-verifier` folder into the terminal window, then press Enter.
7. Install the two helper libraries:
   ```
   python -m pip install requests beautifulsoup4
   ```
   If you see "command not found", use `python3` instead of `python`, here and in step 8.
8. Run the script:
   ```
   python build_seed.py
   ```
   It prints each studio as it reads it. Expect 5–10 minutes, because it waits a second between pages on purpose.
9. When it says `Done`, look at the last line. If fewer than about 15 studios have a named owner or lead, run it again with the county ring included:
   ```
   python build_seed.py --wide
   ```

## Part 2: Put the files on GitHub

1. Go to github.com and click **New** (the green button) to create a repository.
2. Name it `studio-verifier`. Private is fine. Click **Create repository**.
3. On the next screen, click the **uploading an existing file** link.
4. Open your `studio-verifier` folder. Select `build_seed.py`, `README.md`, the `public` folder and the `functions` folder, then drag them all into the browser window. Use Chrome or Edge, since both handle folder drag-and-drop.
5. Wait until every file is listed, then click **Commit changes**.
6. Check that the repo shows `public` and `functions` as folders at the top level. If they're nested inside another `studio-verifier` folder, delete the repo and upload again.

## Part 3: Publish on Cloudflare Pages

1. Log in at dash.cloudflare.com.
2. In the left menu, open **Workers & Pages**, then click **Create**.
3. Choose the **Pages** option. If you only see Workers, look for a link like "Looking to deploy Pages? Get started."
4. Click **Import an existing Git repository**, connect GitHub, and pick `studio-verifier`.
5. In build settings:
   - Framework preset: **None**
   - Build command: leave it **empty**
   - Build output directory: `public`
6. Click **Save and Deploy**. After about a minute you'll get a link like `studio-verifier-xxx.pages.dev`.

## Part 4: Test before you send it

1. Open your link and click a studio that shows an owner's name.
2. Click **First.last format**. It should come back *Verified decision-maker* or *Likely affiliated*.
3. Click **Owner of a different studio**. It should come back *Not verified*.
4. Type a studio that isn't in the list, plus any email. This tests the live OpenStreetMap lookup.
5. Click through 4–5 studios and confirm the owner names are right. If any look wrong, note them so the logic can be fixed before you send the link.

## Updating later

Edit the files on GitHub, or re-upload them. Cloudflare redeploys automatically within a minute. Re-running `build_seed.py` only requires uploading the new `public/data/seed.json`.
