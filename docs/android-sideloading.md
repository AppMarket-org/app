# Android APK downloads and developer verification (#33, M2)

Status re-checked on 2026-10-04, at the start of Phase 2 work on M2.

## What Google requires

- Apps installed on certified Android devices must come from a developer verified by Google, including apps installed outside Google Play ("sideloading").
- The Android Developer Verifier service began rolling out to devices running Android 8 and later in June 2026. Limited-distribution accounts (students, hobbyists) and the advanced sideloading flow launched globally in August 2026.
- Enforcement started on **30 September 2026 in Brazil, Indonesia, Singapore and Thailand**, and expands **worldwide in 2027**.
- Apps from unverified developers can still be installed through an advanced flow that includes a 24-hour wait.

Sources: [Android Authority](https://www.androidauthority.com/android-sideloading-changes-timeline-3679204/), [Help Net Security](https://www.helpnetsecurity.com/2026/03/31/android-developer-verification-requirement/), [BigGo Finance](https://finance.biggo.com/news/202606211920_Android-sideloading-restrictions-start-September-30), [Google: developer verification](https://developer.android.com/developer-verification).

## What appmarket.org does

- APKs are uploaded as releases (R13) and served through short-lived signed links (R14); paid apps will need an entitlement first (R17).
- **APK downloads open only after the developer declares** the app's package name and confirms they registered it and completed developer verification in the Android Developer Console (repo page, Android downloads card; `PUT /api/repos/:owner/:slug/android`). Until then the download link endpoint refuses APKs (`403 android_not_verified`).
- Buyers confirm a warning before each APK download: allowing installs from the browser, trusting the developer, checking the SHA-256, and that Android may block apps from unverified developers.
- appmarket.org does not verify the declaration with Google (there is no public API for it) and does not read the package name from the APK yet. Both are follow-ups if Google offers a way.

Re-check this page when the worldwide rollout date is announced.
