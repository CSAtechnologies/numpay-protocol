# NumPay: APK distribution and the update notice

Written 2026-07-31. Everything below was run on this machine, not recalled.

**Where this stopped:** everything is built, tested and committed. The only thing
missing is somewhere to host the files. R2 activation failed because the card was
declined, so the chain is paused at exactly one step. Nothing else is blocking.

---

## 1. The constraint that shapes all of this

**Cloudflare Pages caps a single asset at 25 MiB** (verified in their docs
2026-07-31). The universal APK is 105.5 MB and even the smallest split build is
36.5 MB, so **the APK can never be served from the marketing site**. This is not
a configuration problem to be worked around; it is the reason a separate object
store is needed at all.

Ruled out, with reasons:

- **GitHub Releases.** Handles the size fine, and reintroduces the exact
  reachability problem that moved the site off GitHub Pages: GitHub routes badly
  on Nigerian mobile networks, which is the primary market. See the marketing
  site notes.
- **Serving bytes through the Worker.** Pointless. A redirect costs one hop and
  keeps the file on storage with free egress and no response ceiling.

**R2 is still the right answer** when it can be activated: free tier is 10
GB-month storage, 10M Class B ops/month, and **egress is free**, which is the
line item that would otherwise dominate for a 43.6 MB file. Expected cost at
this project's scale is zero. It requires a payment method on file even for the
free tier, which is what failed.

---

## 2. What is built and committed

Branch `feat/dapp-connect` (main repo) and `feat/marketing-site` (site worktree).
**Nothing is pushed and nothing is deployed except the worker's `/v1/app-version`.**

| Commit | What |
|---|---|
| `8e8b7e4` | The advisory update notice: worker endpoint, core client, mobile banner, 27 tests |
| `c9f21f1` | Per-ABI release APKs and versionCode 6 |
| `8c04334` | `/download/android/{variant}` permanent redirect route (written, NOT deployed) |
| `9dda744` (site) | The APK download button and verification block (NOT deployed) |

### Already live

`/v1/app-version` IS deployed and verified (worker 0.4.0):

```
{"android":{"latest":6,"minSupported":1,"severity":"none"}}
```

Inert by design: `severity: "none"` and a build-6 user is on 6, so nobody sees
anything. `/v1/prices` confirmed unregressed after the deploy.

### The built artifacts

Copied OUT of `android/app/build/outputs/` because `expo prebuild` deletes that
directory, and it has already been run several times this session:

```
C:\Users\HP OMEN\Desktop\NumPay-builds\v1.02-build6\
  numpay-1.02-build6-arm64-v8a.apk      43.6 MB
  numpay-1.02-build6-armeabi-v7a.apk    36.5 MB
  numpay-1.02-build6-universal.apk     105.5 MB
  SHA256SUMS.txt
```

All three verified at **versionCode 6**, signed `CN=NumPay, O=NumPay, C=NG`
(RSA 4096, APK Signature Scheme v2). The digests in `SHA256SUMS.txt` match the
ones already published in the site's verification block.

---

## 3. To resume, once R2 activates

1. `wrangler r2 bucket create numpay-downloads`
2. Upload the three APKs from `NumPay-builds\v1.02-build6\`.
3. Enable public access and take the `pub-<hash>.r2.dev` hostname.
4. Fill the three empty strings in `NumPay/wallet-api/src/download.ts` `TARGETS`.
   **Keep the keys** (`arm64`, `arm32`, `universal`): they are the public URL
   surface and are already linked from the site.
5. `wrangler deploy` from `NumPay/wallet-api`.
6. Verify each of the three redirects resolves to a real file.
7. Mirror the site (`git subtree split` to the public repo) so Pages publishes.

Do NOT do step 7 before step 6. A live download button that cannot download is
worse than no button on a wallet site.

### If R2 never activates

The site links go through the worker, not storage, so **the site does not need
changing** whatever the answer is. Only `TARGETS` in `download.ts` does. Any host
that can serve a 45 MB file over HTTPS works, though picking one that is
reachable on Nigerian mobile networks matters more than the price.

---

## 4. Things that will bite whoever picks this up

- **versionCode 6 is the first build containing the update check.** Builds 1 to 5
  cannot be reached by `/v1/app-version` at all, because they have no client for
  it. **The versionCode 5 APK built earlier this session must not be
  distributed**; it would be permanently unwarnable. Only build 6 goes out.
- **`latest` in `appVersion.ts` must only be raised once the build it names is
  actually downloadable.** Raising it first points people at a page that cannot
  give them what the banner just promised.
- **`DOWNLOAD_URL` in `wallet-mobile/src/update/appUpdate.ts` is compile-time.**
  That is deliberate, and it is what stops a compromised worker redirecting
  anyone. The cost is that every shipped build points at whatever was baked in,
  permanently. It is currently `https://numpay-site.pages.dev/#download`, so if a
  custom domain arrives, that URL has to redirect forever.
- **A release-signed APK cannot install over the debug build** on the emulator.
  Signature mismatch forces an uninstall, which wipes the vault. Use a clean AVD.
- **ABI splits carry no `versionCodeOverride` on purpose.** The usual recipe
  offsets versionCode per architecture, which would make an arm64 user look like
  build 2000006 against a `latest` of 6 and silence their notice forever.

---

## 5. Still unverified

**The update banner has never been seen rendering.** Its decision logic has 27
unit tests, including a control that stops them false-passing, but the UI itself
has only ever existed in code. Two attempts to capture it failed: Metro was
wedged from an earlier session and the emulator screenshot cycle timed out, then
the browser tooling was unavailable. The temporary force-the-banner edit was
reverted; nothing debug-flavoured is left in the tree.

**Before this reaches real users**, install the arm64 APK on a clean device,
temporarily raise `latest` to 7, and confirm the banner appears and that "Get the
update" opens the download page. Also worth checking the `critical` styling,
which uses the danger tone and re-appears after dismissal.

The site's download section has also never been rendered in a browser, only
checked for tag balance. Preview locally with `npx serve` before publishing.
