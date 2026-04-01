'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import {
  WALL_PRICE_ETH, CATAPULT_PRICE_ETH, WAR_TREASURY_ADDRESS,
  ETH_WALL_HP, MAX_GOLD_WALLS, GOLD_WALL_HP,
  GOLD_WALL_COST, getGoldWallCost, GOLD_WALL_MIN_LEVEL, MAX_WALL_HP, CATAPULT_DAMAGE,
} from '@/lib/config';

// ════════════════════════════════════════════
//  WAR PANEL + RAIDERS CHAT
// ════════════════════════════════════════════

interface WarLogEntry {
  id: string;
  attackerTokenId: number;
  attackerName: string;
  raidType: string;
  timestamp: number;
  result: string;
  goldAmount?: number;
  bgAmount?: number;
}

interface ChatMessage {
  id: string;
  tokenId: number;
  name: string;
  message: string;
  timestamp: number;
}

function fmtGold(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface WarPanelProps {
  tokenId: number;
  address: string;   // wallet address — required for buy_catapult ownership proof
  playerName: string;
  level: number;
  gold: number;
  wallHP: number;
  ethWallsBought: number;  // lifetime counter
  ethWallHP: number;       // current active ETH wall HP (0-5)
  goldWallsBuilt: number;
  catapults: number;
  onWallPurchased: () => void;           // ETH wall +5 HP
  onGoldWallBuilt: (cost: number) => void;  // Gold wall +1 HP
  onCatapultPurchased: () => void;
  onAttackStatus?: (isUnderAttack: boolean, recentAttackCount: number) => void;
}

export default function WarPanel({
  tokenId, address, playerName, level, gold,
  wallHP, ethWallsBought, ethWallHP, goldWallsBuilt, catapults,
  onWallPurchased, onGoldWallBuilt, onCatapultPurchased, onAttackStatus,
}: WarPanelProps) {
  const [log, setLog] = useState<WarLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<'wall' | 'catapult' | null>(null);
  const [tab, setTab] = useState<'defense' | 'chat'>('defense');

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { sendTransaction, data: txHash, isPending, error: txError, isError: txFailed, reset: resetTx } = useSendTransaction();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  // Reset buying state if transaction fails (wallet rejection, session expired, etc.)
  useEffect(() => {
    if (txFailed && buying) {
      console.warn('[WAR] Transaction failed:', txError?.message);
      setBuying(null);
      resetTx();
    }
  }, [txFailed, buying, txError, resetTx]);

  // 1-at-a-time: can only buy when current ETH wall is destroyed AND total HP allows it
  const canBuyEthWall = ethWallHP === 0 && wallHP + ETH_WALL_HP <= MAX_WALL_HP;
  const nextGoldWallCost = getGoldWallCost(goldWallsBuilt + 1);
  const canBuildGoldWall = level >= GOLD_WALL_MIN_LEVEL && goldWallsBuilt < MAX_GOLD_WALLS && wallHP < MAX_WALL_HP && gold >= nextGoldWallCost;
  const goldWallHP = goldWallsBuilt * GOLD_WALL_HP;

  // Load war log
  useEffect(() => {
    const loadLog = async () => {
      try {
        const res = await fetch(`/api/war-log?tokenId=${tokenId}`);
        const data = await res.json();
        if (data.success) setLog(data.log || []);
      } catch (e) { /* */ }
      setLoading(false);
    };
    loadLog();
    const interval = setInterval(loadLog, 60_000);
    return () => clearInterval(interval);
  }, [tokenId]);

  // Report attack status to parent — recent attacks within 30 min
  useEffect(() => {
    if (!onAttackStatus) return;
    const thirtyMinAgo = Date.now() - 30 * 60_000;
    const recentAttacks = log.filter(e => e.timestamp > thirtyMinAgo);
    const isUnderAttack = recentAttacks.length > 0 && wallHP === 0;
    onAttackStatus(isUnderAttack, recentAttacks.length);
  }, [log, wallHP, onAttackStatus]);

  // Load chat — only poll when chat tab is active
  useEffect(() => {
    const loadChat = async () => {
      if (tab !== 'chat') return; // Don't poll when not viewing chat
      try {
        const res = await fetch('/api/war-log?action=chat');
        if (res.status === 429) {
          // Rate limited — silently skip, don't show error to user
          return;
        }
        if (!res.ok) {
          console.error('[Chat] Load failed:', res.status, res.statusText);
          setChatError(`Chat load failed (${res.status})`);
          return;
        }
        const data = await res.json();
        if (data.success && data.messages) {
          const parsed = data.messages.map((m: any) => {
            try {
              return typeof m === 'string' ? JSON.parse(m) : m;
            } catch (e) {
              console.error('[Chat] Failed to parse message:', m);
              return null;
            }
          }).filter(Boolean).reverse();
          setChatMessages(parsed);
          setChatError(null); // Clear error on success
        } else if (data.error) {
          console.error('[Chat] API error:', data.error);
          setChatError(data.error);
        }
      } catch (e) {
        console.error('[Chat] Network error:', e);
        setChatError('Network error — check connection');
      }
    };
    loadChat();
    const interval = setInterval(loadChat, 15_000); // 15s (was 10s) to reduce API load
    return () => clearInterval(interval);
  }, [tab]);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Purchase result feedback
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = useState<string | null>(null); // Issue 5: success flash
  const [buildingGoldWall, setBuildingGoldWall] = useState(false);           // Issue 1: loading state
  const [goldWallError, setGoldWallError] = useState<string | null>(null);   // Issue 2: error display
  const [goldWallSuccess, setGoldWallSuccess] = useState(false);             // Issue 3: success flash

  // Handle ETH purchase confirmation — with retry for RPC timing
  useEffect(() => {
    if (txConfirmed && txHash && buying) {
      const purchaseAction = buying === 'wall' ? 'buy_wall' : 'buy_catapult';
      const purchaseType = buying; // capture before async
      setPurchaseError(null);

      // Retry logic: server RPC may lag behind client's wallet RPC by a few seconds
      const attemptRegister = async (retriesLeft: number): Promise<boolean> => {
        try {
          const res = await fetch('/api/war-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: purchaseAction, tokenId, txHash, address }),
          });
          const data = await res.json();

          if (data.success) {
            // Server confirmed — NOW credit the purchase
            if (purchaseType === 'wall') {
              onWallPurchased();
              setPurchaseSuccess('✅ Wall purchased! +5 HP');
              setTimeout(() => setPurchaseSuccess(null), 3000);
            } else {
              onCatapultPurchased();
              setPurchaseSuccess('✅ Catapult added to inventory!');
              setTimeout(() => setPurchaseSuccess(null), 3000);
            }
            setBuying(null);
            return true;
          }

          if (data.duplicate) {
            // Already registered (double-fire) — credit locally if not already
            if (purchaseType === 'wall') onWallPurchased();
            else onCatapultPurchased();
            setBuying(null);
            return true;
          }

          // RPC lag: "Transaction not confirmed" — retry after delay
          const isRpcLag = data.error?.includes('not confirmed') || data.error?.includes('not found');
          if (isRpcLag && retriesLeft > 0) {
            console.log(`[WAR] RPC lag, retrying in 3s... (${retriesLeft} left)`);
            await new Promise(r => setTimeout(r, 3000));
            return attemptRegister(retriesLeft - 1);
          }

          // Real error — don't credit
          console.error('[WAR] Purchase rejected:', data.error);
          setPurchaseError(data.error || 'Server rejected purchase');
          setBuying(null);
          return false;
        } catch (e) {
          if (retriesLeft > 0) {
            await new Promise(r => setTimeout(r, 2000));
            return attemptRegister(retriesLeft - 1);
          }
          console.error('[WAR] Purchase network error:', e);
          setPurchaseError('Network error — try refreshing');
          setBuying(null);
          return false;
        }
      };

      // Wait 2s before first attempt (let Base RPC catch up)
      setTimeout(() => attemptRegister(3), 2000);
    }
  }, [txConfirmed, txHash, buying, tokenId, onWallPurchased, onCatapultPurchased, address]);

  const buyEthWall = useCallback(() => {
    if (!canBuyEthWall) return;
    resetTx();
    setPurchaseError(null);
    setBuying('wall');
    sendTransaction({
      to: WAR_TREASURY_ADDRESS as `0x${string}`,
      value: parseEther(WALL_PRICE_ETH),
    });
  }, [canBuyEthWall, sendTransaction, resetTx]);

  const buildGoldWall = useCallback(async () => {
    if (!canBuildGoldWall || buildingGoldWall) return;
    setBuildingGoldWall(true);
    setGoldWallError(null);
    try {
      const res = await fetch('/api/war-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'build_gold_wall', tokenId }),
      });
      const data = await res.json();
      if (data.success) {
        onGoldWallBuilt(data.goldDeducted || nextGoldWallCost);
        setGoldWallSuccess(true);
        setTimeout(() => setGoldWallSuccess(false), 2500);
      } else {
        setGoldWallError(data.error || 'Build failed');
        setTimeout(() => setGoldWallError(null), 5000);
      }
    } catch (e) {
      setGoldWallError('Network error — check connection');
      setTimeout(() => setGoldWallError(null), 5000);
    } finally {
      setBuildingGoldWall(false);
    }
  }, [canBuildGoldWall, buildingGoldWall, tokenId, onGoldWallBuilt, nextGoldWallCost]);

  const buyCatapult = useCallback(() => {
    resetTx();
    setPurchaseError(null);
    setBuying('catapult');
    sendTransaction({
      to: WAR_TREASURY_ADDRESS as `0x${string}`,
      value: parseEther(CATAPULT_PRICE_ETH),
    });
  }, [sendTransaction, resetTx]);

  // Send chat message
  const sendChat = useCallback(async () => {
    if (!chatInput.trim() || chatLoading) return;
    const msgText = chatInput.trim();
    setChatLoading(true);
    setChatError(null);

    // Optimistic update — show message locally immediately
    const optimisticMsg: ChatMessage = {
      id: `msg_${Date.now()}_${tokenId}`,
      tokenId,
      name: playerName,
      message: msgText,
      timestamp: Date.now(),
    };
    setChatMessages(prev => [...prev, optimisticMsg]);
    setChatInput('');

    try {
      console.log('[Chat] Sending:', { tokenId, name: playerName, msg: msgText.slice(0, 30) });
      const res = await fetch('/api/war-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat_send',
          tokenId,
          name: playerName,
          message: msgText,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => 'no body');
        console.error('[Chat] HTTP error:', res.status, errBody);
        if (res.status === 429) {
          setChatError('Slow down — wait a moment before sending');
        } else {
          setChatError(`Failed (${res.status})`);
        }
        setChatMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
        setChatInput(msgText);
        setChatLoading(false);
        return;
      }

      const result = await res.json();
      console.log('[Chat] Response:', result);

      if (!result.success) {
        setChatError(result.error || 'Server error');
        setChatMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
        setChatInput(msgText);
      } else {
        // Refresh after delay to let Redis commit
        await new Promise(r => setTimeout(r, 500));
        try {
          const chatRes = await fetch('/api/war-log?action=chat');
          const chatData = await chatRes.json();
          if (chatData.success && chatData.messages) {
            setChatMessages(chatData.messages.map((m: any) => {
              try { return typeof m === 'string' ? JSON.parse(m) : m; } catch { return null; }
            }).filter(Boolean).reverse());
          }
        } catch { /* refresh failed, optimistic msg still shown */ }
      }
    } catch (e) {
      console.error('[Chat] Network error:', e);
      setChatError(`Network error: ${e instanceof Error ? e.message : 'check console'}`);
      setChatMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
      setChatInput(msgText);
    }
    setChatLoading(false);
  }, [chatInput, chatLoading, tokenId, playerName]);

  const attacks = log.filter(e => e.result !== 'pending').reverse();
  const blocked = attacks.filter(e => e.result === 'blocked').length;
  const breached = attacks.filter(e => e.result === 'success').length;

  return (
    <div className="war-card p-4 space-y-4 war-border-glow">
      {/* Header */}
      <div className="flex items-center justify-between relative z-10">
        <div>
          <h3 className="text-lg font-bold war-section-title">🛡️ War Panel</h3>
          <p className="text-xs text-gray-400 mt-0.5">Walls, catapults &amp; raiders chat</p>
        </div>
        <div className="text-right text-xs font-numbers">
          <div className="text-green-400">🧱 {wallHP}/{MAX_WALL_HP} HP</div>
          <div className="text-orange-400 flex items-center gap-1">
            <img src="/sprites/ui/catapult_icon.png" alt="catapult" style={{ width: 14, height: 14, imageRendering: 'pixelated' }} />
            {catapults} catapult{catapults !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 relative z-10">
        <button onClick={() => setTab('defense')}
          className={`flex-1 py-2 rounded-lg text-sm font-display transition-all ${
            tab === 'defense' ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'bg-gray-800/50 text-gray-500'
          }`}>🛡️ Defense</button>
        <button onClick={() => setTab('chat')}
          className={`flex-1 py-2 rounded-lg text-sm font-display transition-all ${
            tab === 'chat' ? 'bg-red-600/20 text-red-400 border border-red-500/30' : 'bg-gray-800/50 text-gray-500'
          }`}>💬 Raiders Chat</button>
      </div>

      {/* ═══ DEFENSE TAB ═══ */}
      {tab === 'defense' && (
        <div className="space-y-4">
          {/* Purchase success flash — shared banner for ETH wall/catapult confirmations */}
          {purchaseSuccess && (
            <div className="bg-green-500/15 border border-green-500/30 rounded-lg px-3 py-2 text-xs text-green-400 text-center font-bold animate-pulse">
              {purchaseSuccess}
            </div>
          )}

          {/* Defense Stats */}
          {attacks.length > 0 && (
            <div className="flex gap-3 text-xs">
              <div className="bg-green-500/10 rounded-lg px-3 py-1.5 flex-1 text-center">
                <span className="text-gray-400">Blocked: </span><span className="text-green-400 font-bold">{blocked}</span>
              </div>
              <div className="bg-red-500/10 rounded-lg px-3 py-1.5 flex-1 text-center">
                <span className="text-gray-400">Breached: </span><span className="text-red-400 font-bold">{breached}</span>
              </div>
            </div>
          )}

          {/* Wall HP Bar */}
          <div className="bg-black/30 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-gray-300">🧱 Fortress HP</span>
              <span className={`text-lg font-bold ${wallHP > 20 ? 'text-green-400' : wallHP > 10 ? 'text-orange-400' : wallHP > 0 ? 'text-red-400' : 'text-gray-600'}`}>
                {wallHP}/{MAX_WALL_HP}
              </span>
            </div>
            <div className="h-4 bg-gray-800 rounded-full overflow-hidden relative">
              {/* ETH wall (blue) — actual remaining HP */}
              {ethWallHP > 0 && (
                <div className="absolute h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-500 transition-all"
                  style={{ width: `${(ethWallHP / MAX_WALL_HP) * 100}%` }} />
              )}
              {/* Gold walls (yellow, stacked after ETH) */}
              {goldWallsBuilt > 0 && (
                <div className="absolute h-full rounded-r-full bg-gradient-to-r from-[#D4AF37] to-[#FDE047] transition-all"
                  style={{ left: `${(ethWallHP / MAX_WALL_HP) * 100}%`, width: `${(goldWallHP / MAX_WALL_HP) * 100}%` }} />
              )}
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-blue-400">⛓️ ETH Wall: {ethWallHP}/{ETH_WALL_HP} HP {ethWallsBought > 0 ? `(#${ethWallsBought})` : ''}</span>
              <span className="text-[#D4AF37]">🪙 Gold: {goldWallsBuilt}/{MAX_GOLD_WALLS} ({goldWallHP} HP)</span>
            </div>
          </div>

          {/* ETH Wall */}
          <div className="bg-black/30 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-blue-400">⛓️ Fortified Wall</div>
                <div className="text-[10px] text-gray-500">{ETH_WALL_HP} HP • 1 at a time • ETH → burns BG</div>
              </div>
              <span className="text-sm font-bold text-blue-400">
                {ethWallHP > 0 ? `${ethWallHP}/${ETH_WALL_HP} HP` : 'None'}
              </span>
            </div>
            {/* Single wall HP segments */}
            <div className="flex gap-1.5">
              {Array.from({ length: ETH_WALL_HP }).map((_, i) => (
                <div key={i} className={`h-10 flex-1 rounded-lg flex items-center justify-center text-sm transition-all ${
                  i < ethWallHP
                    ? 'bg-gradient-to-t from-blue-800 to-blue-600 border border-blue-400/40'
                    : 'bg-gray-800/40 border border-gray-700/30 border-dashed'
                }`}>
                  {i < ethWallHP ? '⛓️' : ''}
                </div>
              ))}
            </div>
            {ethWallsBought > 0 && (
              <div className="text-[10px] text-gray-600 text-center">Walls purchased lifetime: {ethWallsBought}</div>
            )}
            <button onClick={buyEthWall} disabled={!canBuyEthWall || isPending || buying === 'wall'}
              className={`w-full py-2.5 rounded-lg text-sm font-bold transition-all ${
                canBuyEthWall && !isPending ? 'bg-gradient-to-r from-blue-700 to-blue-600 hover:from-blue-600 hover:to-blue-500 text-white' : 'bg-gray-800 text-gray-600 cursor-not-allowed'
              }`}>
              {buying === 'wall' && isPending ? '⏳ Confirming...'
                : buying === 'wall' && txConfirmed ? '⏳ Registering wall...'
                : ethWallHP > 0 ? `⛓️ Wall Active (${ethWallHP}/${ETH_WALL_HP} HP)`
                : `⛓️ Buy Wall (${ETH_WALL_HP} HP) — ${WALL_PRICE_ETH} ETH (~$2.50)`
              }
            </button>
            {/* Issue 4: Show errors under ETH wall when buying wall */}
            {purchaseError && buying !== 'catapult' && (
              <div className="text-[10px] text-red-400 mt-1 text-center">❌ {purchaseError}</div>
            )}
            {txFailed && buying === 'wall' && (
              <div className="text-[10px] text-red-400 mt-1 text-center">
                ❌ {txError?.message?.includes('rejected') || txError?.message?.includes('denied')
                  ? 'Transaction cancelled'
                  : txError?.message?.includes('session') || txError?.message?.includes('Session')
                  ? 'Wallet session expired — reconnect your wallet'
                  : txError?.message?.includes('insufficient')
                  ? 'Insufficient ETH balance'
                  : 'Transaction failed — try reconnecting your wallet'}
              </div>
            )}
          </div>

          {/* Gold Walls */}
          <div className="bg-black/30 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-[#D4AF37]">🪙 Gold Walls</div>
                <div className="text-[10px] text-gray-500">{GOLD_WALL_HP} HP each • {fmtGold(nextGoldWallCost)} next • Lv{GOLD_WALL_MIN_LEVEL}+</div>
              </div>
              <span className="text-sm font-bold text-[#D4AF37]">{goldWallsBuilt}/{MAX_GOLD_WALLS}</span>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: MAX_GOLD_WALLS }).map((_, i) => (
                <div key={i} className={`h-6 flex-1 rounded transition-all ${
                  i < goldWallsBuilt
                    ? 'bg-gradient-to-t from-[#D4AF37]/60 to-[#FDE047]/40 border border-[#D4AF37]/40'
                    : 'bg-gray-800/30 border border-gray-700/20 border-dashed'
                }`} />
              ))}
            </div>
            {level < GOLD_WALL_MIN_LEVEL ? (
              <div className="text-xs text-gray-600 text-center">🔒 Unlocks at Level {GOLD_WALL_MIN_LEVEL}</div>
            ) : (
              <button onClick={buildGoldWall} disabled={!canBuildGoldWall || buildingGoldWall}
                className={`w-full py-2.5 rounded-lg text-sm font-bold transition-all ${
                  canBuildGoldWall && !buildingGoldWall ? 'bg-gradient-to-r from-[#D4AF37]/80 to-[#FDE047]/60 hover:from-[#D4AF37] hover:to-[#FDE047] text-black' : 'bg-gray-800 text-gray-600 cursor-not-allowed'
                }`}>
                {buildingGoldWall ? '⏳ Building...'
                  : goldWallsBuilt >= MAX_GOLD_WALLS ? '🪙 Max Gold Walls'
                  : gold < nextGoldWallCost ? `🪙 Need ${fmtGold(nextGoldWallCost)} gold`
                  : `🪙 Build Wall (1 HP) — ${fmtGold(nextGoldWallCost)} gold`
                }
              </button>
            )}
            {/* Gold wall success flash */}
            {goldWallSuccess && (
              <div className="text-[10px] text-green-400 mt-1 text-center font-bold">✅ Gold wall built! +1 HP</div>
            )}
            {/* Gold wall error display */}
            {goldWallError && (
              <div className="text-[10px] text-red-400 mt-1 text-center">❌ {goldWallError}</div>
            )}
          </div>

          {/* Catapults */}
          <div className="bg-black/30 rounded-lg p-3 space-y-2" style={{ border: '1px solid rgba(251,146,60,0.2)' }}>
            <div className="flex items-center gap-3">
              {/* Catapult pixel art */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <img
                  src="/sprites/ui/catapult_icon_256.png"
                  alt="Catapult"
                  style={{ width: 56, height: 56, imageRendering: 'pixelated' }}
                />
                {catapults > 0 && (
                  <span style={{
                    position: 'absolute', top: -6, right: -6,
                    background: '#ea580c', color: '#fff', fontSize: 10, fontWeight: 900,
                    borderRadius: '50%', width: 18, height: 18,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '1px solid rgba(255,255,255,0.3)',
                  }}>{catapults}</span>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div className="text-sm font-bold text-orange-400">Catapults</div>
                <div className="text-[10px] text-gray-500">Removes {CATAPULT_DAMAGE} HP • Consumed on use</div>
                {catapults === 0 && (
                  <div className="text-[10px] text-orange-600 mt-0.5">None in inventory</div>
                )}
              </div>
            </div>
            <button onClick={buyCatapult} disabled={isPending || buying === 'catapult'}
              className={`w-full py-2 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                !isPending ? 'bg-gradient-to-r from-orange-700 to-orange-600 hover:from-orange-600 hover:to-orange-500 text-white' : 'bg-gray-800 text-gray-600 cursor-not-allowed'
              }`}>
              {buying === 'catapult' && isPending
                ? '⏳ Confirming...'
                : buying === 'catapult' && txConfirmed
                ? '⏳ Registering catapult...'
                : <>
                    <img src="/sprites/ui/catapult_icon.png" alt="" style={{ width: 16, height: 16, imageRendering: 'pixelated' }} />
                    Buy Catapult — {CATAPULT_PRICE_ETH} ETH (~$1.70)
                  </>
              }
            </button>
            {/* Issue 4: Show errors under catapult when buying catapult */}
            {purchaseError && buying === 'catapult' && (
              <div className="text-[10px] text-red-400 mt-1 text-center">❌ {purchaseError}</div>
            )}
            {txFailed && buying === 'catapult' && (
              <div className="text-[10px] text-red-400 mt-1 text-center">
                ❌ {txError?.message?.includes('rejected') || txError?.message?.includes('denied')
                  ? 'Transaction cancelled'
                  : txError?.message?.includes('session') || txError?.message?.includes('Session')
                  ? 'Wallet session expired — reconnect your wallet'
                  : txError?.message?.includes('insufficient')
                  ? 'Insufficient ETH balance'
                  : 'Transaction failed — try reconnecting your wallet'}
              </div>
            )}
          </div>

          {/* Attack Log — Timeline Style */}
          <div className="space-y-2 relative z-10">
            <div className="text-sm font-bold war-section-title">📜 Incoming Attacks</div>
            {loading ? <div className="text-center text-gray-500 py-3 text-sm">Loading...</div>
            : attacks.length === 0 ? <div className="text-center text-gray-600 py-3 text-sm">No attacks yet</div>
            : (
              <div className="war-log-timeline max-h-48 overflow-y-auto scrollbar-hide">
                {attacks.slice(0, 15).map(entry => (
                  <div key={entry.id} className={`war-log-entry text-xs ${
                    entry.result === 'blocked' ? 'war-log-defended'
                      : entry.result === 'success' ? 'war-log-defeat'
                      : ''
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className="text-base shrink-0">
                        {entry.result === 'blocked' ? '🧱' : entry.result === 'success' ? '💀' : '🛡️'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-gray-300 truncate font-display text-[11px]">{entry.attackerName || `#${entry.attackerTokenId}`}</div>
                        <div className="text-gray-500 font-numbers">
                          {entry.result === 'blocked' ? 'Wall absorbed (-1 HP)'
                            : entry.result === 'success' ? `Stole ${entry.raidType === 'bg' ? `${entry.bgAmount?.toFixed(4)} BG` : `${fmtGold(entry.goldAmount || 0)} gold`}`
                            : 'Failed'}
                        </div>
                      </div>
                      <span className="text-gray-600 shrink-0 font-numbers">{timeAgo(entry.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rules */}
          <div className="text-xs text-gray-600 space-y-0.5 border-t border-gray-800/50 pt-2">
            <div>• ⛓️ ETH wall = <span className="text-blue-400">{ETH_WALL_HP} HP</span> ({WALL_PRICE_ETH} ETH) • 1 at a time • Rebuy when destroyed</div>
            <div>• 🪙 Gold walls = <span className="text-[#D4AF37]">{GOLD_WALL_HP} HP</span> each ({fmtGold(getGoldWallCost(1))}–{fmtGold(getGoldWallCost(10))}) • Max {MAX_GOLD_WALLS} • Lv{GOLD_WALL_MIN_LEVEL}+</div>
            <div>• 💥 Catapults remove <span className="text-orange-400">{CATAPULT_DAMAGE} HP</span> • Consumed even on partial walls</div>
            <div>• Blocked raids deal 1 HP damage • Max {MAX_WALL_HP} HP total</div>
            <div>• All ETH → BaseGold buyback &amp; burn 🔥</div>
          </div>
        </div>
      )}

      {/* ═══ RAIDERS CHAT TAB ═══ */}
      {tab === 'chat' && (
        <div className="space-y-3">
          <div className="text-xs text-gray-500 text-center">
            💬 Coordinate raids, form alliances, or taunt your enemies
          </div>

          {/* Error banner — visible to user */}
          {chatError && (
            <div className="bg-red-900/30 border border-red-500/40 rounded-lg px-3 py-2 text-xs text-red-400 flex items-center justify-between">
              <span>⚠️ {chatError}</span>
              <button onClick={() => setChatError(null)} className="text-red-500 hover:text-red-300 ml-2">✕</button>
            </div>
          )}

          {/* Chat messages */}
          <div className="bg-black/30 rounded-lg p-2 h-64 overflow-y-auto scrollbar-hide space-y-1.5">
            {chatMessages.length === 0 ? (
              <div className="text-center text-gray-600 py-8 text-sm">No messages yet — be the first raider to speak!</div>
            ) : (
              chatMessages.map(msg => {
                const isMe = msg.tokenId === tokenId;
                return (
                  <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                    <div className={`max-w-[85%] rounded-xl px-3 py-1.5 ${
                      isMe ? 'bg-red-600/20 border border-red-500/20' : 'bg-gray-800/60 border border-gray-700/30'
                    }`}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[10px] font-bold ${isMe ? 'text-red-400' : 'text-gray-400'}`}>
                          ⛏️ {msg.name}
                        </span>
                        <span className="text-[9px] text-gray-600">{timeAgo(msg.timestamp)}</span>
                      </div>
                      <div className="text-xs text-gray-200 break-words">{msg.message}</div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()}
              placeholder="Rally the raiders..."
              maxLength={200}
              className="flex-1 bg-black/30 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-red-500 focus:outline-none"
            />
            <button onClick={sendChat} disabled={!chatInput.trim() || chatLoading}
              className={`px-4 py-2 rounded-lg font-bold text-sm ${
                chatInput.trim() && !chatLoading
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : 'bg-gray-800 text-gray-600 cursor-not-allowed'
              }`}>
              {chatLoading ? '...' : '⚔️'}
            </button>
          </div>
          <div className="text-[10px] text-gray-600 text-center">
            {chatInput.length}/200 • All players can see this chat
          </div>
        </div>
      )}
    </div>
  );
}
