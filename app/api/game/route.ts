import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, fallback, parseAbiItem, formatEther } from 'viem';
import { base } from 'viem/chains';
import { checkGeneralLimit, checkWriteLimit, checkRateLimit, getClientIP } from '@/lib/ratelimit';
import crypto from 'crypto';

// CRITICAL: Force dynamic rendering - prevents Next.js from caching API responses
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_KV_REST_API_URL || process.env.KV_REST_API_URL!,
  token: process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN!,
});

// ============ SEASON CONFIG ============
const CURRENT_SEASON = 's3';
const GAME_KEY_PREFIX = `game:${CURRENT_SEASON}:nft:`; // game:s3:nft:1 (by tokenId)
const LEGACY_KEY_PREFIX = `game:${CURRENT_SEASON}:`; // game:s3:0x123... (by address)

const MAX_OFFLINE_HOURS = 8;
const MAX_OFFLINE_GOLD = 10_000_000_000; // 10B hard cap per offline session — defense-in-depth
const MIN_SAVE_INTERVAL = 25000;

// ============ NFT CONTRACT ============
const GOLD_MINE_NFT_ADDRESS = '0x4F8f97e10E2D89Bc118d6fdfe74d1C96A821E4e3' as `0x${string}`;
const INSTANT_BURN = '0xF9dc5A103C5B09bfe71cF1Badcce362827b34BFE' as `0x${string}`;

const NFT_ABI = [
  { name: 'ownerOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'tokenOfOwnerByIndex', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'index', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const;

// Build Alchemy URL from env vars if available
const serverAlchemyUrl = process.env.ALCHEMY_RPC_URL
  || (process.env.NEXT_PUBLIC_ALCHEMY_KEY
    ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_KEY}` : null)
  || (process.env.NEXT_PUBLIC_ALCHEMY_ID
    ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_ID}` : null);

const publicClient = createPublicClient({
  chain: base,
  transport: fallback([
    // Alchemy first — for readContract, getCode, getBlockNumber, etc.
    ...(serverAlchemyUrl ? [http(serverAlchemyUrl, { timeout: 15000 })] : []),
    // Free RPCs as fallback
    http('https://base.llamarpc.com', { timeout: 10000 }),
    http('https://base-mainnet.public.blastapi.io', { timeout: 10000 }),
    http('https://1rpc.io/base', { timeout: 10000 }),
    http('https://base.drpc.org', { timeout: 10000 }),
  ], { rank: false }),
});

// Separate client for getLogs — NEVER uses Alchemy.
// Alchemy Free tier limits eth_getLogs to 10-block range,
// making it useless for historical queries. Free RPCs support 10K+ blocks.
const logsClient = createPublicClient({
  chain: base,
  transport: fallback([
    http('https://base.llamarpc.com', { timeout: 15000 }),
    http('https://base-mainnet.public.blastapi.io', { timeout: 15000 }),
    http('https://base.drpc.org', { timeout: 15000 }),
    http('https://1rpc.io/base', { timeout: 15000 }),
    http('https://mainnet.base.org', { timeout: 15000 }),
  ], { rank: false }),
});

// ============ ANTI-CHEAT CONSTANTS ============
// S3: Hard cap ALL manual clicks to 5/sec — no tier exceptions.
// Golden Goat / Crown bonuses apply to COMBO MULTIPLIER and GPS, NOT click speed.
// This prevents autoclicker abuse that dominated the S2 leaderboard.
const HARD_CPS_LIMIT = 5; // Universal manual click cap — no exceptions
const BASE_MAX_COMBO = 10;
const GOLD_VEIN_MAX_COMBO = 15;
const GOLDEN_GOAT_MAX_COMBO = 35; // Phoenix Flame allows 35x combo (reward = bigger hits, not faster clicks)
const MAX_GOLD_PER_CLICK = 5000000; // V5 nerf: GPS halved + crit 10x→2x. New max ≈ 2.3M → 5M headroom
const MAX_GOLD_PER_SECOND = 100000000; // V5 nerf: GPS halved. New max ≈ 83M → 100M headroom

// ═══════════════════════════════════════════════════════════
//  V5 ANTI-EXPLOIT: Server-side integrity verification
//  Prevents Burp Suite / proxy modification of save payloads
// ═══════════════════════════════════════════════════════════

// [LAYER 1] Server-side upgrade caps — mirror of INITIAL_UPGRADES.maxOwned
const UPGRADE_CAPS: Record<string, { maxOwned: number; perSec: number }> = {
  pickaxe:      { maxOwned: 50, perSec: 0 },
  miner:        { maxOwned: 40, perSec: 1 },
  drill:        { maxOwned: 30, perSec: 1 },
  excavator:    { maxOwned: 25, perSec: 4 },
  dynamite:     { maxOwned: 20, perSec: 10 },
  goldmine:     { maxOwned: 15, perSec: 30 },
  luckyStrike:  { maxOwned: 30, perSec: 0 },
  goldBoost:    { maxOwned: 15, perSec: 0 },
  geologist:    { maxOwned: 20, perSec: 0 },
  deepShaft:    { maxOwned: 15, perSec: 20 },
  refinery:     { maxOwned: 10, perSec: 0 },
  tunnelBorer:  { maxOwned: 10, perSec: 75 },
  motherLode:   { maxOwned: 8,  perSec: 150 },
  quantumDrill: { maxOwned: 5,  perSec: 400 },
  voidExtractor:{ maxOwned: 3,  perSec: 1500 },
  cosmicForge:  { maxOwned: 2,  perSec: 5000 },
};

// [LAYER 1] Compute raw GPS from upgrade counts — never trust client goldPerSecond
function computeServerGPS(upgrades: any): number {
  if (!upgrades || typeof upgrades !== 'object') return 0;
  let rawGPS = 0;
  for (const [key, upgrade] of Object.entries(upgrades)) {
    const u = upgrade as any;
    const cap = UPGRADE_CAPS[key];
    if (!cap) continue;
    rawGPS += Math.min(u?.owned || 0, cap.maxOwned) * cap.perSec;
  }
  return rawGPS;
}

// [LAYER 1] Clamp upgrade owned counts to maxOwned
function sanitizeUpgrades(upgrades: any, tokenId: number): void {
  if (!upgrades || typeof upgrades !== 'object') return;
  for (const [key, upgrade] of Object.entries(upgrades)) {
    const u = upgrade as any;
    const cap = UPGRADE_CAPS[key];
    if (!cap) continue;
    if (u?.owned > cap.maxOwned) {
      console.warn(`[ANTI-CHEAT] NFT #${tokenId}: ${key} owned ${u.owned} → clamped to ${cap.maxOwned}`);
      u.owned = cap.maxOwned;
    }
  }
}

// [LAYER 2] HMAC integrity tag — cryptographic tamper detection
// Server signs critical fields on every save. On the next save, if the
// stored state was modified externally (Burp Suite, devtools, Redis edit),
// the HMAC won't match → reject the save.
const HMAC_SECRET = process.env.BG_ADMIN_KEY || process.env.UPSTASH_REDIS_REST_TOKEN || '';

function generateSaveHMAC(tokenId: number, gold: number, totalClicks: number, totalGoldEarned: number): string {
  if (!HMAC_SECRET) return '';
  const payload = `${tokenId}:${Math.floor(gold)}:${Math.floor(totalClicks)}:${Math.floor(totalGoldEarned)}`;
  return crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex').slice(0, 16);
}

function verifySaveHMAC(previousSave: any, tokenId: number): boolean {
  if (!HMAC_SECRET || !previousSave?._hmac) return true; // Pre-HMAC saves — skip check
  const expected = generateSaveHMAC(
    tokenId,
    previousSave.gold || 0,
    previousSave.totalClicks || 0,
    previousSave.totalGoldEarned || 0,
  );
  return previousSave._hmac === expected;
}

interface GameState {
  gold: number;
  totalClicks: number;
  totalGoldEarned: number;
  upgrades: any;
  appliedInstantGold: string[];
  lastSaved: number;
  goldPerSecond: number;
  sessionDuration?: number;
  maxCombo?: number;
  autoClickRate?: number;
  tokenId?: number;
  _hmac?: string;
  s3?: {
    raidState?: {
      barracks?: Record<string, boolean>;
      totalRecruited?: number;
      [key: string]: any;
    };
    warChest?: Record<string, any>;
    [key: string]: any;
  };
  originalOwner?: string;
}

// ============ OWNERSHIP CACHE ============
// Cache ownership checks for 5 minutes to reduce RPC calls
const ownershipCache = new Map<string, { owner: string; timestamp: number }>();
const OWNERSHIP_CACHE_TTL = 300000; // 5 minutes (longer cache for reliability)
const OWNERSHIP_STALE_TTL = 3600000; // 1 hour (use stale cache if RPC fails)

// ============ HELPER: Verify NFT Ownership (with caching) ============
async function verifyNFTOwnership(address: string, tokenId: number): Promise<boolean> {
  const cacheKey = `${tokenId}`;
  const cached = ownershipCache.get(cacheKey);
  
  // Return cached result if fresh
  if (cached && Date.now() - cached.timestamp < OWNERSHIP_CACHE_TTL) {
    return cached.owner.toLowerCase() === address.toLowerCase();
  }
  
  // Try up to 5 times with increasing delays
  const delays = [100, 300, 500, 1000, 2000];
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const owner = await publicClient.readContract({
        address: GOLD_MINE_NFT_ADDRESS,
        abi: NFT_ABI,
        functionName: 'ownerOf',
        args: [BigInt(tokenId)],
      });
      
      // Cache the result
      ownershipCache.set(cacheKey, { 
        owner: (owner as string).toLowerCase(), 
        timestamp: Date.now() 
      });
      
      return (owner as string).toLowerCase() === address.toLowerCase();
    } catch (error: any) {
      console.warn(`[verifyNFTOwnership] Attempt ${attempt + 1}/5 failed:`, error?.message || error);
      if (attempt < 4) {
        await new Promise(r => setTimeout(r, delays[attempt])); // Wait before retry
      }
    }
  }
  
  // If all RPC calls fail but we have stale cache (within 1 hour), use it
  if (cached && Date.now() - cached.timestamp < OWNERSHIP_STALE_TTL) {
    console.warn(`[verifyNFTOwnership] Using stale cache for token ${tokenId}`);
    return cached.owner.toLowerCase() === address.toLowerCase();
  }
  
  console.error('[verifyNFTOwnership] All attempts failed, no cache available');
  return false;
}

