import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { INSTANT_BURN_ADDRESS, BG_TOKEN_ADDRESS, DEAD_ADDRESS } from '@/lib/config';
import { checkRateLimit, getClientIP } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 25;

// ═══════════════════════════════════════════════════════════
//  PURCHASES API v12 — Alchemy getAssetTransfers + Redis Cache
//
//  WHY Alchemy getAssetTransfers?
//  • Works on FREE tier (no paid plan needed)
//  • No block range limits — scans entire chain in ONE call
//  • No chunking, no progressive scanning, no 504 timeouts
//  • Filters by fromAddress + toAddress natively
//  • Returns ETH value, tx hash, block, metadata — everything we need
//
//  Architecture:
//  1. GET /api/purchases?address=0x...
//  2. Check Redis cache (instant, <50ms)
//  3. Cache miss: TWO Alchemy calls:
//     - getAssetTransfers: wallet to InstantBurn [finds all purchases]
//     - getAssetTransfers: InstantBurn to dead address, ERC20 BG [finds BG burned]
//  4. Match by txHash → build full receipt with BG burned per purchase
//  5. Match ETH value → shop item (2% tolerance)
//  6. Store in Redis (server-authoritative, 24h TTL)
//
//  Redis Keys:
//    verified_purchases:{address}  — purchase array
//    purchases_meta:{address}      — scan time, summary, lastBlock
// ═══════════════════════════════════════════════════════════

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_KV_REST_API_URL || process.env.KV_REST_API_URL!,
  token: process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN!,
});

const CACHE_TTL_SECONDS = 300;  // 5 min soft TTL
const CACHE_HARD_TTL = 86400;   // 24h hard TTL

// Alchemy RPC URL
const alchemyUrl = process.env.ALCHEMY_RPC_URL
  || (process.env.NEXT_PUBLIC_ALCHEMY_KEY
    ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_KEY}` : null)
  || (process.env.NEXT_PUBLIC_ALCHEMY_ID
    ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_ID}` : null);

// Shop items
const SHOP_ITEMS: { id: string; priceETH: string; name: string; emoji: string }[] = [
  { id: 'boost_2x', priceETH: '0.00015', name: '2x Power Boost', emoji: '⚡' },
  { id: 'time_warp', priceETH: '0.0003', name: 'Time Warp', emoji: '⏰' },
  { id: 'diamond_pickaxe', priceETH: '0.0006', name: 'Diamond Pickaxe', emoji: '💎' },
  { id: 'auto_miner', priceETH: '0.0015', name: 'Auto-Miner Bot', emoji: '🤖' },
  { id: 'golden_crown', priceETH: '0.001', name: 'Golden Crown', emoji: '👑' },
  { id: 'burn_booster', priceETH: '0.00035', name: 'Burn Booster', emoji: '🔥' },
  { id: 'mega_boost_5x', priceETH: '0.0012', name: '5x MEGA BOOST', emoji: '⚡' },
  { id: 'second_mine', priceETH: '0.005', name: 'Second Mine', emoji: '🏔️' },
  { id: 'golden_goat', priceETH: '0.003', name: 'Golden Goat', emoji: '🐐' },
  { id: 'lucky_nugget', priceETH: '0.002', name: 'Lucky Nugget', emoji: '🍀' },
  { id: 'diamond_mine', priceETH: '0.004', name: 'Diamond Mine', emoji: '💎' },
  { id: 'inferno_burn', priceETH: '0.0017', name: 'INFERNO BURN', emoji: '🔥' },
  { id: 'prestige_star', priceETH: '0.008', name: 'Prestige Star', emoji: '⭐' },
  { id: 'emerald_core', priceETH: '0.006', name: 'Emerald Core', emoji: '🟢' },
  { id: 'ancient_relic', priceETH: '0.01', name: 'Ancient Relic', emoji: '🏺' },
  { id: 'phoenix_flame', priceETH: '0.007', name: 'Phoenix Flame', emoji: '🔱' },
  // War items — unique prices so scanner can distinguish from shop items
  { id: 'eth_wall', priceETH: '0.0013', name: 'ETH Wall', emoji: '🧱' },
  { id: 'catapult', priceETH: '0.0009', name: 'Catapult', emoji: '🏗️' },
];

