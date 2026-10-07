---
title: "iOS"
description: "Link your app’s App Store page and TestFlight beta from its listing."
---

appmarket.org never builds, signs or hosts iOS apps. The developer submits the app to Apple
(App Store Connect) and links it from the repo:

- **App Store link**: the app's page, e.g. `https://apps.apple.com/us/app/my-app/id1234567890`
  (any storefront, with or without the app's name in the path).
- **TestFlight public link**: a beta invite from App Store Connect › TestFlight › External Testing ›
  Public Link, e.g. `https://testflight.apple.com/join/AbCd1234`.

Set them in the repo's details (Platforms › iOS, then the iOS fields), or with
`PATCH /api/repos/:owner/:slug` (`iosAppStoreUrl`, `iosTestflightUrl`; `null` clears). The API
accepts only those two address shapes. Removing iOS from the platforms in the form clears both.

The listing shows an **iPhone and iPad** section with the links when iOS is one of the repo's
platforms and at least one link is set. The links go live when saved; they are not part of a
reviewed version.

Out of scope: EU alternative app marketplaces; revisit only if analytics show EU iOS demand.