// ============ HELPER: Get User's NFTs ============
// Robust version that works with both Enumerable and non-Enumerable NFTs
async function getUserNFTs(address: string): Promise<number[]> {
  const tokenIds: number[] = [];
  const normalizedAddress = address.toLowerCase();
  
  console.log(`[getUserNFTs] Starting for address: ${normalizedAddress}`);
  
  // Method 1: Try tokenOfOwnerByIndex (ERC721Enumerable)
  try {
    const balance = await publicClient.readContract({
      address: GOLD_MINE_NFT_ADDRESS,
      abi: NFT_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });
    
    const numBalance = Number(balance);
    console.log(`[getUserNFTs] Balance: ${numBalance}`);
    
    if (numBalance === 0) {
      console.log(`[getUserNFTs] User has 0 balance, trying ownerOf scan anyway...`);
      // Don't return early - try ownerOf scan in case balanceOf is wrong
    }
    
    // Try Enumerable approach first (only if balance > 0)
    if (numBalance > 0) {
      let enumerableWorks = true;
      for (let i = 0; i < numBalance; i++) {
        try {
          const tokenId = await publicClient.readContract({
            address: GOLD_MINE_NFT_ADDRESS,
            abi: NFT_ABI,
            functionName: 'tokenOfOwnerByIndex',
            args: [address as `0x${string}`, BigInt(i)],
          });
          tokenIds.push(Number(tokenId));
        } catch (indexError: any) {
          console.warn(`[getUserNFTs] tokenOfOwnerByIndex failed:`, indexError?.message || indexError);
          enumerableWorks = false;
          break;
        }
      }
      
      if (enumerableWorks && tokenIds.length === numBalance) {
        console.log(`[getUserNFTs] Enumerable method succeeded:`, tokenIds);
        return tokenIds;
      }
    }
    
    // Method 2: Fallback - scan known token range using ownerOf
    console.log(`[getUserNFTs] Falling back to ownerOf scan...`);
    tokenIds.length = 0; // Reset
    
    // Scan tokens 1-50 first (faster), then 51-100 if needed
    const MAX_TOKEN_ID = 50; // Reduced for faster response
    
    for (let tokenId = 1; tokenId <= MAX_TOKEN_ID; tokenId++) {
      try {
        const owner = await publicClient.readContract({
          address: GOLD_MINE_NFT_ADDRESS,
          abi: NFT_ABI,
          functionName: 'ownerOf',
          args: [BigInt(tokenId)],
        });
        const ownerLower = (owner as string).toLowerCase();
        if (ownerLower === normalizedAddress) {
          console.log(`[getUserNFTs] Found token ${tokenId} owned by ${normalizedAddress}`);
          tokenIds.push(tokenId);
        }
      } catch {
        // Token doesn't exist or error, skip silently
      }
    }
    
    console.log(`[getUserNFTs] ownerOf scan found:`, tokenIds);
    return tokenIds;
    
  } catch (error: any) {
    console.error('[getUserNFTs] Main error:', error?.message || error);
    
    // Last resort: Simple sequential ownerOf scan
    console.log(`[getUserNFTs] Last resort scan...`);
    try {
      for (let tokenId = 1; tokenId <= 50; tokenId++) {
        try {
          const owner = await publicClient.readContract({
            address: GOLD_MINE_NFT_ADDRESS,
            abi: NFT_ABI,
            functionName: 'ownerOf',
            args: [BigInt(tokenId)],
          });
          if ((owner as string).toLowerCase() === normalizedAddress) {
            tokenIds.push(tokenId);
          }
        } catch {
          // Skip
        }
      }
      console.log(`[getUserNFTs] Last resort found:`, tokenIds);
      return tokenIds;
    } catch (scanError: any) {
      console.error('[getUserNFTs] All methods failed:', scanError?.message || scanError);
      return [];
    }
  }
}

