# MineSwap / Season 3 WAR — Security Audit Report V7

**Date:** March 31, 2026  
**Scope:** All API routes, authentication layer, WAR system, wall mechanics, boss battles, game economy, UX flows, **shop purchase system**, **expedition/achievement/challenge reward validation**  
**Auditor:** Claude (Anthropic) — AI-assisted review  
**Pen Tester:** Jay Anon (SSSLLC) — live Burp Suite testing  
**Status: PASSED — ALL CRITICAL/HIGH RESOLVED ✅**

---

## Audit Changelog

| Version | Date | Scope |
|---------|------|-------|
| V1 | Jan 2026 | Initial DEX contracts + CORS |
| V2 | Feb 2026 | Solidity audit (11 findings, all resolved) |
| V3 | Mar 9 2026 | War system, treasury contract, AttackMenu, hardcoded key removal |
| V4 | Mar 24 2026 | Season 3 launch — CPS throttle, raid resolver, distributed locks |
| V5 | Mar 30 2026 | ETH wall audit, boss rebalance, gold wall scaling, UX flow audit, full route scan |
| V6 | Mar 31 2026 | Shop purchase hardening — maxOwned enforcement, price matching, rate limiting, stacking exploits |
| V7 | Mar 31 2026 | Server-side reward validation — expeditions, achievements, daily challenges, gold increase capping |

---

## V7 Findings Summary — Server-Side Reward & State Validation

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 1 | ✅ Resolved |
| Medium | 3 | ✅ All Resolved |
| Low | 10 | ✅ All Resolved |

---

## V7 CRITICAL FINDINGS

### C-7: BG token allocation fields writable by client save (V7 — RESOLVED ✅)

**Affected:** `app/api/game/route.ts` → POST save handler, `warChest.lockedBG/earnedBG/stolenBG/lostBG`

**Issue:** The client sends the full `warChest` object in every save, including `lockedBG`, `earnedBG`, `stolenBG`, and `lostBG`. These four fields compute the player's BG token allocation at season end via `getTotalBG() = lockedBG + earnedBG + stolenBG - lostBG`. A Burp Suite user could set `earnedBG: 9999` or `lockedBG: 9999` in a single save request and claim thousands of BG tokens at season end.

**Exploit:** Intercept any game save POST with Burp Suite. Add `warChest.earnedBG: 5000` to the payload. Server saves it to Redis. At season end, player claims 5000 BG (worth real money) for free.

**Fix:** BG fields are now **server-authoritative**. On every save, the server overwrites all four BG fields with the previous save's values. Only server-side actions can modify them: `lockedBG` via admin `/api/bg-allocations`, `lostBG` via `/api/war-log` `deduct_bg` action. The client's submitted BG values are completely ignored.

---

## V7 MEDIUM FINDINGS

### M-8: Expedition rewards entirely client-calculated (V7 — RESOLVED ✅)

**Affected:** `app/api/game/route.ts` → POST save handler

**Issue:** When a player claimed an expedition, the gold reward was calculated entirely client-side in `handleClaimExpedition()`. The server only checked that gold didn't exceed `maxPossibleGold * 1.5`, but expedition rewards (up to GPS × 168 hours × 2x goldMultiplier × 2x Ancient Relic) could legitimately far exceed that threshold. The old code blindly exempted ALL gold increases when any achievement/challenge flag flipped, regardless of the amount.

**Exploit:** Burp Suite user intercepts the save after claiming a Shallow Dig, modifies gold increase to 1 billion. Old code exempts it because `isLegitimateRewardClaim` was true from ANY claim.

**Fix:** Server now computes the maximum possible expedition reward using server-side constants (`EXPEDITION_REWARDS` map), validates `gpsAtStart` against `computeServerGPS()`, and caps `totalLegitimateExemptGold` to the sum of all verifiable claims. Gold increases beyond `maxPossibleGold * 1.5 + totalLegitimateExemptGold` are clamped.

### M-9: Achievement rewards not verified against known values (V7 — RESOLVED ✅)

**Affected:** `app/api/game/route.ts` → POST save handler

**Issue:** Achievement reward gold was exempted from cheat detection purely by counting newly-claimed flags. The server never checked the actual reward amount. A Burp Suite user could flip `claimed: true` on an achievement and claim an arbitrary gold amount.