function matchShopItem(ethValue: number): { id: string; name: string; emoji: string } | null {
  return SHOP_ITEMS.find(
    i => Math.abs(ethValue - parseFloat(i.priceETH)) / parseFloat(i.priceETH) < 0.02
  ) || null;
}

// ═══ Alchemy JSON-RPC helper ═══
async function alchemyRPC(method: string, params: any[]): Promise<any> {
  if (!alchemyUrl) throw new Error('Alchemy not configured');
  const res = await fetch(alchemyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result;
}

// ═══════════════════════════════════════════════════════════
//  SCAN — Two Alchemy calls, full chain, no chunking
// ═══════════════════════════════════════════════════════════
async function scanPurchases(address: string): Promise<{
  purchases: any[];
  summary: any;
  error?: string;
}> {
  try {
    // ── CALL 1: All ETH transfers from wallet → InstantBurn ──
    // This finds every shop purchase (successful only — Alchemy filters reverts)
    const ethTransfers = await alchemyRPC('alchemy_getAssetTransfers', [{
      fromAddress: address,
      toAddress: INSTANT_BURN_ADDRESS,
      category: ['external'],
      withMetadata: true,
      order: 'asc',
      maxCount: '0x3E8', // 1000 max
    }]);

    const transfers = ethTransfers?.transfers || [];
    console.log(`[SCAN] Found ${transfers.length} ETH transfers from ${address.slice(0,10)} → InstantBurn`);

    if (transfers.length === 0) {
      return {
        purchases: [],
        summary: { totalPurchases: 0, failedPurchases: 0, totalEthSpent: '0', totalBgBurned: '0', itemBreakdown: [] },
      };
    }

    // ── CALL 2: All BG token burns from InstantBurn → dead address ──
    // Match by txHash to find how much BG each purchase burned
    let bgBurnByTx = new Map<string, number>();
    try {
      const bgTransfers = await alchemyRPC('alchemy_getAssetTransfers', [{
        fromAddress: INSTANT_BURN_ADDRESS,
        toAddress: DEAD_ADDRESS,
        contractAddresses: [BG_TOKEN_ADDRESS],
        category: ['erc20'],
        withMetadata: true,
        order: 'asc',
        maxCount: '0x3E8',
      }]);

      (bgTransfers?.transfers || []).forEach((t: any) => {
        const bgAmount = parseFloat(t.value || '0');
        bgBurnByTx.set(t.hash?.toLowerCase(), bgAmount);
      });
      console.log(`[SCAN] Found ${bgBurnByTx.size} BG burn transfers`);
    } catch (e: any) {
      console.warn(`[SCAN] BG burn lookup failed (non-fatal): ${e.message?.slice(0, 80)}`);
      // Continue without BG burned data — purchases still valid
    }

    // ── BUILD PURCHASES ──
    let totalEthSpent = 0;
    let totalBgBurned = 0;

    const purchases = transfers.map((t: any) => {
      const ethValue = parseFloat(t.value || '0');
      const txHash = t.hash;
      const blockNum = t.blockNum ? parseInt(t.blockNum, 16) : 0;
      const timestamp = t.metadata?.blockTimestamp
        ? new Date(t.metadata.blockTimestamp).getTime()
        : 0;
      const bgBurned = bgBurnByTx.get(txHash?.toLowerCase()) || 0;

      const item = matchShopItem(ethValue);

      totalEthSpent += ethValue;
      totalBgBurned += bgBurned;

      return {
        txHash,
        itemId: item?.id || 'unknown',
        itemName: item ? `${item.emoji} ${item.name}` : `Unknown (${ethValue} ETH)`,
        ethAmount: ethValue.toString(),
        bgBurned,
        timestamp,
        blockNumber: blockNum,
        status: 'success',
        verifiedOnChain: true,
      };
    });

    // Item breakdown
    const itemBreakdown = Object.entries(
      purchases.reduce((acc: Record<string, { count: number; ethSpent: number; bgBurned: number; name: string }>, p: any) => {
        const key = p.itemId;
        if (!acc[key]) acc[key] = { count: 0, ethSpent: 0, bgBurned: 0, name: p.itemName };
        acc[key].count++;
        acc[key].ethSpent += parseFloat(p.ethAmount);
        acc[key].bgBurned += p.bgBurned;
        return acc;
      }, {})
    ).map(([id, data]) => ({
      itemId: id,
      itemName: (data as any).name,
      count: (data as any).count,
      totalEthSpent: (data as any).ethSpent.toFixed(6),
      totalBgBurned: (data as any).bgBurned.toFixed(6),
    }));

    return {
      purchases,
      summary: {
        totalPurchases: purchases.length,
        failedPurchases: 0,
        totalEthSpent: totalEthSpent.toFixed(6),
        totalBgBurned: totalBgBurned.toFixed(6),
        itemBreakdown,
      },
    };
  } catch (e: any) {
    console.error('[SCAN] Error:', e.message);
    return {
      purchases: [],
      summary: { totalPurchases: 0, totalEthSpent: '0', totalBgBurned: '0', failedPurchases: 0, itemBreakdown: [] },
      error: e.message?.slice(0, 200),
    };
  }
}

// ═══════════════════════════════════════════════════════════
//  GET HANDLER — Cache-first, Alchemy scan on miss
// ═══════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  const ip = getClientIP(request);
  const rl = await checkRateLimit(`purchases:${ip}`, 60, 20);
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
  }

  const address = request.nextUrl.searchParams.get('address')?.toLowerCase();
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true';

  if (!address || !/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  if (!alchemyUrl) {
    return NextResponse.json({ error: 'Alchemy RPC not configured' }, { status: 500 });
  }

  const cacheKey = `verified_purchases:${address}`;
  const metaKey = `purchases_meta:${address}`;

  try {
    // ── SERVE FROM CACHE if fresh ──
    if (!forceRefresh) {
      const meta = await redis.get<any>(metaKey);
      if (meta?.scannedAt && (Date.now() - meta.scannedAt) < CACHE_TTL_SECONDS * 1000) {
        const cached = await redis.get<any[]>(cacheKey) || [];
        return NextResponse.json({
          purchases: cached,
          totalBurns: cached.length,
          totalBgBurned: parseFloat(meta.totalBgBurned || '0'),
          summary: meta.summary || null,
          source: 'redis_cache',
          cachedAt: meta.scannedAt,
          cacheAgeSeconds: Math.floor((Date.now() - meta.scannedAt) / 1000),
        });
      }
    }

    // ── SCAN via Alchemy ──
    console.log(`[PURCHASES] Scanning via Alchemy for ${address}${forceRefresh ? ' (forced)' : ''}`);
    const { purchases, summary, error } = await scanPurchases(address);

    if (error) {
      // Serve stale cache
      const stale = await redis.get<any[]>(cacheKey);
      if (stale && stale.length > 0) {
        const staleMeta = await redis.get<any>(metaKey);
        return NextResponse.json({
          purchases: stale,
          totalBurns: stale.length,
          totalBgBurned: parseFloat(staleMeta?.totalBgBurned || '0'),
          summary: staleMeta?.summary || null,
          source: 'redis_stale',
          warning: `Scan failed: ${error}`,
        });
      }
      return NextResponse.json({ error, purchases: [], totalBurns: 0 }, { status: 502 });
    }

    // ── STORE IN REDIS ──
    const now = Date.now();
    await redis.set(cacheKey, purchases, { ex: CACHE_HARD_TTL });
    await redis.set(metaKey, {
      scannedAt: now,
      totalPurchases: summary.totalPurchases,
      totalBgBurned: summary.totalBgBurned,
      totalEthSpent: summary.totalEthSpent,
      summary,
    }, { ex: CACHE_HARD_TTL });

    console.log(`[PURCHASES] Stored ${purchases.length} purchases for ${address} (${summary.totalBgBurned} BG burned)`);

    return NextResponse.json({
      purchases,
      totalBurns: summary.totalPurchases,
      totalBgBurned: parseFloat(summary.totalBgBurned),
      summary,
      source: 'alchemy_scan',
      scannedAt: now,
    });
  } catch (error: any) {
    console.error('[PURCHASES] Error:', error);
    try {
      const stale = await redis.get<any[]>(cacheKey);
      if (stale && stale.length > 0) {
        return NextResponse.json({
          purchases: stale,
          totalBurns: stale.length,
          source: 'redis_stale',
          warning: 'Scan error, showing cached data',
        });
      }
    } catch {}
    return NextResponse.json({
      error: 'Failed to fetch purchases',
      detail: error?.message?.slice(0, 200),
    }, { status: 500 });
  }
}
