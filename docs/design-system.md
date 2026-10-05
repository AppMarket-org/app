# Web design system

The visual direction is warm, precise, and developer-focused: ivory surfaces, ink typography, copper accents, and an olive-toned product illustration. Entire's homepage informed the product-first narrative (concrete workflows, agent context, and ownership), while appmarket's copy reflects its own implemented features. Do not import third-party benchmarks, testimonials, or capability claims.

## Foundations

| Role | Value | Source |
| --- | --- | --- |
| Page surface | `#f8f7f4` | `--mat-sys-surface` |
| Card surface | `#fcfbf8` | Material card overrides |
| Primary text | `#20251f` | `--mat-sys-on-surface` |
| Secondary text | `#62665e` | `--mat-sys-on-surface-variant` |
| Copper accent | `#923f20` | `--mat-sys-primary` |
| Subtle border | `#dedfd6` | `--mat-sys-outline-variant` |
| Display type | Manrope | `--app-font-display` |
| Body and controls | DM Sans | `--app-font-body` |
| Code and small labels | IBM Plex Mono | `--app-font-mono` |
| Section spacing | `clamp(4rem, 8vw, 7rem)` | `--app-space-section` |
| Panel radius | `1rem` | `--app-radius` |
| Control radius | `0.625rem` | Material component overrides |
| Interaction easing | `cubic-bezier(0.22, 1, 0.36, 1)` | `--app-ease` |

Use Material semantic tokens for application UI. The `--app-*` aliases support custom presentational layouts. The Material error palette and disabled states remain available; copper is a brand color, not an error indicator. Google Fonts are loaded with `display=swap` and system fallbacks.

## Implementation

- `apps/web/src/material-theme.scss`: Material 3 color, typography, density, component overrides, and application tokens. Customize components through supported Material mixins rather than internal DOM selectors.
- `apps/web/src/styles.scss`: global focus, selection, card spacing, and reduced-motion handling.
- `apps/web/src/marketing.scss`: shared marketing headings, labels, actions, catalog grids, empty states, and terminal presentation. Opt in with the `marketing-page` host class.
- `apps/web/src/app/app.scss`: sticky navigation, responsive breadcrumbs/actions, main content width, skip link, and footer.
- `apps/web/src/app/pages/home/workspace-preview/`: a static, explicitly labelled workflow illustration. It is not connected to live repository or deployment state.

All dimensions authored in web source use rem, fluid units, or Material tokens. Buttons, links, chips, fields, menus, and other interactive components use Angular Material. Maintain existing route bindings, resolver inputs, authentication handlers, and conditional data rendering during visual changes.

## Layout and behavior

Lead with the product category: appmarket is a Git platform for agents and humans. Explain app building in the supporting copy. Git hosting, agent checkpoints, and deployment are the platform capabilities; the marketplace is a way to discover and share apps. Prefer concrete verbs such as host, clone, push, build, and deploy over abstract taglines. The primary action is “Deploy an app” and opens the marketplace to choose an app before the existing app-specific deployment flow. “Build an app” opens repository creation. Explain publishing and selling in marketplace copy without making them the primary action.

Homepage sequence: Git platform positioning → workflow illustration → agent compatibility → three-step workflow → privacy and provenance → live marketplace → CLI quick start → final action.

The marketplace always uses resolver data. Its empty state invites publishing without inventing listings. Discovering apps stays public; publishing, workspace access, and Cloudflare connection use existing protected routes. Search keeps its native GET form so filtered results retain shareable URLs and work before JavaScript loads.

At narrow widths, navigation switches to labelled search/dashboard icon buttons. The product illustration and marketing sections stack, categories wrap, and code scrolls inside its terminal when needed. Keep the illustration label visible on phones. Preserve keyboard focus rings, the skip link, accessible section names, and reduced-motion support. Static illustration tabs are decorative, not controls.

Repository workspaces group tools into Code & agents, Deployment, Marketplace, and Access & history, with in-page navigation. Use a two-column grid that aligns cards at the top and stacks on phones. Git credentials use the dark olive surface; destructive repository controls come last. Keep card descriptions at body weight, and use dynamic Material field subscripts so wrapped hints reserve their own space. Workspace-specific Material presentation lives in `apps/web/src/repo-workspace.scss`.

## Verification

Run `pnpm check:ui`, `pnpm --filter @appmarket/web typecheck`, `pnpm --filter @appmarket/web build`, and `pnpm --filter @appmarket/web exec ng test --watch=false`. Check the homepage and search at desktop, tablet, and phone widths, including horizontal overflow, filter submission, category links, in-page anchors, and protected-route sign-in destinations. Signed-in or external OAuth/deployment behavior requires a configured backend and account.