**Fix:** Server now maintains `ACHIEVEMENT_REWARDS` lookup table with all 27 achievement IDs and their exact gold rewards (matching `lib/season3.ts`). Only known achievement IDs with known rewards are exempted. Unknown achievement IDs are logged and ignored.

### M-10: Daily challenge rewards uncapped (V7 — RESOLVED ✅)

**Affected:** `app/api/game/route.ts` → POST save handler

**Issue:** Challenge rewards were read from `newChallenges[i]?.reward` — a client-sent value. A Burp Suite user could set `reward: 999999999` on a challenge and the server would exempt it.

**Fix:** Each challenge reward is now capped to `MAX_SINGLE_CHALLENGE_REWARD = 200,000` (the highest reward in the challenge pool). Challenge array is also capped to 3 entries (max 3 challenges per day).

---

## V7 LOW FINDINGS

### L-4: Expedition `gpsAtStart` not validated on start (V7 — RESOLVED ✅)

**Issue:** When a player started an expedition, `gpsAtStart` was set client-side to `basePerSecond * boostMultiplier * globalMultiplier`. A Burp Suite user could inflate this before the save.

**Fix:** Server validates `gpsAtStart` against `serverRawGPS * MAX_PERMANENT_MULTIPLIER` with 10% tolerance when an expedition transitions from null → active. Inflated values are clamped.

### L-5: `completedExpeditions` counter could jump by arbitrary amounts (V7 — RESOLVED ✅)

**Issue:** Client increments `completedExpeditions` by 1 on claim, but the server never validated the delta. A Burp Suite user could set it to 999.

**Fix:** Server caps `completedExpeditions` increase to +1 per save when an expedition is claimed (detected by `prevExpedition && !curExpedition`).

### L-6: `expeditionGpsBonus` uncapped — permanent GPS inflation (V7 — RESOLVED ✅)

**Issue:** Each expedition claim adds permanent GPS. Value saved in `s3.expeditionGpsBonus` without server-side cap. Burp Suite user could set it to 999,999 for massive passive income.

**Fix:** Capped at `MAX_EXPEDITION_GPS_BONUS = 15,000` (generous headroom over theoretical max of ~10,000). Negative values forced to 0.

### L-7: `expeditionTempMultiplier` uncapped — infinite boost duration (V7 — RESOLVED ✅)

**Issue:** Temporary multiplier from expedition return stored as `{ multiplier, endTime }`. Burp Suite user could set `multiplier: 1000` or `endTime: year 2099`.

**Fix:** Multiplier capped at 3.0 (legendary max). End time capped to within 6 hours of current time.

### L-8: `warChest.totalVaulted` — fake vault bonuses (V7 — RESOLVED ✅)

**Issue:** `totalVaulted` feeds into `getVaultBonuses()` which gives up to +225% click and +235% GPS across 8 tiers. Burp Suite user could set `totalVaulted: 1e15` for max vault bonuses without earning gold.

**Fix:** `totalVaulted` capped to never exceed `totalGoldEarned` — can't vault more gold than you've ever earned.

### L-9: `loginStreak` could jump arbitrarily (V7 — RESOLVED ✅)

**Issue:** Client sets `loginStreak.currentStreak`. Burp Suite user could set it to 30 for max daily streak bonus (100,000 gold/day).

**Fix:** `currentStreak` increase capped to +1 per save vs previous save's value.

### L-10: Monotonic counters could be decremented (V7 — RESOLVED ✅)

**Issue:** `totalGoldEarned`, `totalClicks`, and `raidState.totalRecruited` are lifetime counters that should never decrease. Without validation, a Burp Suite user could reset them to 0 (e.g., to re-trigger achievement milestones or exploit delta checks).

**Fix:** All three counters now preserved at previous save value if the incoming value is lower. `legendaryExpeditions` also capped to never exceed `completedExpeditions`.

### L-11: `maxComboReached` could exceed allowed combo limit (V7 — RESOLVED ✅)

**Issue:** `maxComboReached` feeds into combo achievements (`combo_25` = 250,000 gold reward). A player with base 10x max combo (no Crown/Goat/Phoenix) could Burp Suite `maxComboReached: 25` to unlock the `combo_25` achievement and claim 250k gold.

**Fix:** Capped to `validMaxComboForAchievements` (the server-validated `maxCombo` value). Also made monotonic — can never decrease from previous save.

