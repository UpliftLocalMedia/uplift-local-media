# Master Prompt — Custom Git-Backed CMS (driven by `.pages.yml`)

Paste everything below the line into Claude Code at the root of the target repo. Run the **Pages CMS "Franchise Lock" Refactor** prompt (`docs/pagescms-franchise-lock-masterprompt.md`) first: this CMS reads that `.pages.yml` and enforces the same lock, so the two editors always agree.

---

Build a fully custom, database-free CMS inside this Astro repo, at `/admin`. It edits the repo's content JSON and images and commits straight to GitHub. It must show **exactly** what the repo's `.pages.yml` (Pages CMS config) exposes: same entries, same arrangement, same labels and descriptions, same read-only fields and list limits. It needs:

- a **login gate** with per-person accounts (managed inside the CMS), not a shared password;
- a split-screen editor with a Payload-style live preview of the **real** page;
- **image uploads** through a media library, not typed image paths;
- one branded **confirmation dialog** for every "are you sure?";
- styling with the site's own brand tokens.

## Ground rules

- **Do not `git commit` or `git push` unless I explicitly ask in that turn.** Leave all changes uncommitted and tell me what changed.
- Read before you change anything: `.pages.yml` (including its `media:` root), `src/content.config.ts`, the routes that render each exposed file, `src/config/site.ts` (token replacement such as `localizeData`), `src/middleware.ts`, `astro.config.*` (and Astro's built-in `security.checkOrigin`), `src/styles/global.css` (brand tokens), and the deploy config (`vercel.json`, `wrangler.*`, …).
- No database, no external CMS or auth service. GitHub API + files in the repo only.
- `.pages.yml` is the single source of truth for what is editable. **Never** hardcode a field list in the CMS, and never expose a file, key or section that `.pages.yml` doesn't.
- Keep diffs minimal. Use Node's stdlib (`node:crypto` scrypt/HMAC) and installed packages (e.g. `js-yaml`, `@octokit/rest`). No auth or upload libraries. Match the surrounding code style. No abstractions with one user.

## Step 1 — Inventory, then confirm with me

1. List every `.pages.yml` entry as it will appear in the sidebar: groups (nested groups as `Pages → Indoor Billboards`), `type: file` entries, and each `type: collection` expanded into its files (sorted by `view.default.sort`, labelled by `title`). Add a final **CMS** group: **My account** (everyone) and **Accounts** (admins only).
2. Note which files are shared by several entries (e.g. `site.json` behind Site Settings, Popup and Map).
3. Note the hosting target. The API routes and `/admin` itself need an adapter (e.g. `@astrojs/vercel`) and `export const prerender = false`. Every site page must stay static.
4. Check whether the repo is private (an unauthenticated `GET https://api.github.com/repos/<owner>/<repo>` returns 404). Accounts are stored hashed in the repo; tell me if it's public.
5. Ask me only what you can't verify yourself: which branch commits should go to, and the owner email.

## Step 2 — Files to create or update

| File | Purpose |
|---|---|
| `src/lib/cms.ts` | Pure, framework-free logic: `parseConfig(yaml)` → flat entries with their group path; `fieldsFor(entries, path)` → the **union** of fields from every entry that owns the path (or `undefined` = not editable); `mergeFields(fields, current, incoming)` → the server-side lock (Step 3); `parseMedia(yaml)` → the `media:` root; `sniffImage(bytes)` and `safeImageName(name, ext)` for uploads; `MAX_UPLOAD_BYTES`. |
| `src/lib/cms-server.ts` | Server-only: `env()`, `HttpError` + `handle()` (uniform JSON errors), `github()` (read / exists / listFiles via one recursive tree call / write with commit author), scrypt password hashing, HMAC-signed sessions, account loading/saving, `login()`, `currentUser()`, `requireUser(ctx, role?)`. Write it so `node` can import it directly: no path aliases, no TS parameter properties. |
| `src/lib/cms.test.ts` | One `node:assert` self-check that runs against the **real** `.pages.yml` and content (`node src/lib/cms.test.ts`). |
| `src/pages/api/auth.ts` | `GET` → current user · `POST { email, password }` → sign in (sets cookie) · `DELETE` → sign out. |
| `src/pages/api/users.ts` | `GET` list (admin) · `POST` add/update (admin) · `PATCH` change my own password · `DELETE` remove (admin). |
| `src/pages/api/media.ts` | `GET` → images under the media root · `POST` multipart `file` → validated upload, committed to the repo. |
| `src/pages/api/save.ts` | `GET ?path=` → `{ content, sha }` read fresh from GitHub. `POST { path, content, sha }` → merge through the lock, then commit. |
| `src/pages/admin/index.astro` | On-demand, `noindex`, `Cache-Control: no-store`. Checks the session on the server and redirects to `/admin/login` before sending any HTML. Reads `.pages.yml?raw` to build the sidebar and passes `{ items, user, maxUpload }` to a vanilla-TS client script. |
| `src/pages/admin/login.astro` | Static, `noindex` sign-in page. |
| `src/styles/cms.css` | Shared admin theme (tokens, inputs, buttons, dialogs) for both admin pages. |
| `src/middleware.ts` | `X-Frame-Options: SAMEORIGIN` (not `DENY`) so `/admin` can frame the real pages. Still blocks cross-origin framing. |
| `astro.config.*` | Adapter (if needed) and `/admin` excluded from the sitemap. |
| `.gitignore` | Adapter output (e.g. `.vercel/`). |
| `.env.example` | Document `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` and optional `GITHUB_BRANCH`. |

## Step 3 — The lock (server-side, never trust the browser)

The client sends the whole object it edited, and the server rebuilds the file from the **current GitHub version**:

- Start from `current`. Copy over only keys whose field `.pages.yml` exposes. Unexposed top-level keys, unexposed keys inside objects (e.g. `metadata.openGraph`) and unexposed keys inside list items are always kept from `current`. This mirrors Pages CMS `merge: true`, and is stricter inside arrays.
- `readonly: true` fields: always taken from `current` (e.g. `order`, `pageUrl`, a Map section's heading).
- `type: block` lists: a section's `blockKey` value (e.g. `section: "Hero"`) comes from `current` and can't be changed. Apply that block's own fields only.
- `list: { min, max }`: reject with 400 when the submitted length is outside the limits (`min = max` means a fixed section count).
- `required` strings can't be blank. `select` values must be in `options.values`. `number` must be finite (empty removes the key). `boolean` is coerced.
- Paths: only `src/content/**.json` matching `^src/content/[a-z0-9-]+(/[a-z0-9-]+)*\.json$` **and** owned by a `.pages.yml` entry. Collections honour `subfolders: false`. Anything else returns 403. The accounts file is outside `src/content`, so the content editor can never touch it.
- Concurrency: the client sends the `sha` it loaded. If GitHub's current sha differs, return 409 ("changed since you opened it, reload"). Pass the sha to `createOrUpdateFileContents` as well.
- Output: `JSON.stringify(merged, null, 2)`, keeping the file's existing trailing newline (or lack of one) so unchanged saves are byte-identical. If nothing changed, return `{ unchanged: true }` without committing.
- Every commit sets `author` to the signed-in CMS user and names them in the message (`Update <path> (via custom CMS by <email>)`), so git history is the audit log.
- Read env with `process.env[key] ?? import.meta.env?.[key]` so it works in dev, on serverless and under plain `node` (tests).

## Step 4 — Login gate and accounts (no database)

**Accounts:**
- **Site owner:** `ADMIN_EMAIL` + `ADMIN_PASSWORD` from env. Always an admin. It can't be edited, demoted or removed in the CMS, and its password is changed only in env. This is the bootstrap account.
- **Everyone else:** `.cms/users.json` in the repo (`[{ email, name, role: "admin" | "editor", hash, createdAt }]`). Not under `src/content` or `public/`, so the site never serves it and the content editor can't write it. It's created on the first account added and committed through the GitHub API with sha checks.
- Emails are trimmed and lowercased. Passwords need 10+ characters. Hashes use `scrypt$<salt b64>$<key b64>` (16-byte salt, 64-byte key) and are verified with `timingSafeEqual`.
- **Roles:** editors edit content and upload images. Admins also manage accounts. An admin can't change their own role or remove themselves. Adding someone whose email already exists returns 409. Unknown roles return 400.

**Sessions:**
- Stateless, signed with `SESSION_SECRET` (32+ chars; refuse to issue sessions without it). The token is `base64url({ e: email, f: fingerprint, x: expiry }).HMAC-SHA256`, valid for 8 hours.
- The fingerprint is a short SHA-256 of the user's password hash (`owner:<ADMIN_PASSWORD>` for the owner), so **changing or resetting a password signs that person out everywhere**. Changing your own password re-issues your cookie.
- Cookie `cms_session`: `HttpOnly`, `SameSite=Strict`, `Secure` on https, `Path=/`.
- `currentUser()` re-checks the account on every request (30s per-instance cache, refreshed on every accounts write), so removed accounts lose access. Mark the cache ceiling with a `ponytail:` comment.
- `requireUser()` returns 401 when signed out, 403 when the role is too low, and 403 for non-GET requests whose `Origin` doesn't match. Astro's own `checkOrigin` also rejects cross-site form posts.
- Login: when the email doesn't exist, still run one scrypt hash so response times don't reveal valid emails. Return the same "Wrong email or password" either way. There's no lockout (no database); note it with a `ponytail:` comment and suggest a WAF rate-limit rule on `/api/auth`.

**Pages:**
- `/admin/login`: brand mark, Email, Password, a gold **Sign in** button with spinner, inline error (`role="alert"`), and "Forgot your password? Ask an admin to reset it." If already signed in, go straight to `/admin`.
- `/admin`: the server redirects to `/admin/login` when there's no valid session. Any API call that later returns 401 opens the confirmation dialog ("Session expired", **Sign in** / **Stay here**). Never redirect silently and drop unsaved work.
- **CMS → My account:** name, email and role, plus a change-password form (current, new, confirm). The owner sees a note that their credentials live in env vars.
- **CMS → Accounts** (admins): every account with an inline role select (confirmed in the dialog) and **Rename**, **Reset password** (dialog with a generated password field) and **Remove** (danger dialog). The owner row is locked and says why. There's also an **Add account** form: name, email, role, and a temporary password with a **Generate** button, confirmed in the dialog, with a reminder to share the password securely.

## Step 5 — Media uploads (no typed image paths)

- `type: image` fields show a thumbnail, **Choose image** / **Replace image** and **Remove** (danger dialog, hidden when `required`), with the stored path as a small caption. There's no free-text path input.
- **Media library dialog:** a searchable grid of every image under the `.pages.yml` media root (`GET /api/media`, one recursive git-tree call, mapped `input` → `output` paths), plus an **Upload image** button. Clicking an image selects it. Images not deployed yet show "Available after the next deploy" instead of a broken thumbnail.
- **Upload rules (server):** max 3 MB (base64 adds ~33%, so this stays under Vercel's 4.5 MB request limit; also check on the client first). Detect the type from the file's **magic bytes** (PNG, JPG, GIF, WebP, AVIF), never from the name or MIME type. **Refuse SVG**: it can carry scripts and would be served from the CMS's own origin. Slugify the name, save to `<media input>/uploads/`, and never overwrite an existing file (add `-2`, `-3`, …). Commit it immediately with the user as author.
- After an upload, use a `blob:` URL of the local file for the thumbnail and the live preview until the deploy serves the real path.

## Step 6 — The editor (`/admin`)

**Layout:** a three-column grid on `lg+`: sidebar | form | preview. It stacks on small screens with 16px gutters and no horizontal scroll. Header: brand mark, "Content Editor", an "Unsaved changes" pill, the signed-in name / email · role, dark/light toggle, **Sign out** (confirmed; it becomes a danger dialog when there are unsaved changes), and a gold **Publish to GitHub** button. Publish is disabled until something changes and is confirmed in the dialog ("Publish "<page>"? … goes live once the site finishes deploying"). It shows a spinner while saving and reports the result in a toast.

**Confirmation dialog (one for the whole CMS):** a native `<dialog>` with `showModal()`, so you get focus trapping, Esc to cancel and a dimmed, blurred backdrop for free. It has a title, message, icon, **Cancel** and a confirm button. Its tones are **primary** (gold button, "?" icon) and **danger** (red button, "!" icon, focus starts on Cancel). An optional single input with min-length validation is used for rename and reset password. Expose it as `ask({ title, message, confirmText, cancelText, tone, input }) → Promise<false | true | string>`. Use it for discarding unsaved changes when switching entries, removing list items or sections, removing an image, publishing, signing out, session expiry and every account action. **Never call `window.confirm/alert/prompt`.** The only exception is the browser's own `beforeunload` prompt, which can't be styled.

**Theme:** only the site's own tokens from `global.css` (`--color-primary*`, `--color-neutral*`, `--color-gold` for primary actions only), mapped in `cms.css` to semantic variables (`--bg`, `--surface`, `--border`, `--text`, `--muted`, `--accent`, `--danger`). Use dark overrides under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and `:root[data-theme="dark"]`, and set the theme before first paint from `localStorage` (wrapped in try/catch). Use shared `.cms-input`, `.cms-btn`, `.cms-btn-primary`, `.cms-btn-danger` and `.cms-dialog` classes and the site font. Watch for unlayered global rules (e.g. `main { display: block }`) beating Tailwind utilities.

**Sidebar:** same grouping and order as `.pages.yml`. Top-level entries with no group go under "Settings". Collections are expanded into their files. The **CMS** group comes last.

**Form:** generated recursively from the field definitions:

| `.pages.yml` | Control |
|---|---|
| `string` | text input |
| `image` | media picker (Step 5) |
| `text` | textarea |
| `rich-text` | monospace textarea marked **HTML** (value stored as HTML, matching how routes render it with `set:html`) |
| `number` / `boolean` / `select` | number input / checkbox / select (with an empty option unless `required`) |
| `object` | fieldset; a blank `label: " "` hides the legend, as Pages CMS does |
| `block` | collapsible card per section, titled from `list.collapsible.summary` (`{index}`, `{fields.x}`) plus the section title; fields come from the matching block |
| `list` | items with **Remove** only above `min` and **+ Add** only below `max` (a block picker for block lists); shows "N (fixed)" when `min = max` |

Show `required` with an asterisk, `readonly` as a disabled control with a "Read-only" badge, and every `description` verbatim under its label. The entry's own `description` (which Pages CMS doesn't display) goes in the form header, with the file path. Never write a key the editor didn't touch, so untouched optional fields don't appear in the JSON.

**Live preview:** the right pane is an `<iframe>` of the real page, using the entry's `pageUrl` pathname (settings entries use `/`; the CMS account views show a short "no page preview" message via `srcdoc`, which must be removed before setting `src` again). It's same-origin, so the parent patches `iframe.contentDocument` directly. No changes to the site's routes or components are needed.
- On every text, rich-text or image edit, run the old and new value through the site's own token replacement (`localizeData`, which also unwraps a lone `<p>`). Normalise the old HTML through a `<template>`, then replace every element whose `innerHTML` equals it. Fall back to text nodes for plain labels next to icons, and for images match `img[src]` (or the optimised URL containing the encoded path) and drop `srcset`. Briefly outline the patched element and scroll it into view only if it's off-screen.
- Edits the preview can't show (added or removed items, toggles, selects, numbers, previously empty fields, unmatched text) display a notice: "can't be shown until published". **Never fake it.**
- Desktop / Tablet / Mobile width buttons and a reload button. Mark the site's lead popup as already shown in `sessionStorage` so it doesn't cover the preview.

## Verification (do all of these before reporting)

1. `node src/lib/cms.test.ts` passes. It must cover:
   - **Lock:** non-exposed files rejected (navbar, a solutions page, `..` traversal, a nested collection path); an unchanged save is a no-op for every exposed file; an exposed edit applies; block type, read-only `order`, unexposed top-level keys and unexposed nested keys can't be changed; a fixed section count can't change; required fields can't be blanked.
   - **Media:** `parseMedia` matches `.pages.yml`; PNG and AVIF are detected; SVG and HTML are refused; file names are slugified, including traversal attempts and accented characters.
   - **Auth:** correct and wrong passwords; a non-scrypt hash fails; a session with the wrong secret, a tampered payload or an expired timestamp is rejected; re-hashing the same password changes the fingerprint.
2. `astro build` succeeds, every site page is still prerendered, and `/admin/login` is static.
3. Against a dev server started with test env vars (Astro won't start a second dev server while an AI agent is detected; use `--ignore-lock` in the foreground with the agent env vars unset, on another port, and never stop my own server). Send an `Origin` header on POST/DELETE, as browsers do:
   - `/admin` signed out → 302 to `/admin/login`; `/api/save` signed out → 401;
   - wrong password → 401 with the generic message; login with a foreign `Origin` → 403;
   - owner login (email in different case) → cookie is `HttpOnly`; `/admin` → 200;
   - non-exposed path → 403; SVG upload → 415; a valid request reaches GitHub;
   - sign out → `/admin` redirects again.
4. In a browser (stub `fetch` for the GitHub-backed endpoints with the local files if no token is available):
   - sign in through the form; every sidebar entry loads, and the fields, badges and limits match `.pages.yml`;
   - editing a title, a rich-text field and an image updates the iframe instantly;
   - the media library opens, and picking an image updates the field and the preview;
   - publish asks first, then sends `{ path, content, sha }`;
   - the Accounts and My account views render, and the danger dialog focuses Cancel;
   - dark/light and mobile widths look right.
5. Report: what's editable (same as Pages CMS), who can do what, what changed outside the CMS files (adapter, middleware header, env vars, `.gitignore`), the deliberate ceilings (no login rate limit, 30s account cache, preview patch limits, 3 MB uploads, SVG refused), and anything not built (creating new pages, deleting media files, a rich-text toolbar). Leave everything uncommitted.
