// ============ SEASON 3 CONFIGURATION ============
// "The Great Excavation" - St. Patrick's Day Launch (March 17, 2026)
// TESTING ENVIRONMENT - Update timestamps before going live

// Current active season
export const CURRENT_SEASON = 's3';

// Season 3 start: March 24, 2026 00:00 UTC (Launch Day)
export const SEASON_START_TIMESTAMP = 1774310400000;

// Redis key prefixes
export const GAME_KEY_PREFIX = `game:${CURRENT_SEASON}:`;
export const LEADERBOARD_KEY = `leaderboard:points:${CURRENT_SEASON}`;

// Contract addresses (Base Mainnet)
export const BG_TOKEN_ADDRESS = '0x36b712A629095234F2196BbB000D1b96C12Ce78e';
export const GOLD_VEIN_ADDRESS = '0x5E4842ac8D7b37922366cb1b78259b9324915dBC';
export const INSTANT_BURN_ADDRESS = '0xF9dc5A103C5B09bfe71cF1Badcce362827b34BFE';
export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';

// Token settings
export const INITIAL_SUPPLY = 10000;
export const ENTRY_FEE = 0.1;
export const GRANDFATHER_THRESHOLD = 0.1;

// Gold Vein referral settings
export const ROOT_REFERRER = '0x4C854b3dc7ccCaDE2EbBceEd771f4dEEeCb60d39';

// Leaderboard settings
export const MIN_BURNS_FOR_LEADERBOARD = 1;
export const MAX_LEADERBOARD_SIZE = 100;
export const DEFAULT_QUERY_LIMIT = 50;
export const MAX_QUERY_LIMIT = 5000;

// Session settings
export const SESSION_TIMEOUT = 60000;
export const SESSION_EXPIRY = 60 * 60 * 24;

// Game settings
export const MAX_OFFLINE_HOURS = 8;
export const MIN_SAVE_INTERVAL = 5000;
export const MAX_GOLD_INCREASE_PER_SECOND = 100000;

// Anti-cheat (adjusted for rebalanced economy)
export const MAX_GOLD_PER_SECOND_THEORETICAL = 1000000;
export const MAX_GOLD_PER_CLICK_THEORETICAL = 50000;
export const MAX_CLICKS_PER_SECOND = 20;

// ============ TEST MODE ============
// Set to true for accelerated expedition timers during development
export const TEST_MODE = false;

// ============ EXPEDITION SETTINGS ============
export const EXPEDITION_DURATIONS_LIVE = {
  shallow: 24 * 60 * 60 * 1000,        // 1 day
  deep: 3 * 24 * 60 * 60 * 1000,       // 3 days
  legendary: 7 * 24 * 60 * 60 * 1000,  // 7 days
} as const;

export const EXPEDITION_DURATIONS_TEST = {
  shallow: 2 * 60 * 1000,    // 2 minutes
  deep: 5 * 60 * 1000,       // 5 minutes
  legendary: 10 * 60 * 1000, // 10 minutes
} as const;

export const EXPEDITION_DURATIONS = TEST_MODE ? EXPEDITION_DURATIONS_TEST : EXPEDITION_DURATIONS_LIVE;

export const MAX_ACTIVE_EXPEDITIONS = 1;

// ============ DAILY CHALLENGE SETTINGS ============
export const DAILY_CHALLENGES_COUNT = 3;
export const DAILY_RESET_HOUR_UTC = 0;

// ============ GOLD RUSH EVENT SETTINGS ============
export const GOLD_RUSH_INTERVAL_MIN = 5 * 60 * 1000;  // Min 5 min between rushes
export const GOLD_RUSH_INTERVAL_MAX = 10 * 60 * 1000; // Max 10 min between rushes
export const GOLD_RUSH_DURATION = 30 * 1000;           // 30 second rush
export const GOLD_RUSH_MULTIPLIER = 2;

// ============ WAR SYSTEM SETTINGS ============
// Treasury receives ETH for walls/catapults → buys BG → burns
export const WAR_TREASURY_ADDRESS = '0xF9dc5A103C5B09bfe71cF1Badcce362827b34BFE'; // InstantBurn
export const WALL_PRICE_ETH = '0.0013';    // ~$2.50 per ETH wall (5 HP each) — unique price, scannable
export const CATAPULT_PRICE_ETH = '0.0009'; // ~$1.70 per catapult — unique price, scannable
export const MAX_ETH_WALLS = 5;            // Lifetime counter reference (1-at-a-time, rebuy when destroyed)
export const ETH_WALL_HP = 5;              // Each ETH wall = 5 HP
export const MAX_GOLD_WALLS = 10;          // Max 10 buildable = 10 HP
export const GOLD_WALL_HP = 1;             // Each gold wall = 1 HP
// Scaling gold wall cost: wall 1 = 100M, wall 2 = 200M, ... wall 10 = 1B
// Pass the NEXT wall number (goldWallsBuilt + 1) to get cost for the next purchase
export function getGoldWallCost(wallNumber: number): number {
  return Math.min(wallNumber, 10) * 100_000_000;
}
export const GOLD_WALL_COST = 100_000_000; // Base cost (wall 1) — kept for backward compat
export const GOLD_WALL_MIN_LEVEL = 3;     // Unlock at level 3 (was 20)
export const MAX_WALL_HP = 15;             // Total max: 5 ETH (1 wall) + 10 gold
export const CATAPULT_DAMAGE = 5;          // Each catapult removes 5 HP