### L-12: `bossesDefeated` could jump by arbitrary amounts (V7 — RESOLVED ✅)

**Issue:** `bossesDefeated` is a display counter with no economy impact currently, but could feed into future achievements or season rewards. Burp Suite user could set it to 999.

**Fix:** Increase capped to +3 per save interval (generous — bosses spawn every ~100 clicks). Monotonic — never decreases.

---

## V7 Files Changed

| File | Change |
|------|--------|
| `app/api/game/route.ts` | **BG fields server-authoritative** (C-7: lockedBG/earnedBG/stolenBG/lostBG always overwritten from previous save), `ACHIEVEMENT_REWARDS` lookup (M-9), `MAX_SINGLE_CHALLENGE_REWARD` cap (M-10), `EXPEDITION_REWARDS` validation (M-8), `gpsAtStart` clamping (L-4), `completedExpeditions` +1 cap (L-5), `expeditionGpsBonus` cap 15k (L-6), `expeditionTempMultiplier` cap 3x/6h (L-7), `warChest.totalVaulted` ≤ `totalGoldEarned` (L-8), `loginStreak` +1/save (L-9), monotonic counters: `totalGoldEarned`, `totalClicks`, `totalRecruited` (L-10), `maxComboReached` ≤ `maxCombo` + monotonic (L-11), `bossesDefeated` +3/save + monotonic (L-12), `serverRawGPS` computed early for expedition validation |
| `SECURITY_AUDIT.md` | Updated to V7 |

---

## V6 Findings Summary — Shop Purchase Hardening

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 3 | ✅ All Resolved |
| Medium | 3 | ✅ All Resolved |
| Info | 1 | ℹ️ Noted |

---

## V6 CRITICAL FINDINGS

### C-4: `global_multiplier` (Second Mine) stacks multiplicatively (V6 — RESOLVED ✅)

**Affected:** `components/MinerGame.tsx` → `calculateVerifiedBonuses()`

