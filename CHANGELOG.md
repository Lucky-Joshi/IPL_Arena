# Changelog

All notable changes to **T20 Dynasty** are recorded here.

This changelog was reconstructed from git history because none existed previously. Dates and short
commit hashes follow the repository history. Historical commit subjects are preserved verbatim, so
older product names and feature names may appear even where the current product has since been
renamed or the feature has been removed.

## 2026-11-25

### Added

- `LICENSE` — proprietary, all-rights-reserved terms. No use, copying, modification, distribution
  or deployment is permitted without prior written permission from the copyright holder.
- `CHANGELOG.md` — reconstructed from git history.
- Licence metadata in `frontend/package.json`, `frontend/package-lock.json`, `backend/package.json`
  and `README.md`.

## 2026-11-24

### Removed

- `746f733` — `feat: remove trading feature completely`

### Added / Changed / Fixed

- `91aa9d8` — `feat: make pre-retention trading the first setup step`
- `12a906c` — `fix: keep Trade Desk reachable and expose Clawback RTM status`
- `9bdf654` — `feat: surface Trade Desk before retentions and after auction in frontend`
- `d5370ae` — `feat: enable pre-retention trading across all seasons`
- `bcfc8b3` — `fix: expose Mini trading windows and auction feature controls`
- `d33a3b0` — `feat: make game completely fictional`
- `43fb0cf` — `ci: run AI tests, backend smoke suite and frontend build on GitHub Actions`
- `ba6f1c6` — `feat: configurable CORS allowlist, local .env loading and robust AI trades`

## 2026-11-23

### Added / Changed

- `f2417da` — `docs: add Vercel + Render deployment guide and env templates`
- `079971d` — `feat: implement BCCI player trading with full approval protocol`
- `c6fe012` — `Rebrand simulator as T20 Dynasty with independent identity`
- `72b6525` — `Implement BCCI 2025-2027 season rules across simulator`

## 2026-11-22

### Added

- `ad0c43c` — `feat: add SetupScreen, SquadManager, and TopBar components for auction setup and management`
- `2a0e62d` — `feat: initialize frontend with Next.js and React dependencies`
- `90a17d9` — `Implement IPL Auction AI service with decision-making and public commentary`
- `edf1614` — `Add service check, launcher, and verification scripts for IPL Auction Arena`
- `064beb3` — `Add verification matrix and AI decision service documentation`
- `28a9f33` — `Add initial .gitignore, ARCHITECTURE.md, and README.md files`