// ============ GET - Load Game State ============
export async function GET(request: NextRequest) {
  try {
    // [H-2 V4 FIX] Rate limit GET — heavy RPC calls for NFT ownership
    const rl = await checkGeneralLimit(request);
    if (!rl.ok) return NextResponse.json({ error: 'Rate limited', retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429 });

    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address')?.toLowerCase();
    const tokenIdParam = searchParams.get('tokenId');
    const listNFTs = searchParams.get('listNFTs') === 'true';

    if (!address || !/^0x[a-f0-9]{40}$/i.test(address)) {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
    }

    // If requesting list of user's NFTs with their progress
    if (listNFTs) {
      const nfts = await getUserNFTs(address);
      const nftData = await Promise.all(
        nfts.map(async (tokenId) => {
          const gameState = await redis.get<GameState>(`${GAME_KEY_PREFIX}${tokenId}`);
          return {
            tokenId,
            hasProgress: !!gameState,
            gold: gameState?.gold || 0,
            totalClicks: gameState?.totalClicks || 0,
          };
        })
      );
      return NextResponse.json({ nfts: nftData });
    }

    // If specific tokenId provided, load that NFT's game state
    if (tokenIdParam) {
      const tokenId = parseInt(tokenIdParam);
      if (isNaN(tokenId) || tokenId < 1) {
        return NextResponse.json({ error: 'Invalid tokenId' }, { status: 400 });
      }

      // Verify ownership
      const isOwner = await verifyNFTOwnership(address, tokenId);
      if (!isOwner) {
        return NextResponse.json({ error: 'You do not own this Mine NFT', notOwner: true }, { status: 403 });
      }

      const gameState = await redis.get<GameState>(`${GAME_KEY_PREFIX}${tokenId}`);
      
      // Load saved purchases from Redis — fallback for when free RPC getLogs fails
      const savedPurchases = await redis.get<any[]>(`purchases:nft:${tokenId}`) || [];

      if (!gameState) {
        // Check for legacy wallet-based data to AUTO-MIGRATE
        const legacyState = await redis.get<GameState>(`${LEGACY_KEY_PREFIX}${address}`);
        // SECURITY: Check both tokenId AND migratedToNFT to prevent duplicate migrations
        if (legacyState && !legacyState.tokenId && !(legacyState as any).migratedToNFT && legacyState.gold > 0) {
          // AUTO-MIGRATE: Move legacy data to NFT-based storage
          console.log(`Auto-migrating legacy data for ${address} to NFT #${tokenId}`);
          const migratedState = {
            ...legacyState,
            tokenId: tokenId,
            originalOwner: address,
            lastSaved: Date.now(),
          };
          await redis.set(`${GAME_KEY_PREFIX}${tokenId}`, migratedState);
          // Mark legacy as migrated (prevents duplicate migration attacks)
          await redis.set(`${LEGACY_KEY_PREFIX}${address}`, {
            ...legacyState,
            migratedToNFT: tokenId,
          });
          
          // Calculate offline gold for migrated data
          const now = Date.now();
          const timeSinceLastSave = now - legacyState.lastSaved;
          const maxOfflineTime = MAX_OFFLINE_HOURS * 60 * 60 * 1000;
          const offlineTime = Math.min(timeSinceLastSave, maxOfflineTime);
          
          // SECURITY: Cap goldPerSecond
          const MAX_GOLD_PER_SECOND_CAP = 750000;
          const cappedGoldPerSecond = Math.min(legacyState.goldPerSecond || 0, MAX_GOLD_PER_SECOND_CAP);
          
          let offlineGold = 0;
          if (cappedGoldPerSecond > 0 && offlineTime > 60000) {
            offlineGold = Math.min(Math.floor((offlineTime / 1000) * cappedGoldPerSecond), MAX_OFFLINE_GOLD);
          }
          
          return NextResponse.json({
            gameState: migratedState,
            offlineGold,
            offlineMinutes: Math.floor(offlineTime / 60000),
            tokenId,
            savedPurchases,
            migrated: true,
            message: 'Your progress has been migrated to your Mine NFT!',
          });
        }
        
        const response = NextResponse.json({ gameState: null, message: 'No saved game found', tokenId, savedPurchases });
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        return response;
      }

      const now = Date.now();
      const timeSinceLastSave = now - gameState.lastSaved;
      const maxOfflineTime = MAX_OFFLINE_HOURS * 60 * 60 * 1000;
      const offlineTime = Math.min(timeSinceLastSave, maxOfflineTime);
      
      // SECURITY: Cap goldPerSecond for offline earnings calculation.
      // Max permanent GPS ≈ 1.1M (all upgrades + EmeraldCore + tradePickaxe + vault + globalMult).
      // Temporary boosts (MegaBoost, GoldRush) expire while offline — don't count them.
      const MAX_GOLD_PER_SECOND_CAP = 750000;
      const cappedGoldPerSecond = Math.min(gameState.goldPerSecond || 0, MAX_GOLD_PER_SECOND_CAP);
      
      let offlineGold = 0;
      // Skip offline gold for season-reset saves (prevents old GPS from inflating fresh state)
      const isSeasonReset = !!(gameState as any).seasonReset;
      if (isSeasonReset) {
        // [V4] verbose log stripped
        offlineGold = 0;
      } else if (cappedGoldPerSecond > 0 && offlineTime > 60000) {
        offlineGold = Math.min(Math.floor((offlineTime / 1000) * cappedGoldPerSecond), MAX_OFFLINE_GOLD);
        // [V4] verbose log stripped
      }

      const response = NextResponse.json({
        gameState,
        offlineGold,
        offlineMinutes: Math.floor(offlineTime / 60000),
        tokenId,
        savedPurchases,
      });
      
      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      return response;
    }

    // No tokenId provided - find user's NFTs and best progress
    const userNFTs = await getUserNFTs(address);
    
    if (userNFTs.length === 0) {
      // Check for legacy data (user played before NFTs, doesn't have one yet)
      const legacyState = await redis.get<GameState>(`${LEGACY_KEY_PREFIX}${address}`);
      if (legacyState && !legacyState.tokenId) {
        return NextResponse.json({ 
          gameState: null, 
          message: 'You need a Gold Mine NFT to play. Your old progress can be migrated once you have one!',
          noNFT: true,
          legacyDataAvailable: true,
          legacyGold: legacyState.gold,
        });
      }
      return NextResponse.json({ 
        gameState: null, 
        message: 'You need a Gold Mine NFT to play',
        noNFT: true,
      });
    }

    // Find NFT with most progress
    let bestNFT = userNFTs[0];
    let bestGold = 0;
    
    for (const tokenId of userNFTs) {
      const state = await redis.get<GameState>(`${GAME_KEY_PREFIX}${tokenId}`);
      if (state && state.gold > bestGold) {
        bestGold = state.gold;
        bestNFT = tokenId;
      }
    }

    const gameState = await redis.get<GameState>(`${GAME_KEY_PREFIX}${bestNFT}`);
    
    // Check for legacy data to migrate
    const legacyState = await redis.get<GameState>(`${LEGACY_KEY_PREFIX}${address}`);
    // SECURITY: Check migratedToNFT to prevent duplicate migrations
    const legacyDataAvailable = legacyState && !legacyState.tokenId && !(legacyState as any).migratedToNFT && (legacyState.gold || 0) > 0;
    
    if (!gameState && legacyDataAvailable) {
      // AUTO-MIGRATE: Move legacy data to best NFT
      console.log(`Auto-migrating legacy data for ${address} to NFT #${bestNFT}`);
      const migratedState = {
        ...legacyState,
        tokenId: bestNFT,
        originalOwner: address,
        lastSaved: Date.now(),
      };
      await redis.set(`${GAME_KEY_PREFIX}${bestNFT}`, migratedState);
      // Mark legacy as migrated (prevents duplicate migration attacks)
      await redis.set(`${LEGACY_KEY_PREFIX}${address}`, {
        ...legacyState,
        migratedToNFT: bestNFT,
      });
      
      // Calculate offline gold for migrated data
      const now = Date.now();
      const timeSinceLastSave = now - legacyState.lastSaved;
      const maxOfflineTime = MAX_OFFLINE_HOURS * 60 * 60 * 1000;
      const offlineTime = Math.min(timeSinceLastSave, maxOfflineTime);
      
      // SECURITY: Cap goldPerSecond
      const MAX_GOLD_PER_SECOND_CAP = 750000;
      const cappedGoldPerSecond = Math.min(legacyState.goldPerSecond || 0, MAX_GOLD_PER_SECOND_CAP);
      
      let offlineGold = 0;
      if (cappedGoldPerSecond > 0 && offlineTime > 60000) {
        offlineGold = Math.min(Math.floor((offlineTime / 1000) * cappedGoldPerSecond), MAX_OFFLINE_GOLD);
      }
      
      return NextResponse.json({
        gameState: migratedState,
        offlineGold,
        offlineMinutes: Math.floor(offlineTime / 60000),
        tokenId: bestNFT,
        userNFTs,
        migrated: true,
        message: 'Your progress has been migrated to your Mine NFT!',
      });
    }
    
    if (!gameState) {
      return NextResponse.json({ 
        gameState: null, 
        message: 'No saved game found',
        tokenId: bestNFT,
        userNFTs,
      });
    }

    const now = Date.now();
    const timeSinceLastSave = now - gameState.lastSaved;
    const maxOfflineTime = MAX_OFFLINE_HOURS * 60 * 60 * 1000;
    const offlineTime = Math.min(timeSinceLastSave, maxOfflineTime);
    
    // SECURITY: Cap goldPerSecond
    const MAX_GOLD_PER_SECOND_CAP2 = 750000;
    const cappedGoldPerSecond = Math.min(gameState.goldPerSecond || 0, MAX_GOLD_PER_SECOND_CAP2);
    
    let offlineGold = 0;
    // Skip offline gold for season-reset saves (prevents old GPS from inflating fresh state)
    const isSeasonReset3 = !!(gameState as any).seasonReset;
    if (isSeasonReset3) {
      offlineGold = 0;
    } else if (cappedGoldPerSecond > 0 && offlineTime > 60000) {
      offlineGold = Math.min(Math.floor((offlineTime / 1000) * cappedGoldPerSecond), MAX_OFFLINE_GOLD);
    }

    const response = NextResponse.json({
      gameState,
      offlineGold,
      offlineMinutes: Math.floor(offlineTime / 60000),
      tokenId: bestNFT,
      userNFTs,
      legacyDataAvailable,
      legacyGold: legacyDataAvailable ? legacyState?.gold : 0,
    });
    
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    return response;

  } catch (error) {
    console.error('Error loading game:', error);
    return NextResponse.json({ error: 'Failed to load game' }, { status: 500 });
  }
}