**Issue:** `global_multiplier` case used `globalMultiplier *= 2`. If a user bought Second Mine 3 times on-chain (even though it's "one-time"), the bonus calculator applied all 3: `1 × 2 × 2 × 2 = 8x`. No deduplication enforced at the bonus calculation level.

**Exploit:** Buy Second Mine 4 times via direct contract call (bypassing UI) → 16x multiplier on ALL earnings. Each purchase still burns BG legitimately, but the game-breaking multiplier far exceeds the intended 2x.

**Fix:** Added `maxOwned` field to every SHOP_ITEM. `calculateVerifiedBonuses()` now tracks `itemAppliedCount` per item and skips any item that exceeds its `maxOwned` limit. Second Mine is `maxOwned: 1`.

### C-5: `golden_goat` autoClickRate stacks additively (V6 — RESOLVED ✅)

**Affected:** `components/MinerGame.tsx` → `calculateVerifiedBonuses()`

**Issue:** `autoClickRate += item.effect.autoClick || 2`. Each duplicate Golden Goat purchase added +2 auto-clicks/sec. 5 purchases = 10 auto-clicks/sec, generating gold with zero player interaction.

**Fix:** Same `maxOwned: 1` enforcement. `itemAppliedCount` gate prevents second application.

### C-6: Purchase API routes had ZERO rate limiting (V6 — RESOLVED ✅)

**Affected:** `app/api/purchases/route.ts`, `app/api/purchases/history/route.ts`

**Issue:** Both endpoints were unauthenticated GET routes with no rate limiting. An attacker could spam BaseScan API calls through these routes, exhausting the shared API key quota (5 req/sec with key, 1 req/5sec without) and causing purchases to fail for all players.

**Fix:** Added `checkRateLimit()` from `lib/ratelimit.ts` — 20/min for `/api/purchases`, 10/min for `/api/purchases/history` (heavier endpoint). Uses CF-Connecting-IP for accurate per-IP limiting behind Cloudflare.

---

## V6 MEDIUM FINDINGS

### M-5: Price matching tolerance too loose at 5% (V6 — RESOLVED ✅)

**Affected:** All 3 purchase route files + `calculateVerifiedBonuses()`

**Issue:** `Math.abs(purchaseEth - itemEth) / itemEth < 0.05` meant a 5% tolerance window. Items at 0.001 ETH (Golden Crown, ETH Wall, Catapult) could cross-match. A 0.00095 ETH transaction matched both.

**Fix:** Tightened to 2% tolerance across all 4 locations. Gas fees don't affect `msg.value` (only the gas receipt), so exact-price matching with a tiny rounding buffer is correct. 2% of 0.001 = 0.00002 ETH — impossible to hit accidentally.

### M-6: `confirmPurchase` had no `maxOwned` gate (V6 — RESOLVED ✅)

**Affected:** `components/MinerGame.tsx` → `confirmPurchase()`

**Issue:** The buy button was visually hidden when an item was maxed, but `confirmPurchase()` could still be called via browser devtools: `confirmPurchase()` directly, or by editing DOM to re-enable the button. The on-chain tx would succeed (burning ETH) and the client would credit the duplicate item.

**Fix:** `confirmPurchase()` now checks `verifiedPurchases` count against `selectedItem.maxOwned` before calling `buyAndBurn()`. If maxed, logs a security warning and closes the modal without submitting the transaction.

### M-7: `mega_boost_5x` was re-purchasable (timer restackable) (V6 — RESOLVED ✅)

**Affected:** `SHOP_ITEMS` definition

**Issue:** `mega_boost_5x` had no ownership limit. Each purchase burned ETH and restarted the 5-minute 5x boost timer. While each purchase legitimately burns BG, the perpetual 5x boost from repeated purchases was not the intended design.

**Fix:** `maxOwned: 1` on `mega_boost_5x`. Single purchase, single 5-minute window. To get another boost, player must wait for the season shop refresh or buy a different boost item.

---

## V6 INFORMATIONAL

- **I-4:** `instant_gold` (Time Warp) effect type is defined in SHOP_ITEMS but has no handler in `calculateVerifiedBonuses()`. Purchases burn BG correctly but the gold reward is never applied. This is a game feature gap, not a security issue. The item should either get a handler or be removed from the shop.

---

## V6 Files Changed

| File | Change |
|------|--------|
| `components/MinerGame.tsx` | `maxOwned` on all 16 SHOP_ITEMS, `itemAppliedCount` dedup in `calculateVerifiedBonuses()`, `maxOwned` gate in `confirmPurchase()`, price tolerance 5%→2% |
| `app/api/purchases/route.ts` | Rate limiting (20/min/IP), price tolerance 5%→2% |
| `app/api/purchases/history/route.ts` | Rate limiting (10/min/IP), price tolerance 5%→2% |
| `api/purchases/route.ts` | Price tolerance 5%→2% (legacy route) |
| `SECURITY_AUDIT.md` | Updated to V6 |

---

## V5 Findings Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 3 | ✅ All Resolved |
| Medium | 4 | ✅ All Resolved |
| Low | 3 | ✅ All Resolved |
| Info | 3 | ✅ Noted |

---

## CRITICAL FINDINGS

### C-1: Hardcoded admin key fallback (V3 — RESOLVED ✅)

**Affected:** 6 admin API routes  
**Fix:** All routes use `validateAdminKey()` from `lib/auth.ts` — timing-safe comparison, fail-closed if `BG_ADMIN_KEY` env var not set.  
**Verified V5:** Zero hardcoded fallbacks across entire codebase. All 8 admin routes confirmed using `validateAdminKey()`.

**⚠️ ACTION REQUIRED:** `BG_ADMIN_KEY` must be rotated in Vercel to a new random value.

### C-2: ETH wall HP tracking — phantom walls (V5 — RESOLVED ✅)

**Affected:** `app/api/war-log/route.ts`, `components/WarPanel.tsx`, `components/WarSceneCanvas.tsx`, `components/MinerGame.tsx`

**Issue:** `WallData` had no `ethWallHP` field. Chip damage decreased `wallHP` but `ethWallsBought` stayed the same, creating phantom walls. Catapult damage used `Math.floor(hpRemoved / 5)` which silently ate 1-4 HP. UI showed `ethWallsBought * 5` instead of actual remaining HP.

**Fix:** Added `ethWallHP` field with auto-migration for existing Redis records. All 4 damage paths now correctly decrement `ethWallHP`. UI uses real server value.

### C-3: ETH walls — no purchase-at-a-time enforcement (V5 — RESOLVED ✅)

**Affected:** `app/api/war-log/route.ts`, `components/WarPanel.tsx`, `lib/config.ts`

**Issue:** All 5 ETH walls could be stacked instantly (25 HP).

**Fix:** Server rejects `buy_wall` if `ethWallHP > 0`. `MAX_WALL_HP` reduced from 35 to 15. All hardcoded `35` replaced with imported `MAX_WALL_HP` constant.

---

## MEDIUM FINDINGS

### M-1: AttackMenu API missing rate limiting (V3 — RESOLVED ✅)

**Fix:** In-process rate limiter: 1 req/3s per IP. 30s cache.

### M-2: myTokenId parameter unsanitised (V3 — RESOLVED ✅)

**Fix:** Regex validation before parseInt.

### M-3: Gold wall flat pricing exploit (V5 — RESOLVED ✅)

**Issue:** All 10 gold walls cost 100M. Too cheap at high levels.

**Fix:** Scaling: wall 1 = 100M, wall 10 = 1B. Total = 5.5B. Server-authoritative calculation.

### M-4: Boss battles impossible at 5 CPS (V5 — RESOLVED ✅)

**Issue:** Ancient Titan (100 HP) unbeatable with 50 max clicks in 10s.

**Fix:** HP rebalanced to 8-25 range. All bosses beatable at 2-3 CPS.

---

## LOW FINDINGS

### L-1: Boss spawn position exploitable by automation (V5 — RESOLVED ✅)

**Fix:** Random corner spawn (4 positions) chosen once per encounter. Automation needs DOM scanning or 4 simultaneous targets — both fail the CPS throttle.

### L-2: Gold wall build — double-click exploit (V5 — RESOLVED ✅)

**Fix:** `buildingGoldWall` loading state disables button during API call. Error display added (was silent catch). Success flash added.

### L-3: Transaction error shows under wrong section (V5 — RESOLVED ✅)

**Fix:** `txFailed` error now checks `buying` state — shows under correct section. Success flash banner added for both purchase types.

---

## INFORMATIONAL

- **I-1:** `/api/smelter?action=all` is public (by design) — aggregated balances only
- **I-2:** War session tokens are not rotated on use (24h TTL, acceptable for game UX)
- **I-3:** `dao`, `dex-prices`, `username`, `session` routes are unauthenticated (public reads or wallet-sig verified)

---

## Full Route Audit — Rate Limiting Coverage (V5)

### ✅ Rate-limited routes

| Route | Limiter |
|-------|---------|
| `api/game` | `checkGeneralLimit` (GET), `game:${ip}` 60/min (POST) |
| `api/leaderboard` | `checkGeneralLimit` (GET), `checkWriteLimit` (POST) |
| `api/dao` | `checkGeneralLimit` (GET), `checkWriteLimit` (POST) |
| `api/war-log` | `warlog:${ip}` 40/min + per-action limits |
| `api/airdrop` | `checkGeneralLimit` (GET) |
| `api/smelter` | `checkGeneralLimit` (GET), admin-gated (POST) |
| `api/pvp/lobby` | `checkGeneralLimit` (GET), `checkWriteLimit` (POST) |
| `api/pvp/credits` | `checkGeneralLimit` (GET), `checkWriteLimit` (POST) |
| `api/pvp/ably-auth` | `checkGeneralLimit` |
| `api/raid/targets` | In-process 1 req/3s + 30s cache |
| `api/rpc` | `checkRateLimit` 300/min per IP |
| `api/purchases` | `checkRateLimit` 20/min per IP (V6) |
| `api/purchases/history` | `checkRateLimit` 10/min per IP (V6) |
| `api/username` | `checkGeneralLimit` (GET), `checkWriteLimit` (POST) |
| `api/war-auth` | `checkWriteLimit` |
| `api/dex-prices` | `checkGeneralLimit` |

### ✅ Admin-only routes (key-gated, rate limiting not required)

| Route | Auth |
|-------|------|
| `api/beta-reset` | `validateAdminKey()` |
| `api/bg-allocations` | `validateAdminKey()` |
| `api/season` | `validateAdminKey()` |
| `api/season-transition` | `validateAdminKey()` |
| `api/season3-launch` | `validateAdminKey()` |
| `api/seed-pvp-credits` | `validateAdminKey()` |

### ✅ Static/cached routes (rate limiting not required)

| Route | Reason |
|-------|--------|
| `api/nft/*` | Read-only NFT metadata, Vercel edge-cached |
| `api/farcaster-manifest` | Static JSON manifest |

---

## Architecture Review — PASSED ✅

### Authentication
- `lib/auth.ts` — single source of truth for sessions, admin keys, NFT ownership
- 32-byte crypto-secure session tokens, 24h Redis TTL
- `requireAuthForToken()` prevents cross-mine attacks
- Admin: timing-safe comparison, fail-closed if env var missing
- On-chain NFT ownership verified in `createSession()` with 4-attempt retry + stale cache fallback

### Anti-Cheat
- 5 CPS universal hard cap (client + server)
- 100ms minimum per-click interval
- Server-side gold/click/second clamping
- `withLock()` distributed Redis locks for race conditions on raids, smelter, wagers
- Client-reported results never trusted — server resolves all economics

### Wall System (V5)
- `ethWallHP` tracks actual remaining HP (0-5), not derived from purchase count
- Gold walls destroyed first (1 HP each), then ETH wall HP
- All 4 damage paths consistent: chip, catapult, raid-catapult, raid-blocked
- 1-at-a-time ETH wall enforcement — server rejects if `ethWallHP > 0`
- Gold wall scaling: 100M to 1B, server-authoritative cost calculation

### Financial Integrity
- All microBG: integer arithmetic only (BG x 10000), no float drift
- BigInt for all on-chain Wei in viem calls
- Replay protection on all smelt claims (on-chain `usedClaimIds` mapping)
- Ledger append-only (`rpush`) — permanent audit trail
- Atomic Redis operations for all state mutations

### CORS & Headers
- Named origin + Vercel prefix allowlist (no wildcards)
- `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection` on all responses
- `Cache-Control: no-store` on all API responses (public endpoints override explicitly)

---

## Required Vercel Environment Variables

| Variable | Required | Effect if missing |
|----------|----------|-------------------|
| `BG_ADMIN_KEY` | ✅ Critical | ALL admin endpoints disabled |
| `UPSTASH_REDIS_REST_URL` | ✅ Critical | All state APIs fail |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ Critical | All state APIs fail |
| `NEXT_PUBLIC_TREASURY_CONTRACT` | ✅ Critical | mBG purchase disabled |
| `OPERATOR_PRIVATE_KEY` | ✅ Critical | Smelt payouts disabled |
| `ABLY_API_KEY` | ⚠️ PvP only | PvP real-time disabled |

---

## Deployed Contracts

| Contract | Address | Network |
|----------|---------|---------|
| BaseGoldTreasury V2 | `0xF8FD3d47D83b7C4C9e01566fD42D76c13F2Bc27C` | Base Mainnet ✅ |
| BG Token | `0x36b712A629095234F2196BbB000D1b96C12Ce78e` | Base Mainnet ✅ |
| Mine NFT | `0x4F8f97e10E2D89Bc118d6fdfe74d1C96A821E4e3` | Base Mainnet ✅ |
| MineSwapV4Hook | `0xee84D17C32107EC75CeF72938074b71587478ac4` | Base Mainnet ✅ |
| MineSwapAggregatorV4 | `0xeA55dC06AFd17F2105B175Be659d6CA4942D9D80` | Base Mainnet ✅ |

---

## Files Changed in V5

| File | Change |
|------|--------|
| `components/MiniBoss.tsx` | HP rebalance (8-25), random 4-corner spawn, victory popup |
| `components/WarPanel.tsx` | `ethWallHP` prop, 1-at-a-time UI, gold wall loading/error/success, txFailed per-section, success flash |
| `components/WarSceneCanvas.tsx` | `ethWallHP` prop, canvas wall rendering fix |
| `components/MinerGame.tsx` | `ethWallHP` state, passes to WarPanel + WarSceneCanvas |
| `components/GameTutorial.tsx` | Updated hint text (max 15 HP) |
| `lib/config.ts` | `getGoldWallCost()` scaling function, `MAX_WALL_HP` 35 to 15 |
| `app/api/war-log/route.ts` | `ethWallHP` field + migration, 1-at-a-time enforcement, all 4 damage paths fixed, hardcoded 35 to `MAX_WALL_HP` |
| `app/page.tsx` | Dashboard Season 3 fix, market data section, on-chain links, leaderboard rebuild |
| `SECURITY_AUDIT.md` | Updated to V5 |

---

*AI-assisted audit. Supplement with professional review (Jay Anon / SSSLLC) before handling significant value.*
