import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { checkRateLimit, getClientIP } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ═══════════════════════════════════════════════════════════
//  PURCHASE HISTORY API — Reads from Redis cache
//
//  This endpoint serves the Purchase History panel in the Shop.
//  All data comes from Redis (populated by /api/purchases scan).
//  If cache is empty, triggers a scan via the main purchases endpoint.
//
//  GET /api/purchases/history?address=0x...
// ═══════════════════════════════════════════════════════════

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_KV_REST_API_URL || process.env.KV_REST_API_URL!,
  token: process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN!,
});

export async function GET(request: NextRequest) {
  const ip = getClientIP(request);
  const rl = await checkRateLimit(`purchases_history:${ip}`, 60, 15);
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
  }

  const address = request.nextUrl.searchParams.get('address')?.toLowerCase();

  if (!address || !/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  try {
    const cacheKey = `verified_purchases:${address}`;
    const metaKey = `purchases_meta:${address}`;

    // Read from Redis cache
    let purchases = await redis.get<any[]>(cacheKey);
    let meta = await redis.get<any>(metaKey);

    // If cache is empty, trigger a scan via the main purchases endpoint
    if (!purchases || purchases.length === 0) {
      // Internal fetch to trigger scan
      const origin = request.nextUrl.origin;
      try {
        const scanRes = await fetch(`${origin}/api/purchases?address=${address}&refresh=true`, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(25000),
        });
        const scanData = await scanRes.json();
        if (scanData.purchases) {
          purchases = scanData.purchases;
          meta = scanData.summary ? { summary: scanData.summary, scannedAt: Date.now(), totalBgBurned: scanData.totalBgBurned } : meta;
        }
      } catch (e) {
        console.error('[HISTORY] Scan trigger failed:', e);
      }
    }

    if (!purchases || purchases.length === 0) {
      return NextResponse.json({
        address,
        receipts: [],
        summary: {
          totalPurchases: 0,
          failedPurchases: 0,
          totalEthSpent: '0',
          totalBgBurned: '0',
          itemBreakdown: [],
        },
        source: 'redis_cache',
      });
    }

    return NextResponse.json({
      address,
      receipts: purchases,
      summary: meta?.summary || {
        totalPurchases: purchases.filter((p: any) => p.status === 'success').length,
        failedPurchases: purchases.filter((p: any) => p.status === 'failed').length,
        totalEthSpent: purchases
          .filter((p: any) => p.status === 'success')
          .reduce((sum: number, p: any) => sum + parseFloat(p.ethAmount || '0'), 0)
          .toFixed(6),
        totalBgBurned: purchases
          .filter((p: any) => p.status === 'success')
          .reduce((sum: number, p: any) => sum + (p.bgBurned || 0), 0)
          .toFixed(6),
        itemBreakdown: [],
      },
      source: meta?.scannedAt ? 'redis_cache' : 'computed',
      cachedAt: meta?.scannedAt || null,
    });
  } catch (error: any) {
    console.error('[HISTORY] Error:', error);
    return NextResponse.json({
      error: 'Failed to fetch purchase history',
      detail: error?.message?.slice(0, 200),
    }, { status: 500 });
  }
}
