import { NextRequest, NextResponse } from 'next/server';
import { INSTANT_BURN_ADDRESS, BG_TOKEN_ADDRESS, DEAD_ADDRESS } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const alchemyUrl = process.env.ALCHEMY_RPC_URL
  || (process.env.NEXT_PUBLIC_ALCHEMY_KEY
    ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_KEY}` : null)
  || (process.env.NEXT_PUBLIC_ALCHEMY_ID
    ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_ID}` : null);

async function alchemyRPC(method: string, params: any[]): Promise<any> {
  const res = await fetch(alchemyUrl!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address')?.toLowerCase();

  if (!alchemyUrl) {
    return NextResponse.json({ error: 'Alchemy not configured' }, { status: 500 });
  }

  const results: any = { alchemyConfigured: true };

  // ── TEST 1: ETH transfers from wallet → InstantBurn ──
  if (address) {
    try {
      const data = await alchemyRPC('alchemy_getAssetTransfers', [{
        fromAddress: address,
        toAddress: INSTANT_BURN_ADDRESS,
        category: ['external'],
        withMetadata: true,
        order: 'desc',
        maxCount: '0x14', // 20
      }]);
      const transfers = data.result?.transfers || [];
      results.ethTransfers = {
        count: transfers.length,
        error: data.error?.message,
        purchases: transfers.map((t: any) => ({
          hash: t.hash,
          ethValue: t.value,
          block: t.blockNum,
          date: t.metadata?.blockTimestamp,
          asset: t.asset,
        })),
      };
    } catch (e: any) {
      results.ethTransfers = { error: e.message?.slice(0, 150) };
    }
  }

  // ── TEST 2: BG burns from InstantBurn → dead address ──
  try {
    const data = await alchemyRPC('alchemy_getAssetTransfers', [{
      fromAddress: INSTANT_BURN_ADDRESS,
      toAddress: DEAD_ADDRESS,
      contractAddresses: [BG_TOKEN_ADDRESS],
      category: ['erc20'],
      withMetadata: true,
      order: 'desc',
      maxCount: '0x14',
    }]);
    const transfers = data.result?.transfers || [];
    results.bgBurns = {
      count: transfers.length,
      error: data.error?.message,
      burns: transfers.slice(0, 5).map((t: any) => ({
        hash: t.hash,
        bgValue: t.value,
        date: t.metadata?.blockTimestamp,
        tokenSymbol: t.rawContract?.address,
      })),
    };
  } catch (e: any) {
    results.bgBurns = { error: e.message?.slice(0, 150) };
  }

  return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } });
}