// ============ POST - Save Game State ============
export async function POST(request: NextRequest) {
  try {
    // [H-2 V4 FIX] Rate limit POST saves — route-specific key to avoid contention with war-log/pvp
    // [V5 FIX] Increased from 30→60/min — auto-saves (2/min) + manual saves on shop/name/actions were hitting 429s
    const rl = await checkRateLimit(`game:${getClientIP(request)}`, 60, 60);
    if (!rl.ok) return NextResponse.json({ error: 'Rate limited', retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429 });

    let body;
    const contentType = request.headers.get('content-type') || '';
    
    // Handle various content types that sendBeacon might send
    if (contentType.includes('text/plain') || contentType === '' || !contentType) {
      // sendBeacon sometimes sends with no content-type or text/plain
      const text = await request.text();
      try {
        body = JSON.parse(text);
      } catch (e) {
        console.error('[SAVE API] Failed to parse body as JSON:', text.substring(0, 100));
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
      }
    } else if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      // Fallback: try to parse as JSON anyway
      const text = await request.text();
      try {
        body = JSON.parse(text);
      } catch (e) {
        console.error('[SAVE API] Unknown content-type and failed to parse:', contentType);
        return NextResponse.json({ error: 'Invalid content type' }, { status: 400 });
      }
    }
    
    const { address, gameState, tokenId, migrateLegacy, savePurchases, purchases } = body;

    const normalizedAddress = address?.toLowerCase();
    if (!normalizedAddress || !/^0x[a-f0-9]{40}$/i.test(normalizedAddress)) {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
    }

    // ============ SAVE PURCHASES TO NFT ============
    if (savePurchases && tokenId && purchases) {
      const parsedTokenId = parseInt(tokenId);
      if (isNaN(parsedTokenId) || parsedTokenId < 1) {
        return NextResponse.json({ error: 'Invalid tokenId' }, { status: 400 });
      }
      
      const isOwner = await verifyNFTOwnership(normalizedAddress, parsedTokenId);
      if (!isOwner) {
        return NextResponse.json({ error: 'Not owner', notOwner: true }, { status: 403 });
      }
      
      // SECURITY: Verify purchases on-chain before saving
      // Uses logsClient (free RPCs) — Alchemy free tier limits getLogs to 10 blocks
      // InstantBurn deployed at block ~40,488,338 — hardcoded, never changes
      let verifiedPurchases: any[] = [];
      try {
        const currentBlock = await publicClient.getBlockNumber();
        const DEPLOY_BLOCK = 40_000_000n;
        const allLogs: any[] = [];
        const CHUNK = 1_000_000n;
        for (let from = DEPLOY_BLOCK; from <= currentBlock; from += CHUNK) {
          const to = (from + CHUNK - 1n) > currentBlock ? currentBlock : (from + CHUNK - 1n);
          try {
            const logs = await logsClient.getLogs({
              address: INSTANT_BURN,
              event: parseAbiItem('event InstantBurn(address indexed buyer, uint256 ethAmount, uint256 bgBurned, uint256 timestamp, uint256 totalBurnedLifetime)'),
              args: { buyer: normalizedAddress as `0x${string}` },
              fromBlock: from,
              toBlock: to,
            });
            allLogs.push(...logs);
          } catch {
            // Skip failed chunks — purchases still load from /api/purchases
          }
        }
        
        // Build verified purchase list from on-chain data
        allLogs.forEach((log: any) => {
          const ethAmount = formatEther(log.args.ethAmount || BigInt(0));
          const timestamp = Number(log.args.timestamp || 0) * 1000;
          const txHash = log.transactionHash;
          
          // Match to shop items by ETH amount
          const matchedItem = purchases.find((p: any) => 
            p.txHash?.toLowerCase() === txHash?.toLowerCase()
          );
          
          if (matchedItem) {
            verifiedPurchases.push({
              itemId: matchedItem.itemId,
              itemName: matchedItem.itemName,
              ethSpent: ethAmount,
              timestamp,
              txHash,
              verifiedOnChain: true,
            });
          }
        });
      } catch (e) {
        console.error('Error verifying purchases on-chain:', e);
        return NextResponse.json({ error: 'Could not verify purchases' }, { status: 500 });
      }
      
      if (verifiedPurchases.length === 0) {
        return NextResponse.json({ success: true, purchasesSaved: 0, message: 'No verifiable purchases' });
      }
      
      // SECURITY: Check if purchases are already assigned to another NFT
      const assignedKey = `purchase:assigned:${normalizedAddress}`;
      const alreadyAssigned = await redis.get<Record<string, number>>(assignedKey) || {};
      
      // Get existing purchases for this NFT
      const purchaseKey = `purchases:nft:${parsedTokenId}`;
      const existingPurchases = await redis.get<any[]>(purchaseKey) || [];
      const existingHashes = new Set(existingPurchases.map(p => p.txHash?.toLowerCase()));
      
      // Filter out already-assigned purchases and duplicates
      const newPurchases = verifiedPurchases.filter((p: any) => {
        const hash = p.txHash?.toLowerCase();
        // Skip if already on this NFT
        if (existingHashes.has(hash)) return false;
        // Skip if assigned to a different NFT
        if (alreadyAssigned[hash] && alreadyAssigned[hash] !== parsedTokenId) {
          console.log(`[savePurchases] Purchase ${hash} already assigned to NFT #${alreadyAssigned[hash]}`);
          return false;
        }
        return true;
      });
      
      if (newPurchases.length > 0) {
        // Save purchases to NFT
        const allPurchases = [...existingPurchases, ...newPurchases];
        await redis.set(purchaseKey, allPurchases);
        
        // Mark purchases as assigned to this NFT
        newPurchases.forEach((p: any) => {
          alreadyAssigned[p.txHash.toLowerCase()] = parsedTokenId;
        });
        await redis.set(assignedKey, alreadyAssigned);
        
        console.log(`[savePurchases] Saved ${newPurchases.length} verified purchases to NFT #${parsedTokenId}`);
      }
      
      return NextResponse.json({ success: true, purchasesSaved: newPurchases.length, verified: true });
    }

    // Handle legacy data migration
    if (migrateLegacy && tokenId) {
      const parsedTokenId = parseInt(tokenId);
      const isOwner = await verifyNFTOwnership(normalizedAddress, parsedTokenId);
      if (!isOwner) {
        return NextResponse.json({ error: 'You do not own this Mine NFT' }, { status: 403 });
      }

      const legacyState = await redis.get<GameState>(`${LEGACY_KEY_PREFIX}${normalizedAddress}`);
      // SECURITY: Check migratedToNFT to prevent duplicate migrations
      if (legacyState && !legacyState.tokenId && !(legacyState as any).migratedToNFT) {
        // Migrate to NFT-based storage
        await redis.set(`${GAME_KEY_PREFIX}${parsedTokenId}`, {
          ...legacyState,
          tokenId: parsedTokenId,
          originalOwner: normalizedAddress,
          lastSaved: Date.now(),
        });
        // Mark legacy as migrated (prevents duplicate migration attacks)
        await redis.set(`${LEGACY_KEY_PREFIX}${normalizedAddress}`, {
          ...legacyState,
          migratedToNFT: parsedTokenId,
        });
        return NextResponse.json({ success: true, migrated: true, tokenId: parsedTokenId });
      }
      return NextResponse.json({ error: 'No legacy data to migrate or already migrated' }, { status: 400 });
    }

    // Require tokenId for saving
    if (!tokenId) {
      return NextResponse.json({ error: 'tokenId required' }, { status: 400 });
    }

    const parsedTokenId = parseInt(tokenId);
    if (isNaN(parsedTokenId) || parsedTokenId < 1) {
      return NextResponse.json({ error: 'Invalid tokenId' }, { status: 400 });
    }

    // Verify ownership
    const isOwner = await verifyNFTOwnership(normalizedAddress, parsedTokenId);
    if (!isOwner) {
      return NextResponse.json({ error: 'You do not own this Mine NFT', notOwner: true }, { status: 403 });
    }

    // ============ ANTI-TAMPERING VALIDATION ============
    const previousSave = await redis.get<GameState>(`${GAME_KEY_PREFIX}${parsedTokenId}`);
    const now = Date.now();
    
    const claimedMaxCombo = gameState.maxCombo || BASE_MAX_COMBO;
    const validMaxCombo = [BASE_MAX_COMBO, GOLD_VEIN_MAX_COMBO, GOLDEN_GOAT_MAX_COMBO].includes(claimedMaxCombo) 
      ? claimedMaxCombo 
      : BASE_MAX_COMBO;
    
    // [S3 LAUNCH] Universal 5 CPS hard cap — Golden Goat / Crown get combo + GPS bonuses, NOT faster clicks
    const manualCpsLimit = HARD_CPS_LIMIT;
    
    const claimedAutoClickRate = gameState.autoClickRate || 0;
    // [S3 FIX] Cap to 2 — the ONLY in-game auto-click source is Golden Goat (autoClick: 2).
    // Previously capped at 20 which let Burp Suite users inflate their allowed CPS to 25.
    const validAutoClickRate = Math.min(claimedAutoClickRate, 2);
    const maxClicksPerSecond = manualCpsLimit + validAutoClickRate;
    
    // ═══ [V5] LAYER 1: Sanitize upgrade counts — clamp to maxOwned ═══
    sanitizeUpgrades(gameState.upgrades, parsedTokenId);
    
    // ═══ [V7] Compute server GPS early — needed for expedition validation inside previousSave block ═══
    const serverRawGPS = computeServerGPS(gameState.upgrades);
    const MAX_PERMANENT_MULTIPLIER = 30; // generous headroom over theoretical 28x
    
    // ═══ [V5] LAYER 2: HMAC tamper detection ═══
    // If the previous save has an HMAC tag, verify it matches.
    // A mismatch means the state was modified externally (Burp Suite, devtools, Redis edit).
    if (previousSave && !verifySaveHMAC(previousSave, parsedTokenId)) {
      console.error(`[ANTI-CHEAT] HMAC TAMPER DETECTED for NFT #${parsedTokenId}! Previous save was modified externally.`);
      // Don't reject — just force gold to match the server's last known good state.
      // This prevents exploiters from inflating gold while preserving legitimate progress
      // from players who had pre-HMAC saves that naturally don't match.
      gameState.gold = previousSave.gold || 0;
      gameState.totalGoldEarned = previousSave.totalGoldEarned || 0;
      gameState.totalClicks = previousSave.totalClicks || 0;
    }
    
    if (previousSave) {
      const timeSinceLastSave = now - previousSave.lastSaved;
      const secondsElapsed = Math.max(timeSinceLastSave / 1000, 1);
      
      const previousGold = previousSave.gold || 0;
      const newGold = gameState.gold || 0;
      const previousUpgradeCount = Object.values(previousSave.upgrades || {}).reduce((sum: number, u: any) => sum + (u?.owned || 0), 0);
      const newUpgradeCount = Object.values(gameState.upgrades || {}).reduce((sum: number, u: any) => sum + (u?.owned || 0), 0);

      // Also count war-related "purchases" so barracks/troop spending doesn't trigger false gold preservation
      const previousBarracksCount = Object.values(previousSave.s3?.raidState?.barracks || {}).filter(Boolean).length;
      const newBarracksCount = Object.values(gameState.s3?.raidState?.barracks || {}).filter(Boolean).length;
      const previousTotalRecruited = previousSave.s3?.raidState?.totalRecruited || 0;
      const newTotalRecruited = gameState.s3?.raidState?.totalRecruited || 0;
      const warSpendIncreased = newBarracksCount > previousBarracksCount || newTotalRecruited > previousTotalRecruited;
      
      // RATE LIMIT: Prevent rapid-fire saves
      if (timeSinceLastSave < MIN_SAVE_INTERVAL) {
        // Allow through if gold increased OR if upgrades/war-spending increased (purchase happened)
        if (newGold <= previousGold && newUpgradeCount <= previousUpgradeCount && !warSpendIncreased) {
          return NextResponse.json({ error: 'Saving too fast', rateLimited: true }, { status: 429 });
        }
      }
      
      if (previousGold > 10000 && newGold === 0 && newUpgradeCount <= previousUpgradeCount && !warSpendIncreased) {
        console.error(`BLOCKED DATA WIPE for NFT #${parsedTokenId}: gold=0 with no new upgrades`);
        return NextResponse.json({ error: 'Cannot save zero gold over existing progress', blocked: true }, { status: 400 });
      }
      
      // Only preserve gold on suspicious decreases when NO new upgrades OR war spending occurred
      // War spending (barracks, troop training) legitimately causes large gold drops
      if (previousGold > 100000 && newGold < previousGold * 0.5 && newUpgradeCount <= previousUpgradeCount && !warSpendIncreased) {
        console.warn(`PRESERVING PROGRESS for NFT #${parsedTokenId}: attempted decrease from ${previousGold} to ${newGold} (no new upgrades or war spend)`);
        // Keep the higher gold value but allow upgrade/click updates
        gameState.gold = previousGold;
      }
      
      const clickIncrease = (gameState.totalClicks || 0) - (previousSave.totalClicks || 0);
      const clicksPerSecond = clickIncrease / secondsElapsed;
      
      if (clickIncrease > 0 && clicksPerSecond > maxClicksPerSecond) {
        console.warn(`Click rate exceeded for NFT #${parsedTokenId}: ${clicksPerSecond.toFixed(1)}/sec (max: ${maxClicksPerSecond})`);
        gameState.totalClicks = previousSave.totalClicks + Math.floor(maxClicksPerSecond * secondsElapsed);
      }
      
      const goldIncrease = (gameState.gold || 0) - (previousSave.gold || 0);
      
      if (goldIncrease > 0) {
        const actualClickIncrease = (gameState.totalClicks || 0) - (previousSave.totalClicks || 0);
        const maxClickGold = actualClickIncrease * MAX_GOLD_PER_CLICK;
        const maxPassiveGold = secondsElapsed * MAX_GOLD_PER_SECOND;
        const maxPossibleGold = maxClickGold + maxPassiveGold;

        // ── Achievement/challenge gold is legitimate — compute how much was newly claimed ──
        // We compare incoming claimed achievements against the previous save's claimed set.
        // Only NEWLY claimed rewards (not already claimed in previousSave) are exempt.
        const prevAchievements: Record<string, any> = previousSave.s3?.achievements || {};
        const newAchievements: Record<string, any> = gameState.s3?.achievements || {};
        
        // ═══ [V7] SERVER-SIDE ACHIEVEMENT REWARD VERIFICATION ═══
        // Known achievement rewards — imported constants, never trust client amounts
        const ACHIEVEMENT_REWARDS: Record<string, number> = {
          first_click: 100, click_100: 500, click_1000: 5000, click_10000: 50000, click_100000: 500000,
          gold_1k: 200, gold_100k: 10000, gold_1m: 100000, gold_100m: 5000000, gold_1b: 50000000,
          combo_5: 1000, combo_10: 10000, combo_15: 50000, combo_25: 250000,
          burn_1: 5000, burn_5: 25000, burn_10: 100000,
          expedition_1: 10000, expedition_5: 50000, expedition_10: 200000, expedition_legendary: 500000,
          upgrade_5: 2000, upgrade_25: 25000, upgrade_100: 250000,
          streak_3: 5000, streak_7: 25000, streak_30: 500000,
        };
        let newlyClaimedRewardGold = 0;
        let newlyClaimedCount = 0;
        // Sum rewards for achievement IDs that are claimed now but were NOT claimed before
        for (const [id, state] of Object.entries(newAchievements)) {
          if (state?.claimed && !prevAchievements[id]?.claimed) {
            // [V7] Use SERVER-SIDE known reward, not client value
            const knownReward = ACHIEVEMENT_REWARDS[id] || 0;
            if (knownReward === 0) {
              console.warn(`[V7 ANTI-CHEAT] NFT #${parsedTokenId}: Unknown achievement '${id}' claimed — ignoring`);
            }
            newlyClaimedRewardGold += knownReward;
            newlyClaimedCount++;
          }
        }

        // ═══ [V7] SERVER-SIDE DAILY CHALLENGE REWARD VERIFICATION ═══
        // Max possible daily challenge reward across the entire pool
        const MAX_SINGLE_CHALLENGE_REWARD = 200000; // 'daily_gold_1m' = 200,000
        const prevChallenges = previousSave.s3?.dailyChallengeState?.challenges || [];
        const newChallenges = gameState.s3?.dailyChallengeState?.challenges || [];
        let newlyChallengeGold = 0;
        for (let i = 0; i < Math.min(newChallenges.length, 3); i++) { // [V7] Max 3 challenges per day
          if (newChallenges[i]?.claimed && !prevChallenges[i]?.claimed) {
            // [V7] Cap each challenge reward to known maximum
            const claimedReward = Math.min(newChallenges[i]?.reward || 0, MAX_SINGLE_CHALLENGE_REWARD);
            newlyChallengeGold += claimedReward;
          }
        }

        // ═══ [V7] SERVER-SIDE EXPEDITION REWARD VERIFICATION ═══
        // Detect expedition claim: previousSave had activeExpedition, current doesn't
        const prevExpedition = previousSave.s3?.activeExpedition;
        const curExpedition = gameState.s3?.activeExpedition;
        let expeditionRewardGold = 0;
        if (prevExpedition && prevExpedition.status === 'active' && !curExpedition) {
          // Expedition was claimed this save — validate the reward
          // Known expedition rewards (server-side constants)
          const EXPEDITION_REWARDS: Record<string, { goldMultiplier: number; bonusGold: number }> = {
            shallow:   { goldMultiplier: 0.5, bonusGold: 10000 },
            deep:      { goldMultiplier: 1.0, bonusGold: 100000 },
            legendary: { goldMultiplier: 2.0, bonusGold: 500000 },
          };
          const expDef = EXPEDITION_REWARDS[prevExpedition.expeditionId];
          if (expDef) {
            // Validate gpsAtStart doesn't exceed server-computed max
            const serverMaxGPSForExp = serverRawGPS * MAX_PERMANENT_MULTIPLIER;
            const validGpsAtStart = Math.min(prevExpedition.gpsAtStart || 0, Math.max(serverMaxGPSForExp, 1000));
            
            // Calculate max possible expedition reward
            const durationHours = (prevExpedition.endTime - prevExpedition.startTime) / (1000 * 60 * 60);
            const maxRelicMult = 2; // Ancient Relic max multiplier
            const passiveGold = Math.floor(validGpsAtStart * 3600 * durationHours * expDef.goldMultiplier * maxRelicMult);
            const maxExpReward = passiveGold + Math.floor(expDef.bonusGold * maxRelicMult);
            
            expeditionRewardGold = maxExpReward;
          } else {
            console.warn(`[V7 ANTI-CHEAT] NFT #${parsedTokenId}: Unknown expedition '${prevExpedition.expeditionId}'`);
          }
          
          // [V7] Validate completedExpeditions only increases by 1
          const prevCompleted = previousSave.s3?.completedExpeditions || 0;
          const newCompleted = gameState.s3?.completedExpeditions || 0;
          if (newCompleted > prevCompleted + 1) {
            console.warn(`[V7 ANTI-CHEAT] NFT #${parsedTokenId}: completedExpeditions jumped ${prevCompleted} → ${newCompleted}, capping to +1`);
            if (gameState.s3) gameState.s3.completedExpeditions = prevCompleted + 1;
          }
        }
        
        // [V7] Also validate gpsAtStart when expedition STARTS (null → active)
        if (!prevExpedition && curExpedition && curExpedition.status === 'active') {
          const serverMaxGPSForNewExp = serverRawGPS * MAX_PERMANENT_MULTIPLIER;
          if ((curExpedition.gpsAtStart || 0) > Math.max(serverMaxGPSForNewExp, 1000) * 1.1) {
            console.warn(`[V7 ANTI-CHEAT] NFT #${parsedTokenId}: Expedition gpsAtStart ${curExpedition.gpsAtStart} exceeds server max ${serverMaxGPSForNewExp}, capping`);
            curExpedition.gpsAtStart = Math.floor(Math.max(serverMaxGPSForNewExp, 1000));
          }
        }

        // [V7] Total legitimate exempt gold = achievements + challenges + expedition
        const totalLegitimateExemptGold = newlyClaimedRewardGold + newlyChallengeGold + expeditionRewardGold;
        const isLegitimateRewardClaim = totalLegitimateExemptGold > 0;
        
        if (!isLegitimateRewardClaim && goldIncrease > maxPossibleGold * 1.5) {
          console.warn(`CHEAT DETECTED for NFT #${parsedTokenId}: claimed ${goldIncrease} gold, max possible ${maxPossibleGold}`);
          gameState.gold = previousSave.gold + Math.floor(maxPossibleGold);
        } else if (isLegitimateRewardClaim) {
          // [V7] Even with legitimate claims, cap the total gold increase
          const maxAllowedIncrease = maxPossibleGold * 1.5 + totalLegitimateExemptGold;
          if (goldIncrease > maxAllowedIncrease) {
            console.warn(`[V7 ANTI-CHEAT] NFT #${parsedTokenId}: Gold increase ${goldIncrease} exceeds max allowed ${maxAllowedIncrease} (legitimate exempt: ${totalLegitimateExemptGold}), capping`);
            gameState.gold = previousSave.gold + Math.floor(maxAllowedIncrease);
          } else {
            console.log(`[SAVE API] Reward claim exemption for NFT #${parsedTokenId}: ${newlyClaimedCount} achievements (${newlyClaimedRewardGold}g), ${newlyChallengeGold}g challenges, ${expeditionRewardGold}g expedition`);
          }
        }
      }
      
      gameState.sessionDuration = (previousSave.sessionDuration || 0) + Math.floor(timeSinceLastSave / 60000);
    }
    
    if (gameState.gold < 0) {
      gameState.gold = 0;
    }
    
    // [V7] totalGoldEarned should never decrease (lifetime counter)
    if (previousSave && (gameState.totalGoldEarned || 0) < (previousSave.totalGoldEarned || 0)) {
      console.warn(`[V7 ANTI-CHEAT] NFT #${parsedTokenId}: totalGoldEarned decreased ${previousSave.totalGoldEarned} → ${gameState.totalGoldEarned}, preserving`);
      gameState.totalGoldEarned = previousSave.totalGoldEarned;
    }
    
    // [V7] totalClicks should never decrease (lifetime counter)
    if (previousSave && (gameState.totalClicks || 0) < (previousSave.totalClicks || 0)) {
      gameState.totalClicks = previousSave.totalClicks;
    }
    
    gameState.maxCombo = validMaxCombo;
    gameState.tokenId = parsedTokenId;

    // ═══ [V5] LAYER 1: Server-computed goldPerSecond ═══
    // NEVER trust client's goldPerSecond. Compute from upgrades server-side.
    // Raw GPS from upgrades is the hard truth — multiply by max permanent
    // multiplier stack (EmeraldCore 3x × globalMult 2x × vault 1.55x × tradePickaxe 3x ≈ 28x).
    // Temporary boosts (MegaBoost 5x, GoldRush 2x) expire offline — excluded.
    // serverRawGPS + MAX_PERMANENT_MULTIPLIER computed earlier (V7 — needed for expedition validation)
    const serverMaxGPS = serverRawGPS * MAX_PERMANENT_MULTIPLIER;
    // Use the LOWER of client-reported GPS and server-computed max
    // This stops Burp Suite GPS inflation while allowing legitimate multiplier stacks
    gameState.goldPerSecond = Math.min(gameState.goldPerSecond || 0, Math.max(serverMaxGPS, 1000));
    // Hard cap as defense-in-depth (legitimate max ≈ 1.1M)
    if (gameState.goldPerSecond > 750000) {
      console.warn(`[ANTI-CHEAT] GPS hard-capped for NFT #${parsedTokenId}: ${gameState.goldPerSecond} → 750000`);
      gameState.goldPerSecond = 750000;
    }

    // Cap autoClickRate — only Golden Goat gives 2, nothing gives more
    if (gameState.autoClickRate > 2) {
      gameState.autoClickRate = 2;
    }

    // ═══ [V7] LAYER 3: Sanitize ALL s3 economy-affecting state fields ═══
    // These fields are saved client-side and directly affect gold generation.
    // Without validation, Burp Suite users can inflate them for massive multipliers.
    if (gameState.s3) {
      // ── expeditionGpsBonus: permanent GPS added from expedition claims ──
      // Max possible: legendary gives 50 GPS × 2 Ancient Relic × ~100 completions = 10,000
      // Cap at 15,000 with generous headroom
      const MAX_EXPEDITION_GPS_BONUS = 15000;
      if ((gameState.s3.expeditionGpsBonus || 0) > MAX_EXPEDITION_GPS_BONUS) {
        console.warn(`[V7 ANTI-CHEAT] NFT #${parsedTokenId}: expeditionGpsBonus ${gameState.s3.expeditionGpsBonus} → capped to ${MAX_EXPEDITION_GPS_BONUS}`);
        gameState.s3.expeditionGpsBonus = MAX_EXPEDITION_GPS_BONUS;
      }
      if ((gameState.s3.expeditionGpsBonus || 0) < 0) {
        gameState.s3.expeditionGpsBonus = 0;
      }

      // ── expeditionTempMultiplier: temporary boost from expedition return ──
      // Max legitimate: 3x (legendary), max duration: 6 hours
      if (gameState.s3.expeditionTempMultiplier) {
        const MAX_TEMP_MULTIPLIER = 3.0;
        const MAX_TEMP_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours
        const tempMult = gameState.s3.expeditionTempMultiplier;
        if (tempMult.multiplier > MAX_TEMP_MULTIPLIER) {
          console.warn(`[V7 ANTI-CHEAT] NFT #${parsedTokenId}: tempMultiplier ${tempMult.multiplier} → capped to ${MAX_TEMP_MULTIPLIER}`);
          tempMult.multiplier = MAX_TEMP_MULTIPLIER;
        }
        // End time should be within 6 hours of now (not year 2099)
        if (tempMult.endTime > now + MAX_TEMP_DURATION_MS) {
          console.warn(`[V7 ANTI-CHEAT] NFT #${parsedTokenId}: tempMultiplier endTime too far in future, capping`);
          tempMult.endTime = now + MAX_TEMP_DURATION_MS;
        }
      }

      // ── legendaryExpeditions: should never exceed completedExpeditions ──
      const completedExp = gameState.s3.completedExpeditions || 0;
      if ((gameState.s3.legendaryExpeditions || 0) > completedExp) {
        console.warn(`[V7 ANTI-CHEAT] NFT #${parsedTokenId}: legendaryExpeditions ${gameState.s3.legendaryExpeditions} > completed ${completedExp}, capping`);
        gameState.s3.legendaryExpeditions = completedExp;
      }

      // ── warChest.totalVaulted: should never exceed totalGoldEarned ──
      // A player can't vault more gold than they've ever earned
      if (gameState.s3.warChest?.totalVaulted > (gameState.totalGoldEarned || 0)) {
        console.warn(`[V7 ANTI-CHEAT] NFT #${parsedTokenId}: warChest.totalVaulted ${gameState.s3.warChest.totalVaulted} > totalGoldEarned ${gameState.totalGoldEarned}, capping`);
        gameState.s3.warChest.totalVaulted = gameState.totalGoldEarned || 0;
      }

      // ═══ [V7] CRITICAL: BG TOKEN FIELDS ARE SERVER-AUTHORITATIVE ═══
      // lockedBG, earnedBG, stolenBG, lostBG directly determine BG token allocation
      // at season end via getTotalBG() = lockedBG + earnedBG + stolenBG - lostBG.
      // These must NEVER be modifiable by the client save payload.
      // Only server-side actions can modify them:
      //   lockedBG  → admin via /api/bg-allocations
      //   lostBG    → server via /api/war-log deduct_bg action
      //   earnedBG  → server-only (future: leaderboard rewards)
      //   stolenBG  → server-only (future: raid BG theft)
      if (gameState.s3.warChest) {
        if (previousSave?.s3?.warChest) {
          // ALWAYS preserve BG fields from server state — client cannot override
          gameState.s3.warChest.lockedBG = previousSave.s3.warChest.lockedBG || 0;
          gameState.s3.warChest.earnedBG = previousSave.s3.warChest.earnedBG || 0;
          gameState.s3.warChest.stolenBG = previousSave.s3.warChest.stolenBG || 0;
          gameState.s3.warChest.lostBG = previousSave.s3.warChest.lostBG || 0;
        } else {
          // No previous save — force BG fields to 0 (can't create BG from nothing)
          gameState.s3.warChest.lockedBG = gameState.s3.warChest.lockedBG || 0;
          gameState.s3.warChest.earnedBG = 0;
          gameState.s3.warChest.stolenBG = 0;
          gameState.s3.warChest.lostBG = 0;
        }
      }

      // ── maxComboReached: cap to maxCombo (which is server-validated) ──
      // Feeds into combo achievements (combo_25 = 250k gold)
      // Can't claim higher combo than allowed by owned items
      const validMaxComboForAchievements = gameState.maxCombo || 10;
      if ((gameState.s3.maxComboReached || 0) > validMaxComboForAchievements) {
        console.warn(`[V7 ANTI-CHEAT] NFT #${parsedTokenId}: maxComboReached ${gameState.s3.maxComboReached} > maxCombo ${validMaxComboForAchievements}, capping`);
        gameState.s3.maxComboReached = validMaxComboForAchievements;
      }
      // Should also never decrease (lifetime high water mark)
      if (previousSave?.s3?.maxComboReached && (gameState.s3.maxComboReached || 0) < previousSave.s3.maxComboReached) {
        gameState.s3.maxComboReached = previousSave.s3.maxComboReached;
      }

      // ── bossesDefeated: should only increase by 1 per save at most ──
      if (previousSave?.s3) {
        const prevBosses = previousSave.s3.bossesDefeated || 0;
        const newBosses = gameState.s3.bossesDefeated || 0;
        if (newBosses > prevBosses + 3) { // Allow up to 3 boss kills per save interval (generous)
          console.warn(`[V7 ANTI-CHEAT] NFT #${parsedTokenId}: bossesDefeated jumped ${prevBosses} → ${newBosses}, capping to +3`);
          gameState.s3.bossesDefeated = prevBosses + 3;
        }
        if (newBosses < prevBosses) {
          gameState.s3.bossesDefeated = prevBosses;
        }
      }

      // ── loginStreak: can't increase by more than 1 per save ──
      if (previousSave?.s3?.loginStreak) {
        const prevStreak = previousSave.s3.loginStreak.currentStreak || 0;
        const newStreak = gameState.s3.loginStreak?.currentStreak || 0;
        if (newStreak > prevStreak + 1) {
          console.warn(`[V7 ANTI-CHEAT] NFT #${parsedTokenId}: loginStreak jumped ${prevStreak} → ${newStreak}, capping to +1`);
          if (gameState.s3.loginStreak) gameState.s3.loginStreak.currentStreak = prevStreak + 1;
        }
      }

      // ── raidState.totalRecruited: should only increase, never decrease ──
      if (previousSave?.s3?.raidState) {
        const prevRecruited = previousSave.s3.raidState.totalRecruited || 0;
        const newRecruited = gameState.s3.raidState?.totalRecruited || 0;
        if (newRecruited < prevRecruited) {
          console.warn(`[V7 ANTI-CHEAT] NFT #${parsedTokenId}: totalRecruited decreased ${prevRecruited} → ${newRecruited}, preserving`);
          if (gameState.s3.raidState) gameState.s3.raidState.totalRecruited = prevRecruited;
        }
      }
    }

    // ═══ [V5] LAYER 2: Stamp HMAC integrity tag ═══
    const hmacTag = generateSaveHMAC(parsedTokenId, gameState.gold || 0, gameState.totalClicks || 0, gameState.totalGoldEarned || 0);

    // Save game state by tokenId
    // ═══ [V5] HARDENED SEASON RESET PROTECTION ═══
    // When seasonReset flag is set, the server REJECTS any save that doesn't
    // include seasonResetAck: true. Only a client that loaded AFTER the reset
    // will have this flag (set during load when seasonReset is detected).
    // Stale tabs that loaded BEFORE the reset won't have it.
    const existingSave = await redis.get<any>(`${GAME_KEY_PREFIX}${parsedTokenId}`);
    if (existingSave?.seasonReset) {
      const hasAck = !!(gameState as any).seasonResetAck;
      
      if (!hasAck) {
        // No acknowledgment flag = stale tab or pre-reset session
        console.log(`[SAVE API] ⛔ Blocked stale tab for NFT #${parsedTokenId} — seasonReset active, no ack flag`);
        return NextResponse.json({ success: true, tokenId: parsedTokenId, note: 'season_reset_protection' });
      }
      
      // Client acknowledged the reset — this is a fresh session. Clear both flags.
      delete (gameState as any).seasonReset;
      delete (gameState as any).seasonResetAck;
      console.log(`[SAVE API] ✅ Season reset acknowledged for NFT #${parsedTokenId}, clearing flag`);
    }

    await redis.set(`${GAME_KEY_PREFIX}${parsedTokenId}`, {
      ...gameState,
      lastSaved: now,
      _hmac: hmacTag, // V5: integrity tag for tamper detection on next save
    });

    // [V4] Stripped verbose logging — previously logged gold, clicks, gps to Vercel logs
    return NextResponse.json({ success: true, tokenId: parsedTokenId });

  } catch (error) {
    console.error('Error saving game:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
