# Design source (UI mocks)

Static HTML mocks for the web UI, copied unchanged from
`~/Desktop/ai/deepseek/briefs/gallery-ui/*.dc.html` on 2026-11-25. They are the
design source of truth for layout, copy (Bahasa Melayu), colours and sizes.
The `x-dc` / `sc-for` / `{{…}}` template syntax is ignored — the Svelte app
reproduces the rendered structure and inline styles.

| Mock | Route |
| --- | --- |
| `Login.dc.html` | `/s` (login; redirects to admin when signed in) |
| `Main.dc.html` | `/s/admin` (timeline by date) |
| `Folders.dc.html` | `/s/admin/folders` |
| `Albums.dc.html` | `/s/admin/albums` |
| `AlbumEdit.dc.html` | `/s/admin/albums/:id` (`new` = create) |
| `Links.dc.html` | `/s/admin/clients` |
| `Status.dc.html` | `/s/admin/status` |
| `ClientPortal.dc.html` | `/s/<client-slug>` (desktop) |
| `ClientPortalMobile.dc.html` | `/s/<client-slug>` (phone) |
| `ClientDesktop.dc.html` | `/s/<album-slug>` (desktop) |
| `ClientMobile.dc.html` | `/s/<album-slug>` (phone) |
| `ClientViewer.dc.html` | `/s/<album-slug>?p=<assetId>` |
| `ClientFav.dc.html` | `/s/<album-slug>?fav=1` |
| `ShareSheet.dc.html` | `/s/<album-slug>?share=1` / share button |
| `NotFound.dc.html` | unknown slug |

## Tokens used by the implementation

`graphite #20272b` · `paper #f5f7f7` · `mist #e2e8e9` · `steel #4f5b61` ·
`teal-ink #1f6f68` · `teal-soft #e4f4f2` · `teal #a6ddd6` · public background
`#121517` · bar `#1b2023` · surface `#262d31` · text `#e8ecec` · muted
`#a3aeb2` · favourite `#ef6b62`.

Font: Archivo, self-hosted through `@fontsource-variable/archivo` (weight and
width axes) so the strict CSP never needs Google Fonts.

## Logos

`apps/web/static/logo-light.png` (white wordmark) is used on every dark surface.
`logo-dark.png` (dark ink) ships for light backgrounds and the favicon.
Source: `~/Desktop/ai/claude/projects/jsw-push/site/img/`.

## Photos in screenshots

Mock photos are generated SVG gradients (`src/lib/mocks`), deterministic and
contain no client data. Real photography is never committed (AGENTS §2.7).
