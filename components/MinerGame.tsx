'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAccount, useWaitForTransactionReceipt, usePublicClient, useSignMessage } from 'wagmi';
import { useAttributedWriteContract as useWriteContract } from '@/lib/useAttributedWriteContract';
import { parseEther, formatEther, formatUnits, createPublicClient, http, fallback, parseAbiItem } from 'viem';
import { base } from 'wagmi/chains';
import { v4 as uuidv4 } from 'uuid';

// ============ SEASON 3 IMPORTS ============
import ExpeditionSystem from './ExpeditionSystem';
import { AchievementsPanel, DailyChallengesPanel, GoldRushOverlay, AchievementPopup } from './AchievementSystem';
import {
  EXPEDITIONS, ActiveExpedition, type ExpeditionType,
  ACHIEVEMENTS, AchievementState, type AchievementDef,
  DailyChallengeState, getDailyChallenges, getTodayKey,
  LoginStreakState, getStreakBonus,
  S3_UPGRADES,
} from '@/lib/season3';
import {
  GOLD_RUSH_INTERVAL_MIN, GOLD_RUSH_INTERVAL_MAX,
  GOLD_RUSH_DURATION, GOLD_RUSH_MULTIPLIER,
  TEST_MODE,
} from '@/lib/config';
import { BossEncounter, getBossInterval, selectBoss } from './MiniBoss';
// Season 3 v2: New gameplay systems
import LuckyCloverSystem from './LuckyClover';
import { WarChestPanel, type WarChestState, INITIAL_WAR_CHEST, getVaultBonuses, getVaultTier, getTotalBG } from './WarChest';
import { useMineEvents, MineEventBanner, type ActiveMineEvent } from './MineEvents';
import MineRaids, { type RaidState, type ActiveRaid, INITIAL_RAID_STATE, BARRACKS } from './MineRaids';
import WarPanel from './WarPanel';
import AttackMenu from './AttackMenu';
import WarSceneCanvas from './WarSceneCanvas';
import GameTutorial from './GameTutorial';
import SeasonClaim from './SeasonClaim';
import Smelter from './Smelter';
import { rollOre, getMineTheme, getTradePickaxeTier } from '@/lib/oreTypes';
import { MINESWAP_CONTRACTS, MINESWAP_TRACKER_ABI } from '@/lib/mineswap';

// ============ CONTRACT ADDRESSES ============
const BG_TOKEN = '0x36b712A629095234F2196BbB000D1b96C12Ce78e' as `0x${string}`;
const INSTANT_BURN = INSTANT_BURN_ADDRESS as `0x${string}`;
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD' as `0x${string}`;

// ============ SEASON CONFIG ============
import {
  CURRENT_SEASON,
  SEASON_START_TIMESTAMP,
  INSTANT_BURN_ADDRESS,
  WALL_PRICE_ETH,
  CATAPULT_PRICE_ETH,
  ETH_WALL_HP,
  MAX_ETH_WALLS,
  MAX_GOLD_WALLS,
  CATAPULT_DAMAGE,
} from '@/lib/config';

// ============ RELIABLE CLIENT ============
// Primary: /api/rpc proxy (routes through Alchemy — supports full historical getLogs)
// Fallback: free public RPCs (limited to ~10k block range, will fail for 'earliest')
const reliableClient = createPublicClient({
  chain: base,
  transport: fallback([
    http('/api/rpc'),
    http('https://base.llamarpc.com'),
    http('https://base-mainnet.public.blastapi.io'),
    http('https://1rpc.io/base'),
    http('https://mainnet.base.org'),
  ]),
});

// ============ SOUND SYSTEM ============
let audioContext: AudioContext | null = null;

function initAudio() {
  if (typeof window === 'undefined') return;
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

function playSound(type: string, comboLevel: number = 1, soundEnabled: boolean = true) {
  if (!soundEnabled || typeof window === 'undefined') return;
  initAudio();
  if (!audioContext) return;
  
  const ctx = audioContext;
  const now = ctx.currentTime;
  
  if (type === 'click') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1760, now + 0.05);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
    // Mobile haptics
    if (navigator.vibrate) navigator.vibrate(10);
  } else if (type === 'crit') {
    // Crit hit — deeper impact + screen shake feel
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
    if (navigator.vibrate) navigator.vibrate([20, 10, 30]);
  } else if (type === 'combo') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'triangle';
    const baseFreq = 440 + (comboLevel * 100);
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.1);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
  } else if (type === 'upgrade') {
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      gain.gain.setValueAtTime(0.2, now + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.2);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.2);
    });
  } else if (type === 'purchase') {
    const notes = [1047, 1319, 1568];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.05);
      gain.gain.setValueAtTime(0.25, now + i * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.05 + 0.2);
      osc.start(now + i * 0.05);
      osc.stop(now + i * 0.05 + 0.2);
    });
  } else if (type === 'anvil') {
    // Anvil clank for training completion
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.12);
    if (navigator.vibrate) navigator.vibrate(15);
  } else if (type === 'raidhorn') {
    // War horn for raid launch
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.linearRampToValueAtTime(165, now + 0.3);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc.start(now);
    osc.stop(now + 0.5);
    if (navigator.vibrate) navigator.vibrate([30, 20, 50]);
  } else if (type === 'raidresult') {
    // Clash/impact for raid results
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.type = 'sawtooth';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(150, now);
    osc2.frequency.setValueAtTime(160, now);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.2);
    osc2.stop(now + 0.2);
    if (navigator.vibrate) navigator.vibrate([40, 20, 40]);
  } else if (type === 'stonebuild') {
    // Stone scraping for wall/building construction
    const bufferSize = ctx.sampleRate * 0.15;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2) * 0.3;
    }
    const noise = ctx.createBufferSource();
    const bandpass = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    noise.buffer = buffer;
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(400, now);
    bandpass.Q.setValueAtTime(2, now);
    noise.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    noise.start(now);
    noise.stop(now + 0.15);
    if (navigator.vibrate) navigator.vibrate([20, 10, 20]);
  }
}

// ============ ABIs ============
const INSTANT_BURN_ABI = [
  { name: 'buyAndBurn', type: 'function', inputs: [], outputs: [], stateMutability: 'payable' },
] as const;

// ============ SHOP ITEMS ============
export const SHOP_ITEMS = [
  // Season 1 Items (stackable — buy as many as you want)
  {
    id: 'boost_2x',
    name: '⚡ 2x Power Boost',
    description: 'Double click power for 10 minutes',
    priceETH: '0.00015',
    priceUSD: '~$0.50',
    emoji: '⚡',
    effect: { type: 'boost' as const, multiplier: 2, duration: 600000 },
    season: 1,
    maxOwned: 0 as number, // 0 = unlimited
  },
  {
    id: 'time_warp',
    name: '⏰ Time Warp',
    description: 'Instantly collect 1 hour of passive gold',
    priceETH: '0.0003',
    priceUSD: '~$1.00',
    emoji: '⏰',
    effect: { type: 'instant_gold' as const, hours: 1 },
    season: 1,
    maxOwned: 0 as number,
  },
  {
    id: 'diamond_pickaxe',
    name: '💎 Diamond Pickaxe',
    description: 'Permanent +10 gold per click',
    priceETH: '0.0006',
    priceUSD: '~$2.00',
    emoji: '💎',
    effect: { type: 'permanent_click' as const, amount: 10 },
    season: 1,
    maxOwned: 0 as number,
  },
  {
    id: 'auto_miner',
    name: '🤖 Auto-Miner Bot',
    description: 'Permanent +100 gold per second',
    priceETH: '0.0015',
    priceUSD: '~$5.00',
    emoji: '🤖',
    effect: { type: 'permanent_passive' as const, amount: 100 },
    season: 1,
    maxOwned: 0 as number,
  },
  {
    id: 'golden_crown',
    name: '👑 Golden Crown',
    description: 'Exclusive cosmetic + 15x combo max',
    priceETH: '0.001',
    priceUSD: '~$3.00',
    emoji: '👑',
    effect: { type: 'cosmetic' as const, maxCombo: 15 },
    season: 1,
    maxOwned: 1,
  },
  {
    id: 'burn_booster',
    name: '🔥 Burn Booster',
    description: '+5/click, +25/sec, 100% burns BG!',
    priceETH: '0.00035',
    priceUSD: '~$1.15',
    emoji: '🔥',
    effect: { type: 'burn_bonus' as const, clickAmount: 5, passiveAmount: 25 },
    season: 1,
    maxOwned: 0 as number,
  },
  
  // Season 3 Exclusive Items (one-time purchases)
  {
    id: 'mega_boost_5x',
    name: '⚡ 5x MEGA BOOST',
    description: '5x ALL earnings for 5 minutes!',
    priceETH: '0.0012',
    priceUSD: '~$4.00',
    emoji: '⚡',
    effect: { type: 'boost' as const, multiplier: 5, duration: 300000 },
    season: 3,
    tag: 'NEW',
    maxOwned: 1,
  },
  {
    id: 'second_mine',
    name: '🏔️ Second Mine',
    description: 'PERMANENT 2x multiplier on ALL earnings!',
    priceETH: '0.005',
    priceUSD: '~$15.00',
    emoji: '🏔️',
    effect: { type: 'global_multiplier' as const, multiplier: 2 },
    season: 3,
    tag: 'LEGENDARY',
    maxOwned: 1,
  },
  {
    id: 'golden_goat',
    name: '🐐 Golden Goat',
    description: 'Premium cosmetic + 25x combo + auto-click!',
    priceETH: '0.003',
    priceUSD: '~$10.00',
    emoji: '🐐',
    effect: { type: 'golden_goat' as const, maxCombo: 25, autoClick: 2 },
    season: 3,
    tag: 'EPIC',
    maxOwned: 1,
  },
  {
    id: 'lucky_nugget',
    name: '🍀 Lucky Nugget',
    description: '15% chance for 2x gold per click!',
    priceETH: '0.002',
    priceUSD: '~$6.00',
    emoji: '🍀',
    effect: { type: 'lucky' as const, chance: 0.15, multiplier: 2 },
    season: 3,
    tag: 'NEW',
    maxOwned: 1,
  },
  {
    id: 'diamond_mine',
    name: '💎 Diamond Mine',
    description: 'Permanent +500 gold per second!',
    priceETH: '0.004',
    priceUSD: '~$12.00',
    emoji: '💎',
    effect: { type: 'permanent_passive' as const, amount: 500 },
    season: 3,
    tag: 'EPIC',
    maxOwned: 1,
  },
  {
    id: 'inferno_burn',
    name: '🔥 INFERNO BURN',
    description: '+25/click, +100/sec, MASSIVE BG burn!',
    priceETH: '0.0017',
    priceUSD: '~$5.50',
    emoji: '🔥',
    effect: { type: 'burn_bonus' as const, clickAmount: 25, passiveAmount: 100 },
    season: 3,
    tag: 'NEW',
    maxOwned: 1,
  },
  
  // Season 3 NFT-Enhancing Items — these make the NFT itself more valuable
  {
    id: 'prestige_star',
    name: '⭐ Prestige Star',
    description: 'Visible NFT trait! +3x click power PERMANENTLY.',
    priceETH: '0.008',
    priceUSD: '~$25.00',
    emoji: '⭐',
    effect: { type: 'prestige_star' as const, clickMultiplier: 3 },
    season: 3,
    tag: 'NFT TRAIT',
    maxOwned: 1,
  },
  {
    id: 'emerald_core',
    name: '🟢 Emerald Core',
    description: 'NFT trait! +3x GPS + unlocks Ore Types.',
    priceETH: '0.006',
    priceUSD: '~$18.00',
    emoji: '🟢',
    effect: { type: 'emerald_core' as const, gpsMultiplier: 3, unlocksOres: true },
    season: 3,
    tag: 'NFT TRAIT',
    maxOwned: 1,
  },
  {
    id: 'ancient_relic',
    name: '🏺 Ancient Relic',
    description: 'NFT trait! Doubles expedition rewards forever.',
    priceETH: '0.01',
    priceUSD: '~$30.00',
    emoji: '🏺',
    effect: { type: 'ancient_relic' as const, expeditionMultiplier: 2 },
    season: 3,
    tag: 'LEGENDARY',
    maxOwned: 1,
  },
  {
    id: 'phoenix_flame',
    name: '🔱 Phoenix Flame',
    description: 'NFT trait! Never lose combo + 35x max combo.',
    priceETH: '0.007',
    priceUSD: '~$22.00',
    emoji: '🔱',
    effect: { type: 'phoenix_flame' as const, maxCombo: 35, noComboDecay: true },
    season: 3,
    tag: 'NFT TRAIT',
    maxOwned: 1,
  },
];

// ============ UPGRADES (with max caps) ============
// BALANCED FOR 3-WEEK SEASON: L10=2-3hr, L20=2-3days, L30=2weeks
const INITIAL_UPGRADES = {
  pickaxe: { cost: 100, owned: 0, maxOwned: 50, multiplier: 1.8, perClick: 1, perSec: 0, emoji: '⛏️', name: 'Better Pickaxe', unlockLevel: 1 },
  miner: { cost: 250, owned: 0, maxOwned: 40, multiplier: 1.9, perClick: 0, perSec: 1, emoji: '👷', name: 'Hire Miner', unlockLevel: 2 },
  drill: { cost: 2000, owned: 0, maxOwned: 30, multiplier: 2.0, perClick: 0, perSec: 1, emoji: '🔧', name: 'Gold Drill', unlockLevel: 5 },
  excavator: { cost: 10000, owned: 0, maxOwned: 25, multiplier: 2.0, perClick: 0, perSec: 4, emoji: '🚜', name: 'Excavator', unlockLevel: 10 },
  dynamite: { cost: 50000, owned: 0, maxOwned: 20, multiplier: 2.1, perClick: 0, perSec: 10, emoji: '🧨', name: 'Dynamite', unlockLevel: 15 },
  goldmine: { cost: 500000, owned: 0, maxOwned: 15, multiplier: 2.2, perClick: 0, perSec: 30, emoji: '🏔️', name: 'Gold Mine', unlockLevel: 25 },
  luckyStrike: { cost: 75000, owned: 0, maxOwned: 30, multiplier: 2.0, perClick: 0, perSec: 0, emoji: '🍀', name: 'Lucky Strike', luckChance: 0.05, luckBonus: 2, unlockLevel: 20 },
  goldBoost: { cost: 200000, owned: 0, maxOwned: 15, multiplier: 2.2, perClick: 0, perSec: 0, emoji: '✨', name: 'Gold Boost', boostPercent: 0.08, unlockLevel: 30 },
  // Season 3 Upgrades
  geologist: { cost: 25000, owned: 0, maxOwned: 20, multiplier: 2.0, perClick: 3, perSec: 0, emoji: '🔬', name: 'Geologist', unlockLevel: 12 },
  deepShaft: { cost: 150000, owned: 0, maxOwned: 15, multiplier: 2.1, perClick: 0, perSec: 20, emoji: '🕳️', name: 'Deep Shaft', unlockLevel: 18 },
  refinery: { cost: 750000, owned: 0, maxOwned: 10, multiplier: 2.3, perClick: 0, perSec: 0, emoji: '🏭', name: 'Gold Refinery', boostPercent: 0.04, unlockLevel: 22 },
  tunnelBorer: { cost: 2000000, owned: 0, maxOwned: 10, multiplier: 2.2, perClick: 0, perSec: 75, emoji: '🚇', name: 'Tunnel Borer', unlockLevel: 28 },
  motherLode: { cost: 15000000, owned: 0, maxOwned: 8, multiplier: 2.3, perClick: 10, perSec: 150, emoji: '🌋', name: 'Motherlode', unlockLevel: 32 },
  // Late-Game S3 Upgrades
  quantumDrill: { cost: 100000000, owned: 0, maxOwned: 5, multiplier: 2.5, perClick: 25, perSec: 400, emoji: '🔮', name: 'Quantum Drill', unlockLevel: 38 },
  voidExtractor: { cost: 1000000000, owned: 0, maxOwned: 3, multiplier: 2.8, perClick: 0, perSec: 1500, emoji: '🌀', name: 'Void Extractor', unlockLevel: 45 },
  cosmicForge: { cost: 20000000000, owned: 0, maxOwned: 2, multiplier: 3.0, perClick: 100, perSec: 5000, emoji: '⭐', name: 'Cosmic Forge', unlockLevel: 52 },
};

// ============ LEVEL SYSTEM — SEASON 3 (60 Levels, harder scaling) ============
const LEVEL_THRESHOLDS = [
  // Tier 1: Beginner (1-10) — First few hours
  0, 5000, 20000, 60000, 150000, 350000, 700000, 1200000, 2000000, 3500000,
  // Tier 2: Intermediate (11-20) — Day 1-3
  6000000, 10000000, 16000000, 25000000, 40000000, 60000000, 90000000, 140000000, 200000000, 300000000,
  // Tier 3: Advanced (21-30) — Week 1-2
  500000000, 800000000, 1200000000, 1800000000, 2800000000, 4500000000, 7000000000, 11000000000, 17000000000, 25000000000,
  // Tier 4: Expert (31-40) — Week 2-3 (hardcore)
  40000000000, 65000000000, 100000000000, 160000000000, 250000000000, 400000000000, 650000000000, 1000000000000, 1600000000000, 2500000000000,
  // Tier 5: Master (41-50) — Multi-season / near-impossible
  4000000000000, 7000000000000, 12000000000000, 20000000000000, 35000000000000, 60000000000000, 100000000000000, 180000000000000, 300000000000000, 500000000000000,
  // Tier 6: Legend (51-60) — Aspirational / unreachable
  900000000000000, 1500000000000000, 2800000000000000, 5000000000000000, 10000000000000000, 20000000000000000, 40000000000000000, 80000000000000000, 160000000000000000, 350000000000000000,
];

const LEVEL_TITLES = [
  // Tier 1: Beginner
  'Novice Miner', 'Apprentice', 'Prospector', 'Digger', 'Excavator',
  'Tunneler', 'Cave Explorer', 'Vein Hunter', 'Ore Seeker', 'Gold Finder',
  // Tier 2: Intermediate
  'Rich Striker', 'Deep Miner', 'Shaft Master', 'Bonanza Hunter', 'Nugget King',
  'Mine Foreman', 'Gold Baron', 'Treasure Hunter', 'Motherlode', 'Lucky Legend',
  // Tier 3: Advanced
  'Golden Touch', 'Midas Heir', 'Millionaire', 'Vault Master', 'Mine Tycoon',
  'Gold Emperor', 'Diamond Hands', 'Legendary Miner', 'El Dorado', 'Golden God',
  // Tier 4: Expert
  'Cosmic Miner', 'Galaxy Baron', 'Universe Tycoon', 'Infinity Miner', 'The One',
  'Void Driller', 'Star Forger', 'Nebula Baron', 'Quantum Miner', 'Celestial King',
  // Tier 5: Master
  'Dimension Breaker', 'Reality Bender', 'Time Miner', 'Eternity Baron', 'Omega Forger',
  'Ascended Miner', 'Transcendent', 'Enlightened One', 'Supreme Baron', 'The Architect',
  // Tier 6: Legend
  'Mythic Miner', 'Ancient One', 'Primordial Baron', 'World Forger', 'Genesis Miner',
  'Titan of Gold', 'Eternal Legend', 'God of Mines', 'The Absolute', 'GOAT ⛏️🐐',
];

// ============ NUMBER FORMATTING HELPER ============
function fmtNum(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function calculateLevel(totalGoldEarned: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (totalGoldEarned >= LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

function getXPProgress(totalGoldEarned: number, currentLevel: number) {
  const currentThreshold = LEVEL_THRESHOLDS[currentLevel - 1] || 0;
  const nextThreshold = LEVEL_THRESHOLDS[currentLevel] || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] * 2;
  const current = totalGoldEarned - currentThreshold;
  const needed = nextThreshold - currentThreshold;
  const percent = Math.min((current / needed) * 100, 100);
  return { current, needed, percent };
}

// ============ TYPES ============
interface OnChainPurchase {
  itemId: string;
  ethAmount: string;
  bgBurned: number;
  timestamp: number;
  txHash: string;
}

interface GameState {
  gold: number;
  totalClicks: number;
  totalGoldEarned: number;
  upgrades: typeof INITIAL_UPGRADES;
  combo: number;
  maxCombo: number;
  lastClickTime: number;
}

interface VerifiedBonuses {
  bonusClick: number;
  bonusPassive: number;
  hasCrown: boolean;
  hasGoat: boolean;
  hasLucky: boolean;
  maxCombo: number;
  activeBoost: { multiplier: number; endTime: number; remaining: number } | null;
  globalMultiplier: number;
  luckyChance: number;
  luckyMultiplier: number;
  autoClickRate: number;
  // Season 3 NFT-enhancing bonuses
  hasPrestigeStar: boolean;
  clickMultiplier: number;
  hasEmeraldCore: boolean;
  gpsMultiplier: number;
  unlocksOres: boolean;
  hasAncientRelic: boolean;
  expeditionMultiplier: number;
  hasPhoenixFlame: boolean;
  noComboDecay: boolean;
}

// ============ HELPER: Calculate bonuses from verified purchases ============
// SECURITY: This function enforces maxOwned limits server-side (V6).
// Even if a user buys the same one-time item twice on-chain, only the first counts.
function calculateVerifiedBonuses(purchases: OnChainPurchase[], currentTime: number): VerifiedBonuses {
  let bonusClick = 0;
  let bonusPassive = 0;
  let hasCrown = false;
  let hasGoat = false;
  let hasLucky = false;
  let maxCombo = 10;
  let activeBoost: VerifiedBonuses['activeBoost'] = null;
  let globalMultiplier = 1;
  let luckyChance = 0;
  let luckyMultiplier = 1;
  let autoClickRate = 0;
  // S3 NFT-enhancing bonuses
  let hasPrestigeStar = false;
  let clickMultiplier = 1;
  let hasEmeraldCore = false;
  let gpsMultiplier = 1;
  let unlocksOres = false;
  let hasAncientRelic = false;
  let expeditionMultiplier = 1;
  let hasPhoenixFlame = false;
  let noComboDecay = false;

  // [V6 SECURITY] Track how many times each item has been applied
  // Prevents stacking one-time items by buying duplicates on-chain
  const itemAppliedCount: Record<string, number> = {};

  purchases.forEach(purchase => {
    const item = SHOP_ITEMS.find(i => {
      const itemEth = parseFloat(i.priceETH);
      const purchaseEth = parseFloat(purchase.ethAmount);
      // [V6 SECURITY] Tightened from 5% to 2% — prevents cross-item price matching
      return Math.abs(purchaseEth - itemEth) / itemEth < 0.02;
    });
    if (!item) return;

    // [V6 SECURITY] Enforce maxOwned — skip if already at limit
    if (item.maxOwned > 0) {
      const applied = itemAppliedCount[item.id] || 0;
      if (applied >= item.maxOwned) return; // SKIP — already maxed
    }
    itemAppliedCount[item.id] = (itemAppliedCount[item.id] || 0) + 1;

    switch (item.effect.type) {
      case 'permanent_click':
        bonusClick += item.effect.amount || 10;
        break;
      case 'permanent_passive':
        bonusPassive += item.effect.amount || 100;
        break;
      case 'cosmetic':
        hasCrown = true;
        maxCombo = Math.max(maxCombo, item.effect.maxCombo || 15);
        break;
      case 'boost':
        const boostEndTime = purchase.timestamp + (item.effect.duration || 600000);
        const remaining = boostEndTime - currentTime;
        if (remaining > 0) {
          if (!activeBoost || item.effect.multiplier > activeBoost.multiplier) {
            activeBoost = { multiplier: item.effect.multiplier || 2, endTime: boostEndTime, remaining };
          }
        }
        break;
      case 'burn_bonus':
        bonusClick += item.effect.clickAmount || 5;
        bonusPassive += item.effect.passiveAmount || 25;
        break;
      case 'global_multiplier':
        // [V6 FIX C-4] Was: globalMultiplier *= 2 (stacked to 8x, 16x...)
        // Now: maxOwned=1 enforcement above prevents second application
        globalMultiplier *= item.effect.multiplier || 2;
        break;
      case 'golden_goat':
        // [V6 FIX C-5] Was: autoClickRate += 2 (stacked to 6, 8...)
        // Now: maxOwned=1 enforcement above prevents second application
        hasGoat = true;
        maxCombo = Math.max(maxCombo, item.effect.maxCombo || 25);
        autoClickRate += item.effect.autoClick || 2;
        break;
      case 'lucky':
        hasLucky = true;
        luckyChance = Math.max(luckyChance, item.effect.chance || 0.15);
        luckyMultiplier = Math.max(luckyMultiplier, item.effect.multiplier || 2);
        break;
      // Season 3 NFT-Enhancing Items (one-time, deduplicated)
      case 'prestige_star':
        if (!hasPrestigeStar) {
          hasPrestigeStar = true;
          clickMultiplier *= item.effect.clickMultiplier || 3;
        }
        break;
      case 'emerald_core':
        if (!hasEmeraldCore) {
          hasEmeraldCore = true;
          gpsMultiplier *= item.effect.gpsMultiplier || 3;
          unlocksOres = true;
        }
        break;
      case 'ancient_relic':
        if (!hasAncientRelic) {
          hasAncientRelic = true;
          expeditionMultiplier *= item.effect.expeditionMultiplier || 2;
        }
        break;
      case 'phoenix_flame':
        if (!hasPhoenixFlame) {
          hasPhoenixFlame = true;
          maxCombo = Math.max(maxCombo, item.effect.maxCombo || 35);
          noComboDecay = true;
        }
        break;
    }
  });

  return { 
    bonusClick, bonusPassive, hasCrown, hasGoat, hasLucky, maxCombo, activeBoost, 
    globalMultiplier, luckyChance, luckyMultiplier, autoClickRate,
    hasPrestigeStar, clickMultiplier, hasEmeraldCore, gpsMultiplier, unlocksOres,
    hasAncientRelic, expeditionMultiplier, hasPhoenixFlame, noComboDecay,
  };
}

// ============ MINE VISUALIZATION COMPONENT ============
function MineVisualization({ 
  upgrades, 
  bonuses,
  level,
  verifiedPurchases
}: { 
  upgrades: typeof INITIAL_UPGRADES;
  bonuses: ReturnType<typeof calculateVerifiedBonuses>;
  level: number;
  verifiedPurchases: OnChainPurchase[];
}) {
  const totalUpgrades = Object.values(upgrades).reduce((sum, u) => sum + u.owned, 0);
  const hasGoat = bonuses.hasGoat;
  const hasLucky = bonuses.hasLucky;
  const hasCrown = bonuses.hasCrown;
  const globalMultiplier = bonuses.globalMultiplier;
  const mineCount = globalMultiplier > 1 ? Math.floor(globalMultiplier) + 1 : 1;
  
  // Check for diamond mine (high passive bonus)
  const hasDiamondMine = verifiedPurchases.some(p => 
    p.itemId === 'diamond_mine' || p.bgBurned >= 0.5
  );
  
  // Check for inferno (fire effect)
  const hasInferno = verifiedPurchases.some(p => 
    p.itemId === 'inferno_boost'
  );
  
  const levelNames = ['Starter', 'Basic', 'Improved', 'Advanced', 'Professional', 'Industrial', 'Mega', 'Ultimate', 'Legendary', 'Mythical'];
  const mineLevel = Math.floor(totalUpgrades / 3) + 1;
  const mineLevelName = levelNames[Math.min(mineLevel - 1, levelNames.length - 1)];
  
  const hasS2Items = mineCount > 1 || hasGoat || hasDiamondMine || hasInferno;
  
  if (totalUpgrades === 0 && mineCount <= 1 && !hasGoat && !hasLucky && !hasDiamondMine && !hasInferno) {
    return (
      <div className="space-y-6">
        <div className="p-6 bg-gradient-to-b from-[#2a1a0a] to-[#1a0f05] rounded-xl border border-[#3d2817]">
          <div className="text-center text-lg text-[#D4AF37] mb-4">⛏️ Your Mine</div>
          <div className="text-center text-gray-500 py-8">
            <div className="text-4xl mb-4">🏗️</div>
            <p>Buy upgrades to build your mine!</p>
            <p className="text-xs mt-2 text-gray-600">Your mine will grow as you purchase upgrades</p>
          </div>
        </div>
        
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card-dark p-4 text-center">
            <div className="text-gray-500 text-xs">Total Upgrades</div>
            <div className="text-2xl font-bold text-[#D4AF37]">{totalUpgrades}</div>
          </div>
          <div className="card-dark p-4 text-center">
            <div className="text-gray-500 text-xs">Mine Level</div>
            <div className="text-2xl font-bold text-purple-400">{mineLevel}</div>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Mine Header */}
      <div className={`p-4 rounded-xl ${
        hasS2Items 
          ? 'bg-gradient-to-r from-purple-900/30 to-indigo-900/30 border border-purple-500/30' 
          : 'bg-gradient-to-r from-[#2a1a0a] to-[#1a0f05] border border-[#3d2817]'
      }`}>
        <div className="text-center text-lg text-[#D4AF37] mb-2 flex items-center justify-center gap-2 flex-wrap">
          {mineCount > 1 && <span className="text-purple-400 text-xs bg-purple-500/20 px-2 py-0.5 rounded-full animate-pulse">{mineCount}x MINES</span>}
          <span>⛏️ {mineLevelName} Mine (Lvl {mineLevel})</span>
          {hasGoat && <span className="text-yellow-400">🐐</span>}
          {hasLucky && <span className="text-emerald-400">🍀</span>}
          {hasDiamondMine && <span className="text-cyan-400">💎</span>}
          {hasInferno && <span className="text-orange-400">🔥</span>}
          {hasCrown && <span className="text-yellow-400">👑</span>}
        </div>
      </div>
      
      {/* Mine Visualization */}
      <div className={`relative h-64 rounded-xl overflow-hidden ${
        hasS2Items 
          ? 'bg-gradient-to-b from-[#1a0a20] to-[#0f0518] border-2 border-purple-500/30' 
          : 'bg-gradient-to-b from-[#2a1a0a] to-[#0f0a03] border border-[#3d2817]'
      }`}>
        {/* Background grid */}
        <div className="absolute inset-0 opacity-20" style={{
          background: `
            repeating-linear-gradient(90deg, transparent, transparent 20px, rgba(60, 40, 20, 0.3) 20px, rgba(60, 40, 20, 0.3) 21px),
            repeating-linear-gradient(0deg, transparent, transparent 20px, rgba(60, 40, 20, 0.2) 20px, rgba(60, 40, 20, 0.2) 21px)
          `
        }} />
        
        {/* Multiple Mine Shafts */}
        {mineCount > 1 && (
          <div className="absolute inset-0 flex justify-around items-end pb-4 opacity-60">
            {Array.from({ length: Math.min(mineCount, 4) }).map((_, i) => (
              <div key={`shaft-${i}`} className="flex flex-col items-center">
                <div className="w-10 h-20 bg-gradient-to-b from-purple-900/50 to-black rounded-t-lg border-2 border-purple-500/30" 
                  style={{ animation: 'pulse 2s ease-in-out infinite', animationDelay: `${i * 0.5}s` }}>
                  <div className="w-full h-2 bg-purple-500/40 mt-2"></div>
                  <div className="w-full h-2 bg-purple-500/30 mt-3"></div>
                </div>
                <span className="text-2xl mt-1" style={{ filter: 'drop-shadow(0 0 8px rgba(168, 85, 247, 0.8))' }}>🏔️</span>
              </div>
            ))}
          </div>
        )}
        
        {/* Diamond Mine sparkles */}
        {hasDiamondMine && (
          <div className="absolute inset-0 pointer-events-none">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={`diamond-${i}`}
                className="absolute text-lg animate-pulse"
                style={{
                  left: `${5 + Math.random() * 90}%`,
                  top: `${5 + Math.random() * 90}%`,
                  animationDelay: `${Math.random() * 2}s`,
                  filter: 'drop-shadow(0 0 8px rgba(6, 182, 212, 0.8))'
                }}
              >💎</div>
            ))}
          </div>
        )}
        
        {/* Lucky Clovers - shows from Lucky Strike upgrades OR shop item */}
        {/* Number of clovers scales with upgrades, capped at 12 for visuals */}
        {(hasLucky || upgrades.luckyStrike.owned > 0) && (
          <div className="absolute inset-0 pointer-events-none">
            {Array.from({ length: Math.min(Math.max(upgrades.luckyStrike.owned, hasLucky ? 4 : 0), 12) }).map((_, i) => (
              <div
                key={`clover-${i}`}
                className="absolute text-sm animate-pulse"
                style={{
                  left: `${10 + Math.random() * 80}%`,
                  top: `${10 + Math.random() * 80}%`,
                  animationDelay: `${Math.random() * 2}s`,
                  filter: 'drop-shadow(0 0 6px rgba(16, 185, 129, 0.8))'
                }}
              >🍀</div>
            ))}
          </div>
        )}
        
        {/* Inferno flames */}
        {hasInferno && (
          <div className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={`flame-${i}`}
                className="absolute text-2xl animate-bounce"
                style={{
                  left: `${i * 10 + Math.random() * 5}%`,
                  bottom: `${Math.random() * 20}px`,
                  animationDelay: `${Math.random()}s`,
                  filter: 'drop-shadow(0 0 10px rgba(249, 115, 22, 0.8))'
                }}
              >🔥</div>
            ))}
          </div>
        )}
        
        {/* Golden Goat mascot */}
        {hasGoat && (
          <div className="absolute bottom-6 left-0 right-0">
            <span 
              className="absolute text-3xl"
              style={{ 
                animation: 'bounce 2s infinite',
                left: '50%',
                transform: 'translateX(-50%)',
                filter: 'drop-shadow(0 0 12px rgba(251, 191, 36, 0.9))'
              }}
            >🐐</span>
          </div>
        )}
        
        {/* Gold veins */}
        <div className="absolute inset-0">
          {Array.from({ length: Math.min(totalUpgrades * 2, 20) }).map((_, i) => (
            <div
              key={`vein-${i}`}
              className="absolute rounded-full animate-pulse"
              style={{
                left: `${10 + Math.random() * 80}%`,
                top: `${10 + Math.random() * 80}%`,
                width: `${6 + Math.random() * 6}px`,
                height: `${6 + Math.random() * 6}px`,
                background: hasDiamondMine 
                  ? 'radial-gradient(circle, #06B6D4 0%, #0891B2 70%, transparent 100%)'
                  : 'radial-gradient(circle, #D4AF37 0%, #996515 70%, transparent 100%)',
                animationDelay: `${Math.random() * 2}s`,
              }}
            />
          ))}
        </div>
        
        {/* Miners walking */}
        {upgrades.miner.owned > 0 && (
          <div className="absolute bottom-8 left-0 right-0">
            {Array.from({ length: Math.min(Math.ceil(upgrades.miner.owned / 2), 10) }).map((_, i) => (
              <span
                key={`miner-${i}`}
                className="absolute text-xl"
                style={{
                  animation: `slide ${5 + i * 0.5}s linear infinite`,
                  animationDelay: `${i * 1.2}s`,
                }}
              >👷</span>
            ))}
          </div>
        )}
        
        {/* Pickaxes scattered */}
        {upgrades.pickaxe.owned > 0 && (
          <div className="absolute inset-0 pointer-events-none">
            {Array.from({ length: Math.min(Math.ceil(upgrades.pickaxe.owned / 2), 15) }).map((_, i) => (
              <span
                key={`pick-${i}`}
                className="absolute text-lg"
                style={{
                  left: `${10 + (i * 12) % 80}%`,
                  top: `${15 + (i * 17) % 55}%`,
                  transform: `rotate(${-30 + i * 8}deg)`,
                  opacity: 0.85,
                }}
              >⛏️</span>
            ))}
          </div>
        )}
        
        {/* Drills working */}
        {upgrades.drill.owned > 0 && (
          <div className="absolute bottom-12 left-0 right-0">
            {Array.from({ length: Math.min(Math.ceil(upgrades.drill.owned / 2), 12) }).map((_, i) => (
              <span
                key={`drill-${i}`}
                className="absolute text-lg animate-pulse"
                style={{
                  left: `${5 + i * 8}%`,
                  animationDelay: `${i * 0.2}s`,
                }}
              >🔧</span>
            ))}
          </div>
        )}
        
        {/* Gold mines from upgrades */}
        {upgrades.goldmine.owned > 0 && !hasDiamondMine && (
          <div className="absolute bottom-4 right-4 flex gap-1">
            {Array.from({ length: Math.min(Math.ceil(upgrades.goldmine.owned / 2), 6) }).map((_, i) => (
              <span key={`gm-${i}`} className="text-xl animate-pulse">🏔️</span>
            ))}
          </div>
        )}
        
        {/* Excavators */}
        {upgrades.excavator.owned > 0 && (
          <div className="absolute bottom-4 left-4 flex gap-1 flex-wrap" style={{ maxWidth: '40%' }}>
            {Array.from({ length: Math.min(Math.ceil(upgrades.excavator.owned / 2), 8) }).map((_, i) => (
              <span key={`ex-${i}`} className="text-xl">🚜</span>
            ))}
          </div>
        )}
        
        {/* Dynamite explosions */}
        {upgrades.dynamite.owned > 0 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-2 flex-wrap justify-center" style={{ maxWidth: '60%' }}>
            {Array.from({ length: Math.min(Math.ceil(upgrades.dynamite.owned / 2), 8) }).map((_, i) => (
              <span key={`dy-${i}`} className="text-lg animate-bounce" style={{ animationDelay: `${i * 0.1}s` }}>🧨</span>
            ))}
          </div>
        )}
        
        {/* Gold particles floating up */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {Array.from({ length: Math.min(Math.floor(Object.values(upgrades).reduce((s, u) => s + u.owned * u.perSec, 0) / 10) + totalUpgrades, 15) }).map((_, i) => (
            <div
              key={`particle-${i}`}
              className="absolute w-2 h-2 rounded-full"
              style={{
                left: `${10 + Math.random() * 80}%`,
                bottom: '-10px',
                background: hasDiamondMine ? '#06B6D4' : '#D4AF37',
                animation: `floatUp ${3 + Math.random() * 2}s linear infinite`,
                animationDelay: `${Math.random() * 3}s`,
              }}
            />
          ))}
        </div>
      </div>
      
      {/* Mine Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card-dark p-4 text-center">
          <div className="text-gray-500 text-xs">Total Upgrades</div>
          <div className="text-2xl font-bold text-[#D4AF37]">{totalUpgrades}</div>
        </div>
        <div className="card-dark p-4 text-center">
          <div className="text-gray-500 text-xs">Mine Level</div>
          <div className="text-2xl font-bold text-purple-400">{mineLevel}</div>
        </div>
        <div className="card-dark p-4 text-center">
          <div className="text-gray-500 text-xs">Miners</div>
          <div className="text-2xl font-bold text-orange-400">{upgrades.miner.owned}</div>
        </div>
        <div className="card-dark p-4 text-center">
          <div className="text-gray-500 text-xs">Gold/Sec</div>
          <div className="text-2xl font-bold text-green-400">
            +{Object.values(upgrades).reduce((sum, u) => sum + u.owned * u.perSec, 0)}
          </div>
        </div>
      </div>
      
      {/* Upgrade breakdown */}
      <div className="card-dark p-4">
        <h4 className="text-[#D4AF37] font-bold mb-3">Your Workers & Equipment</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {Object.entries(upgrades).filter(([_, u]) => u.owned > 0).map(([key, upgrade]) => (
            <div key={key} className="flex items-center justify-between bg-black/30 rounded-lg p-2">
              <span className="flex items-center gap-2">
                <span>{upgrade.emoji}</span>
                <span className="text-gray-300">{upgrade.name}</span>
              </span>
              <span className="text-[#D4AF37] font-mono">x{upgrade.owned}</span>
            </div>
          ))}
        </div>
        {Object.values(upgrades).every(u => u.owned === 0) && (
          <div className="text-center text-gray-500 py-4">No upgrades purchased yet</div>
        )}
      </div>
    </div>
  );
}

// ============ MAIN MINER COMPONENT ============
export default function MinerGame({ address, tokenId, onNoNFT, userNFTs, initialView = 'game' }: { 
  address: string; 
  tokenId: number | null;
  onNoNFT?: () => void;
  userNFTs?: number[];
  initialView?: 'game' | 'shop' | 'war';
}) {
  // Game State
  const [gold, setGold] = useState(0);
  const [totalClicks, setTotalClicks] = useState(0);
  const [totalGoldEarned, setTotalGoldEarned] = useState(0);
  const [upgrades, setUpgrades] = useState(INITIAL_UPGRADES);
  const [combo, setCombo] = useState(1);
  const [lastClickTime, setLastClickTime] = useState(0);
  // [S3 LAUNCH] Client-side CPS throttle — prevents external autoclickers from generating gold
  // Server clamps on save too, but this stops gold accumulation at the source
  const clickTimestampsRef = useRef<number[]>([]);
  const CLIENT_CPS_LIMIT = 5;
  const [isSubmittingScore, setIsSubmittingScore] = useState(false);
  const [lastSaveStatus, setLastSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [lastSaveTime, setLastSaveTime] = useState(0);
  const [saveTick, setSaveTick] = useState(0); // Forces re-render for save timer display
  const [boostTick, setBoostTick] = useState(0); // Forces re-render for boost countdown
  const [hasLoadedGame, setHasLoadedGame] = useState(false);
  const [activeTokenId, setActiveTokenId] = useState<number | null>(tokenId);
  const [offlineEarnings, setOfflineEarnings] = useState<{ gold: number; time: string } | null>(null);
  
  // ============ SEASON 3 STATE ============
  // Expedition state
  const [activeExpedition, setActiveExpedition] = useState<ActiveExpedition | null>(null);
  const [completedExpeditions, setCompletedExpeditions] = useState(0);
  const [legendaryExpeditions, setLegendaryExpeditions] = useState(0);
  const [expeditionGpsBonus, setExpeditionGpsBonus] = useState(0);
  const [expeditionTempMultiplier, setExpeditionTempMultiplier] = useState<{ multiplier: number; endTime: number } | null>(null);
  
  // Achievement state
  const [achievements, setAchievements] = useState<AchievementState>({});
  const [achievementPopupQueue, setAchievementPopupQueue] = useState<AchievementDef[]>([]);
  const [maxComboReached, setMaxComboReached] = useState(0);
  
  // Daily challenges state
  const [dailyChallengeState, setDailyChallengeState] = useState<DailyChallengeState>({
    dayKey: getTodayKey(),
    challenges: [],
    dailyClicks: 0,
    dailyGoldEarned: 0,
    dailyUpgradesBought: 0,
    dailyMaxCombo: 0,
  });
  
  // Login streak state
  const [loginStreak, setLoginStreak] = useState<LoginStreakState>({
    lastLoginDay: '',
    currentStreak: 0,
    longestStreak: 0,
    streakRewardClaimed: false,
  });
  
  // Gold Rush event state
  const [goldRushActive, setGoldRushActive] = useState(false);
  const [goldRushEndTime, setGoldRushEndTime] = useState(0);
  const [goldRushTick, setGoldRushTick] = useState(0);
  
  // Mini-Boss state
  const [activeBoss, setActiveBoss] = useState<{ id: string; name: string; emoji: string; hp: number; reward: number; color: string } | null>(null);
  const [clicksSinceLastBoss, setClicksSinceLastBoss] = useState(0);
  const [bossesDefeated, setBossesDefeated] = useState(0);
  
  // ============ SEASON 3 v2: NEW GAMEPLAY STATE ============
  // War Chest (replaces prestige)
  const [warChest, setWarChest] = useState<WarChestState>(INITIAL_WAR_CHEST);
  
  // Mine Raids
  const [raidState, setRaidState] = useState<RaidState>(INITIAL_RAID_STATE);

  // ── Live refs for war/achievement state ──
  // These are updated SYNCHRONOUSLY inside every mutation handler so saves always
  // have the latest data regardless of React batching / re-render timing.
  const raidStateRef = useRef<RaidState>(INITIAL_RAID_STATE);
  const warChestRef = useRef<WarChestState>(INITIAL_WAR_CHEST);
  const achievementsRef = useRef<AchievementState>({});

  // Helper: update raidState + ref atomically
  const setRaidStateSync = useCallback((updater: (prev: RaidState) => RaidState) => {
    setRaidState(prev => {
      const next = updater(prev);
      raidStateRef.current = next;
      return next;
    });
  }, []);

  // Helper: update warChest + ref atomically  
  const setWarChestSync = useCallback((updater: (prev: WarChestState) => WarChestState) => {
    setWarChest(prev => {
      const next = updater(prev);
      warChestRef.current = next;
      return next;
    });
  }, []);
  const [targetBGMap, setTargetBGMap] = useState<Record<number, number>>({});
  const [playerWallHP, setPlayerWallHP] = useState(0);
  const [ethWallsBought, setEthWallsBought] = useState(0);
  const [ethWallHP, setEthWallHP] = useState(0);
  const [goldWallsBuilt, setGoldWallsBuilt] = useState(0);
  const [playerCatapults, setPlayerCatapults] = useState(0);
  const [isUnderAttack, setIsUnderAttack] = useState(false);
  const [recentAttackCount, setRecentAttackCount] = useState(0);
  const [raidInProgress, setRaidInProgress] = useState(false);
  
  // Tutorial
  const [showTutorial, setShowTutorial] = useState(true); // GameTutorial checks localStorage internally

  // Season Rewards
  const [seasonRewards, setSeasonRewards] = useState<{
    hasRewards: boolean;
    season: string;
    playerData: any;
    poolMicroBG: number;
    poolBG: string;
    totalPlayers: number;
    snapshotTime: number;
  } | null>(null);
  const [showSeasonClaim, setShowSeasonClaim] = useState(false);
  
  // MineSwap trade pickaxe
  const [mineswapTradeCount, setMineswapTradeCount] = useState(0);
  
  // Active clicking tracker (for clover spawning)
  const [isActivelyClicking, setIsActivelyClicking] = useState(false);
  const lastActiveClickRef = useRef(0);
  
  // Ore effects enhancement
  const [clickEffects, setClickEffects] = useState<Array<{ id: number; x: number; y: number; amount: number; isCrit: boolean; oreEmoji?: string; oreColor?: string }>>([]); 
  
  // ============ HANDLE MINE SWITCHING ============
  // When tokenId prop changes (user switches mines), save current progress and load new mine
  const prevTokenIdRef = useRef<number | null>(tokenId);
  // Store current gold/clicks in ref for access during switch
  const currentGameRef = useRef({ gold: 0, totalClicks: 0, totalGoldEarned: 0, upgrades: INITIAL_UPGRADES });
  // Track loaded values to compare against before saving (defined early for mine switching)
  const loadedGameRef = useRef<{ gold: number; totalClicks: number; upgrades: any } | null>(null);
  
  // Keep currentGameRef updated
  useEffect(() => {
    currentGameRef.current = { gold, totalClicks, totalGoldEarned, upgrades };
  }, [gold, totalClicks, totalGoldEarned, upgrades]);
  
  useEffect(() => {
    // Skip if tokenId hasn't actually changed
    if (prevTokenIdRef.current === tokenId) return;
    
    const switchMine = async () => {
      // Save current mine's progress before switching (if we have one)
      if (prevTokenIdRef.current && hasLoadedGame && address) {
        const state = currentGameRef.current;
        try {
          await fetch('/api/game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              address,
              tokenId: prevTokenIdRef.current,
              gameState: {
                gold: state.gold,
                totalClicks: state.totalClicks,
                totalGoldEarned: state.totalGoldEarned,
                upgrades: state.upgrades,
              },
            }),
          });
          console.log(`Saved Mine #${prevTokenIdRef.current} before switching`);
        } catch (e) {
          console.error('Failed to save before switch:', e);
        }
      }
      
      // Reset game state for fresh load
      setGold(0);
      setTotalClicks(0);
      setTotalGoldEarned(0);
      setUpgrades(INITIAL_UPGRADES);
      setHasLoadedGame(false);
      loadedGameRef.current = null;
      
      // Update to new tokenId
      prevTokenIdRef.current = tokenId;
      setActiveTokenId(tokenId);
    };
    
    switchMine();
  }, [tokenId, address, hasLoadedGame]);
  
  // UI State
  const [activeView, setActiveView] = useState<'game' | 'shop' | 'war' | 'expeditions' | 'progress'>(initialView || 'game');
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  // Sync activeView with initialView prop when it changes (for top-level Shop tab)
  useEffect(() => {
    setActiveView(initialView);
  }, [initialView]);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<typeof SHOP_ITEMS[0] | null>(null);
  const [buyEthLoading, setBuyEthLoading] = useState(false);
  
  // On-chain State
  const [verifiedPurchases, setVerifiedPurchases] = useState<OnChainPurchase[]>([]);
  const [burnCount, setBurnCount] = useState(0);
  const [totalBurned, setTotalBurned] = useState(0);
  const [isLoadingPurchases, setIsLoadingPurchases] = useState(true);
  
  // Purchase History (detailed receipts from BaseScan)
  const [purchaseHistory, setPurchaseHistory] = useState<any>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [showPurchaseHistory, setShowPurchaseHistory] = useState(false);
  
  // Contract Writes
  const { writeContract: buyAndBurn, data: burnTxHash, isPending: isBurning } = useWriteContract();
  const { isLoading: isBurnConfirming, isSuccess: isBurnConfirmed } = useWaitForTransactionReceipt({ hash: burnTxHash });
  // [V5 FIX] Track which tx hashes have already credited items.
  // Without this, changing selectedItem while isBurnConfirmed=true from a previous
  // purchase re-fires the useEffect and credits the NEW item for free.
  const processedBurnTxRef = useRef<Set<string>>(new Set());
  
  // Signing for leaderboard and session
  const { signMessageAsync } = useSignMessage();
  
  const effectIdRef = useRef(0);

  // ============ CALCULATED VALUES ============
  const level = calculateLevel(totalGoldEarned);
  const xpProgress = getXPProgress(totalGoldEarned, level);
  const bonuses = useMemo(() => calculateVerifiedBonuses(verifiedPurchases, Date.now()), [verifiedPurchases, boostTick]);
  
  // Season 3 v2: Trade pickaxe tier
  const tradePickaxe = useMemo(() => getTradePickaxeTier(mineswapTradeCount), [mineswapTradeCount]);
  
  // Season 3 v2: Mine theme based on level
  const mineTheme = useMemo(() => getMineTheme(level), [level]);
  
  // Season 3 v2: Environmental events
  const activeEvent = useMineEvents({
    onEventStart: useCallback((evt: ActiveMineEvent) => {
      console.log('[EVENT] Started:', evt.event.name);
    }, []),
    onEventEnd: useCallback((evt: ActiveMineEvent) => {
      console.log('[EVENT] Ended:', evt.event.name);
      // Cave-In bonus gold on end
      if (evt.event.effect.bonusGoldOnEnd) {
        const bonus = Math.floor(evt.event.effect.bonusGoldOnEnd * (1 + level * 0.1));
        setGold(g => {
          const newGold = g + bonus;
          gameStateRef.current.gold = newGold;
          return newGold;
        });
        setTotalGoldEarned(t => {
          const newTotal = t + bonus;
          gameStateRef.current.totalGoldEarned = newTotal;
          return newTotal;
        });
      }
    }, [level]),
    hasLoadedGame,
    testMode: TEST_MODE,
  });
  
  // Season 3 v2: Event effect multipliers (live)
  const eventClickMult = activeEvent?.event.effect.clickMultiplier || 1;
  const eventGpsMult = activeEvent?.event.effect.gpsMultiplier || 1;
  const eventNoComboDecay = activeEvent?.event.effect.noComboDecay || false;
  const eventCritBoost = activeEvent?.event.effect.critChanceBoost || 0;
  
  // Season 3 v2: War Chest vault bonuses (milestone rewards)
  const vaultBonuses = useMemo(() => getVaultBonuses(warChest.totalVaulted), [warChest.totalVaulted]);
  
  const basePerClick = useMemo(() => {
    let base = 1;
    Object.values(upgrades).forEach(u => { base += u.owned * u.perClick; });
    return (base + bonuses.bonusClick) * bonuses.clickMultiplier * tradePickaxe.clickMultiplier * (1 + vaultBonuses.clickBonus);
  }, [upgrades, bonuses.bonusClick, bonuses.clickMultiplier, tradePickaxe.clickMultiplier, vaultBonuses.clickBonus]);
  
  const basePerSecond = useMemo(() => {
    let base = 0;
    Object.values(upgrades).forEach(u => { base += u.owned * u.perSec; });
    return (base + bonuses.bonusPassive) * bonuses.gpsMultiplier * tradePickaxe.gpsMultiplier * (1 + vaultBonuses.gpsBonus);
  }, [upgrades, bonuses.bonusPassive, bonuses.gpsMultiplier, tradePickaxe.gpsMultiplier, vaultBonuses.gpsBonus]);
  
  // Calculate luck stats from UPGRADES (Lucky Strike)
  // Each Lucky Strike owned = 1% crit chance (100 upgrades = 100% crit!)
  // Crit multiplier = 2x (100% bonus — nerfed in V5)
  const upgradeLuckyChance = useMemo(() => {
    const luckyStrike = upgrades.luckyStrike;
    if (!luckyStrike || luckyStrike.owned === 0) return 0;
    // 1% per owned - 100 upgrades = 100% crit rate
    return luckyStrike.owned * 0.01;
  }, [upgrades.luckyStrike]);
  
  const upgradeLuckyMultiplier = useMemo(() => {
    const luckyStrike = upgrades.luckyStrike;
    if (!luckyStrike || luckyStrike.owned === 0) return 1;
    // 2x multiplier from luckBonus (100% bonus)
    return luckyStrike.luckBonus || 2;
  }, [upgrades.luckyStrike]);
  
  // Combined luck: 
  // - Chance STACKS (upgrades + shop item) - rewards grinding AND purchases
  // - Multiplier takes BEST (max) - shop item gives the big hits
  const effectiveLuckyChance = Math.min(bonuses.luckyChance + upgradeLuckyChance, 1); // Cap at 100%
  const effectiveLuckyMultiplier = Math.max(bonuses.luckyMultiplier, upgradeLuckyMultiplier);
  
  const maxCombo = bonuses.maxCombo;
  const boostMultiplier = bonuses.activeBoost?.multiplier || 1;
  const globalMultiplier = bonuses.globalMultiplier;

  // Tick boost countdown every second while a boost is active
  useEffect(() => {
    if (!bonuses.activeBoost) return;
    const interval = setInterval(() => setBoostTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [!!bonuses.activeBoost]);

  // ============ LOAD GAME & ON-CHAIN DATA ============
  useEffect(() => {
    if (!address) return;
    // Need tokenId to load NFT-specific data
    if (!activeTokenId) {
      // Call onNoNFT if provided
      if (onNoNFT) onNoNFT();
      return;
    }
    
    const loadData = async () => {
      setIsLoadingPurchases(true);
      
      // Redis-stored purchases fallback (populated from API response below)
      let serverPurchases: OnChainPurchase[] = [];
      
      // Load saved game for this specific NFT
      try {
        console.log('[LOAD] Fetching game state for NFT #', activeTokenId);
        const res = await fetch(`/api/game?address=${address}&tokenId=${activeTokenId}`);
        const data = await res.json();
        
        console.log('[LOAD] Server response:', JSON.stringify({
          hasGameState: !!data.gameState,
          gold: data.gameState?.gold,
          clicks: data.gameState?.totalClicks,
          gps: data.gameState?.goldPerSecond,
          lastSaved: data.gameState?.lastSaved ? new Date(data.gameState.lastSaved).toISOString() : null,
          offlineGold: data.offlineGold,
          offlineMinutes: data.offlineMinutes,
          savedPurchases: data.savedPurchases?.length || 0,
        }));
        
        // Redis-stored purchases as fallback when free RPC getLogs fails
        serverPurchases = (data.savedPurchases || []).map((p: any) => ({
          itemId: p.itemId,
          ethAmount: p.ethSpent || p.ethAmount || '0',
          bgBurned: 0,
          timestamp: p.timestamp || 0,
          txHash: p.txHash || '',
        }));
        
        if (data.notOwner) {
          console.error('You do not own this NFT');
          if (onNoNFT) onNoNFT();
          return;
        }
        
        if (data.gameState) {
          // ═══ SEASON RESET DETECTION ═══
          // If the save has seasonReset flag, clear ALL localStorage backups
          // This prevents old cached data from overwriting the fresh season state
          const isSeasonReset = !!data.gameState.seasonReset;
          if (isSeasonReset) {
            console.log('[SEASON RESET] Detected season reset flag:', data.gameState.seasonReset);
            // Set ack flag so saves include it — server requires this to allow post-reset saves
            seasonResetAckRef.current = true;
            try {
              // Clear all possible backup keys
              for (let i = 0; i < 50; i++) {
                localStorage.removeItem(`bg_backup_${i}`);
              }
              localStorage.removeItem(`bg_backup_${activeTokenId}`);
              console.log('[SEASON RESET] Cleared all localStorage backups');
            } catch (e) { /* localStorage might not be available */ }
          }
          
          const loadedGold = data.gameState.gold || 0;
          const loadedClicks = data.gameState.totalClicks || 0;
          const loadedUpgrades = data.gameState.upgrades || {};
          
          console.log('[LOAD] Setting state - gold:', loadedGold, 'clicks:', loadedClicks);
          setGold(loadedGold);
          setTotalClicks(loadedClicks);
          setTotalGoldEarned(data.gameState.totalGoldEarned || 0);
          
          // Deep merge upgrades - ONLY load 'owned' count from saved state.
          // All other fields (cost, perSec, perClick, maxOwned) come from INITIAL_UPGRADES.
          // [V5 FIX] Previously did { ...INITIAL, ...saved } which let inflated costs
          // from Burp Suite or stale saves override base values.
          if (data.gameState.upgrades) {
            const mergedUpgrades = { ...INITIAL_UPGRADES };
            Object.keys(data.gameState.upgrades).forEach(key => {
              if (mergedUpgrades[key as keyof typeof mergedUpgrades]) {
                const saved = data.gameState.upgrades[key];
                const base = mergedUpgrades[key as keyof typeof mergedUpgrades];
                // Only trust 'owned' from save — recalculate cost from base
                const owned = Math.min(saved?.owned || 0, base.maxOwned);
                const cost = Math.floor(base.cost * Math.pow(base.multiplier, owned));
                (mergedUpgrades as any)[key] = {
                  ...base,
                  owned,
                  cost,
                };
              }
            });
            setUpgrades(mergedUpgrades);
          }
          
          // ============ LOAD SEASON 3 DATA ============
          if (data.gameState.s3) {
            const s3 = data.gameState.s3;
            if (s3.activeExpedition) setActiveExpedition(s3.activeExpedition);
            if (s3.completedExpeditions) setCompletedExpeditions(s3.completedExpeditions);
            if (s3.legendaryExpeditions) setLegendaryExpeditions(s3.legendaryExpeditions);
            if (s3.expeditionGpsBonus) setExpeditionGpsBonus(s3.expeditionGpsBonus);
            if (s3.expeditionTempMultiplier) setExpeditionTempMultiplier(s3.expeditionTempMultiplier);
            if (s3.achievements) {
              achievementsRef.current = s3.achievements;
              setAchievements(s3.achievements);
            }
            if (s3.maxComboReached) setMaxComboReached(s3.maxComboReached);
            if (s3.dailyChallengeState) setDailyChallengeState(s3.dailyChallengeState);
            if (s3.loginStreak) setLoginStreak(s3.loginStreak);
            if (s3.bossesDefeated) setBossesDefeated(s3.bossesDefeated);
            // Season 3 v2
            if (s3.warChest) {
              const loadedChest = { ...INITIAL_WAR_CHEST, ...s3.warChest };
              warChestRef.current = loadedChest;
              setWarChest(loadedChest);
            }
            if (s3.raidState) {
              const loadedRaid = {
                ...INITIAL_RAID_STATE,
                ...s3.raidState,
                army: s3.raidState.army || {},
                barracks: s3.raidState.barracks || {},
                trainingQueue: s3.raidState.trainingQueue || [],
                activeRaids: s3.raidState.activeRaids || [],
                completedRaids: s3.raidState.completedRaids || [],
              };
              raidStateRef.current = loadedRaid;
              setRaidState(loadedRaid);
            }
          }
          
          // Show offline earnings if any
          let finalGold = loadedGold;
          if (data.offlineGold > 0) {
            finalGold = loadedGold + data.offlineGold;
            setGold(finalGold);
            setTotalGoldEarned(prev => prev + data.offlineGold);
            
            // Update ref with post-offline gold
            gameStateRef.current.gold = finalGold;
            gameStateRef.current.totalGoldEarned = (gameStateRef.current.totalGoldEarned || 0) + data.offlineGold;
            
            // Show welcome back notification
            const hours = Math.floor((data.offlineMinutes || 0) / 60);
            const mins = (data.offlineMinutes || 0) % 60;
            const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} minutes`;
            setOfflineEarnings({ gold: data.offlineGold, time: timeStr });
            console.log(`Welcome back! Earned ${data.offlineGold.toLocaleString()} gold while away (${timeStr}).`);
            
            // Auto-dismiss after 8 seconds
            setTimeout(() => setOfflineEarnings(null), 8000);
          }
          
          // ============ LOCALSTORAGE RECONCILIATION ============
          // Check if localStorage has more recent data (e.g., user refreshed before server save completed)
          // SKIP if this is a season reset — server state is authoritative
          if (!isSeasonReset) try {
            const backupStr = localStorage.getItem(`bg_backup_${activeTokenId}`);
            if (backupStr) {
              const backup = JSON.parse(backupStr);
              // Only use backup if:
              // 1. Same address and tokenId
              // 2. Backup is from last 30 seconds (recent session)
              // 3. Backup has MORE gold than server (user earned more before refresh)
              const isRecent = (Date.now() - backup.timestamp) < 30000;
              const isSameUser = backup.address === address.toLowerCase() && backup.tokenId === activeTokenId;
              const hasMoreGold = backup.gold > finalGold;
              
              if (isRecent && isSameUser && hasMoreGold) {
                const recoveredGold = backup.gold - finalGold;
                console.log(`[RECOVERY] Found ${recoveredGold.toLocaleString()} unsaved gold in localStorage backup`);
                finalGold = backup.gold;
                setGold(finalGold);
                setTotalGoldEarned(backup.totalGoldEarned || finalGold);
                gameStateRef.current.gold = finalGold;
                gameStateRef.current.totalGoldEarned = backup.totalGoldEarned || finalGold;
                
                // Show recovery notification
                setOfflineEarnings({ gold: recoveredGold, time: 'recovered from backup' });
                setTimeout(() => setOfflineEarnings(null), 5000);
              }
              // Clear old backup after reconciliation
              localStorage.removeItem(`bg_backup_${activeTokenId}`);
            }
          } catch (e) {
            console.warn('localStorage backup check failed:', e);
          }
          
          // Store what we loaded (INCLUDING offline gold + localStorage recovery) so save protection works correctly
          loadedGameRef.current = { gold: finalGold, totalClicks: loadedClicks, upgrades: loadedUpgrades };
          console.log('[LOAD] Set loadedGameRef - gold:', finalGold, 'clicks:', loadedClicks);
        } else {
          // New player - no saved data for this NFT
          loadedGameRef.current = { gold: 0, totalClicks: 0, upgrades: {} };
          console.log('[LOAD] New player - set loadedGameRef to zeros');
        }
      } catch (e) {
        console.error('Load game error:', e);
        // CRITICAL: Still set loadedGameRef so saves can work, but with zeros
        // This allows a new player to start playing even if load fails
        loadedGameRef.current = { gold: 0, totalClicks: 0, upgrades: {} };
        console.log('[LOAD] Error occurred - set loadedGameRef to zeros to allow saving');
      }
      
      // Load on-chain purchases via server-side API
      // [V11] Scan → Verify → Store: checks Redis cache first, scans blockchain on miss
      try {
        const purchaseRes = await fetch(`/api/purchases?address=${address}`);
        const purchaseData = await purchaseRes.json();
        
        if (purchaseData.purchases && purchaseData.purchases.length > 0) {
          // Filter to only successful purchases for game bonuses
          const successfulPurchases = purchaseData.purchases.filter((p: any) => p.status !== 'failed');
          const purchases: OnChainPurchase[] = successfulPurchases.map((p: any) => ({
            itemId: p.itemId,
            ethAmount: p.ethAmount,
            bgBurned: p.bgBurned || 0,
            timestamp: p.timestamp,
            txHash: p.txHash,
          }));
          
          // Count season burns
          let seasonBurns = 0;
          let seasonBurned = 0;
          purchases.forEach(p => {
            if (p.timestamp >= SEASON_START_TIMESTAMP) {
              seasonBurns++;
              seasonBurned += p.bgBurned;
            }
          });
          
          setVerifiedPurchases(purchases);
          setBurnCount(seasonBurns);
          setTotalBurned(purchaseData.totalBgBurned || seasonBurned);
          console.log(`[PURCHASES] Loaded ${purchases.length} verified purchases via ${purchaseData.source || 'api'}, total BG burned: ${purchaseData.totalBgBurned || seasonBurned}`);
          
          // Save verified purchases to Redis for NFT metadata
          if (activeTokenId) {
            try {
              await fetch('/api/game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  address,
                  tokenId: activeTokenId,
                  savePurchases: true,
                  purchases: purchases.map(p => ({
                    itemId: p.itemId,
                    itemName: SHOP_ITEMS.find(i => i.id === p.itemId)?.name || p.itemId,
                    ethSpent: p.ethAmount,
                    timestamp: p.timestamp,
                    txHash: p.txHash,
                  })),
                }),
              });
            } catch (e) {
              console.error('Failed to save purchases to NFT:', e);
            }
          }
        } else {
          console.log('[PURCHASES] No on-chain purchases found');
          // Fallback: use verified Redis entries
          if (serverPurchases.length > 0) {
            const verifiedOnly = serverPurchases.filter((p: any) => p.verifiedOnChain);
            if (verifiedOnly.length > 0) {
              console.log(`[PURCHASES] Using ${verifiedOnly.length} verified purchases from Redis fallback`);
              setVerifiedPurchases(verifiedOnly);
            }
          }
        }
      } catch (e) {
        console.error('Load purchases error:', e);
        // Fallback: use verified Redis entries
        if (serverPurchases.length > 0) {
          const verifiedOnly = serverPurchases.filter((p: any) => p.verifiedOnChain);
          if (verifiedOnly.length > 0) {
            console.log(`[PURCHASES] API failed, using ${verifiedOnly.length} verified purchases from Redis`);
            setVerifiedPurchases(verifiedOnly);
          }
        }
      }
      
      setIsLoadingPurchases(false);
      
      // ============ SEASON 3 v2: Fetch MineSwap trade count ============
      try {
        const swapCount = await reliableClient.readContract({
          address: MINESWAP_CONTRACTS.tracker as `0x${string}`,
          abi: MINESWAP_TRACKER_ABI,
          functionName: 'userTotalSwaps',
          args: [address as `0x${string}`],
        }) as bigint;
        setMineswapTradeCount(Number(swapCount));
        console.log('[LOAD] MineSwap trades:', Number(swapCount));
      } catch (e) {
        console.log('[LOAD] MineSwap trade count unavailable:', e);
        // Not critical — just means no trade pickaxe bonus
      }
      
      setHasLoadedGame(true); // Mark game as loaded - safe to start saving now
    };
    
    loadData();
  }, [address, activeTokenId]);

  // ============ LOAD BG SMELTER DATA FOR RAID TARGETING ============
  useEffect(() => {
    const loadSmelterMap = async () => {
      try {
        const res = await fetch('/api/smelter?action=all');
        const data = await res.json();
        if (data.success && data.smelters) {
          const map: Record<number, number> = {};
          for (const [tokenId, info] of Object.entries(data.smelters)) {
            // Raid targets show unsmelted BG only (smelted is safe)
            const { unsmelted } = info as { unsmelted: number; smelted: number; total: number };
            // Convert microBG → BG for display
            if (unsmelted > 0) map[parseInt(tokenId)] = unsmelted / 10000;
          }
          setTargetBGMap(map);
        }
      } catch (e) {
        console.warn('[SMELTER] Failed to load smelter data:', e);
      }
    };
    loadSmelterMap();
    // Refresh every 30 seconds (smelter state changes from raids)
    const interval = setInterval(loadSmelterMap, 30_000);
    return () => clearInterval(interval);
  }, []);

  // ============ LOAD WALLS & CATAPULTS ============
  
  // ============ CHECK SEASON REWARDS ============
  useEffect(() => {
    if (!activeTokenId || !hasLoadedGame) return;
    const checkRewards = async () => {
      try {
        const res = await fetch(`/api/season?tokenId=${activeTokenId}`);
        const data = await res.json();
        if (data.success && data.hasRewards) {
          setSeasonRewards({
            hasRewards: true,
            season: data.season,
            playerData: data.playerData,
            poolMicroBG: data.poolMicroBG,
            poolBG: data.poolBG,
            totalPlayers: data.totalPlayers,
            snapshotTime: data.snapshotTime,
          });
          setShowSeasonClaim(true);
        }
      } catch (e) {
        console.warn('[SEASON] Failed to check rewards:', e);
      }
    };
    checkRewards();
  }, [activeTokenId, hasLoadedGame]);

  useEffect(() => {
    if (!activeTokenId) return;
    const loadWarAssets = async () => {
      try {
        // Load walls
        const wallRes = await fetch('/api/war-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_walls', targetTokenId: activeTokenId }),
        });
        const wallData = await wallRes.json();
        if (wallData.success) {
          setPlayerWallHP(wallData.wallHP || 0);
          setEthWallsBought(wallData.ethWallsBought || 0);
          setEthWallHP(wallData.ethWallHP || 0);
          setGoldWallsBuilt(wallData.goldWallsBuilt || 0);
        }

        // Load catapults
        const catRes = await fetch('/api/war-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_catapults', tokenId: activeTokenId }),
        });
        const catData = await catRes.json();
        if (catData.success) setPlayerCatapults(catData.catapults || 0);
      } catch (e) {
        console.warn('[WAR] Failed to load war assets:', e);
      }
    };
    loadWarAssets();
    const interval = setInterval(loadWarAssets, 120_000);
    return () => clearInterval(interval);
  }, [activeTokenId]);

  // ============ AUTO-SAVE ============
  // Use a SINGLE ref pattern - always sync with state for reliable saving
  // CRITICAL: This ref MUST always have current values for saves to work
  const gameStateRef = useRef({ 
    gold: 0, 
    totalClicks: 0, 
    totalGoldEarned: 0, 
    upgrades: INITIAL_UPGRADES, 
    maxCombo: 10, 
    basePerSecond: 0, 
    boostMultiplier: 1, 
    globalMultiplier: 1, 
    autoClickRate: 0,
    // Season 3 data
    activeExpedition: null as ActiveExpedition | null,
    completedExpeditions: 0,
    legendaryExpeditions: 0,
    expeditionGpsBonus: 0,
    expeditionTempMultiplier: null as { multiplier: number; endTime: number } | null,
    achievements: {} as AchievementState,
    maxComboReached: 0,
    dailyChallengeState: null as DailyChallengeState | null,
    loginStreak: null as LoginStreakState | null,
    bossesDefeated: 0,
    // Season 3 v2
    warChest: INITIAL_WAR_CHEST as WarChestState,
    raidState: INITIAL_RAID_STATE as RaidState,
  });
  
  // CRITICAL: Keep gameStateRef ALWAYS in sync with ALL state values
  // This ensures saves always have the latest data
  useEffect(() => {
    gameStateRef.current = {
      ...gameStateRef.current,
      gold,
      totalClicks,
      totalGoldEarned,
      upgrades,
      maxCombo,
      basePerSecond,
      boostMultiplier,
      globalMultiplier,
      autoClickRate: bonuses.autoClickRate,
      // Season 3 data sync
      activeExpedition,
      completedExpeditions,
      legendaryExpeditions,
      expeditionGpsBonus,
      expeditionTempMultiplier,
      achievements,
      maxComboReached,
      dailyChallengeState,
      loginStreak,
      bossesDefeated,
      // Season 3 v2
      warChest,
      raidState,
    };
    console.log('[REF SYNC] Updated ref - gold:', gold, 'clicks:', totalClicks);
  }, [gold, totalClicks, totalGoldEarned, upgrades, maxCombo, basePerSecond, boostMultiplier, globalMultiplier, bonuses.autoClickRate,
      activeExpedition, completedExpeditions, legendaryExpeditions, expeditionGpsBonus, expeditionTempMultiplier,
      achievements, maxComboReached, dailyChallengeState, loginStreak, bossesDefeated, warChest, raidState]);
  
  // Ref to track if component is mounted (for async saves)
  const isMountedRef = useRef(true);
  
  // Season reset acknowledgment — set when client loads a reset state.
  // Included in saves so the server knows this is a fresh post-reset session,
  // not a stale tab trying to overwrite the reset.
  const seasonResetAckRef = useRef(false);
  
  // Save function as ref so it can be called from anywhere
  const saveGameRef = useRef<() => Promise<void>>();
  const triggerSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    // CRITICAL: Don't save until game has fully loaded and we have a tokenId
    if (!address || !hasLoadedGame || !activeTokenId) {
      console.log('[SAVE SETUP] Not ready - address:', !!address, 'hasLoaded:', hasLoadedGame, 'tokenId:', activeTokenId);
      return;
    }
    
    // If loadedGameRef is still null, initialize it (shouldn't happen but safety check)
    if (!loadedGameRef.current) {
      console.log('[SAVE SETUP] loadedGameRef was null - initializing to zeros');
      loadedGameRef.current = { gold: 0, totalClicks: 0, upgrades: {} };
    }
    
    console.log('[SAVE SETUP] Ready - setting up save interval for NFT #', activeTokenId, 'loaded gold:', loadedGameRef.current?.gold);
    
    const saveGame = async () => {
      const state = gameStateRef.current;
      const loaded = loadedGameRef.current;
      
      console.log('[SAVE] Starting - ref gold:', state.gold, 'ref clicks:', state.totalClicks, 'loaded gold:', loaded?.gold);
      
      // PROTECTION 1: Never save if current state is worse than what we loaded
      if (loaded && loaded.gold > 0) {
        if (state.gold === 0 && state.totalClicks === 0) {
          console.warn('[SAVE] BLOCKED: Attempted to save zeros over existing data. loaded:', loaded.gold);
          return;
        }
      }
      
      // PROTECTION 2: Don't save if gold AND upgrades are both zero (uninitialized state)
      const upgradeCount = Object.values(state.upgrades || {}).reduce((sum, u: any) => sum + (u?.owned || 0), 0);
      if (state.gold === 0 && state.totalClicks === 0 && upgradeCount === 0 && loaded && loaded.gold > 0) {
        console.warn('[SAVE] BLOCKED: Uninitialized state, skipping save');
        return;
      }
      
      // CRITICAL FIX: Save actual gold, NOT Math.max
      // Gold legitimately decreases when buying upgrades — that's not data loss
      const goldToSave = state.gold;
      const clicksToSave = Math.max(state.totalClicks, loaded?.totalClicks || 0);
      
      try {
        const res = await fetch('/api/game', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address,
            tokenId: activeTokenId,
            gameState: { 
              gold: goldToSave, 
              totalClicks: clicksToSave, 
              totalGoldEarned: state.totalGoldEarned || goldToSave, 
              upgrades: state.upgrades,
              maxCombo: state.maxCombo,
              autoClickRate: state.autoClickRate || 0,
              goldPerSecond: Math.floor(state.basePerSecond * state.boostMultiplier * state.globalMultiplier),
              // Season reset acknowledgment — tells server this is a fresh post-reset session
              ...(seasonResetAckRef.current ? { seasonResetAck: true } : {}),
              // Season 3 data
              s3: {
                activeExpedition: state.activeExpedition,
                completedExpeditions: state.completedExpeditions,
                legendaryExpeditions: state.legendaryExpeditions,
                expeditionGpsBonus: state.expeditionGpsBonus,
                expeditionTempMultiplier: state.expeditionTempMultiplier,
                achievements: achievementsRef.current,
                maxComboReached: state.maxComboReached,
                dailyChallengeState: state.dailyChallengeState,
                loginStreak: state.loginStreak,
                bossesDefeated: state.bossesDefeated,
                // Season 3 v2 — use live refs so React batching can't cause stale saves
                warChest: warChestRef.current,
                raidState: raidStateRef.current,
              },
            },
          }),
        });
        
        const data = await res.json();
        console.log('[SAVE] Server response:', data.success ? 'SUCCESS' : data.error || 'FAILED');
        
        if (data.success) {
          if (isMountedRef.current) {
            setLastSaveStatus('success');
            setLastSaveTime(Date.now());
          }
          // Update loaded ref on successful save (this is now the baseline)
          loadedGameRef.current = { gold: goldToSave, totalClicks: clicksToSave, upgrades: state.upgrades };
          // Clear ack flag — server has cleared seasonReset, no need to keep sending it
          if (seasonResetAckRef.current) {
            seasonResetAckRef.current = false;
            console.log('[SAVE] Season reset ack cleared after successful save');
          }
        } else if (data.rateLimited) {
          console.log('[SAVE] Rate limited - will retry');
        } else if (data.blocked) {
          console.warn('[SAVE] Server blocked:', data.error);
        } else {
          console.error('[SAVE] Failed:', data.error);
          if (isMountedRef.current) setLastSaveStatus('error');
        }
      } catch (e) {
        console.error('[SAVE] Error:', e);
        if (isMountedRef.current) setLastSaveStatus('error');
      }
    };
    
    // Store saveGame in ref so it can be called externally
    saveGameRef.current = saveGame;
    
    // Save every 30 seconds (reduced from 5s to stay within Redis limits)
    const interval = setInterval(saveGame, 30000);
    
    // CRITICAL: Save on unmount (tab switch, navigation, etc.)
    return () => {
      clearInterval(interval);
      isMountedRef.current = false;
      // Fire save on unmount (fire-and-forget)
      saveGame();
    };
  }, [address, hasLoadedGame, activeTokenId]);

  // ============ SAVE ON PAGE REFRESH/CLOSE ============
  // This is CRITICAL for preventing data loss on mobile
  useEffect(() => {
    if (!address || !hasLoadedGame || !activeTokenId) return;

    // Helper to send save beacon (works even when page is closing)
    const sendSaveBeacon = () => {
      const state = gameStateRef.current;
      const loaded = loadedGameRef.current;
      
      // CRITICAL FIX: Save actual gold, not Math.max — gold decreases legitimately from purchases
      const goldToSave = state.gold;
      const clicksToSave = Math.max(state.totalClicks, loaded?.totalClicks || 0);
      
      // Safety: don't beacon save zeros over existing data
      if (goldToSave === 0 && (loaded?.gold || 0) > 0 && state.totalClicks === 0) {
        console.warn('[BEACON] Skipping - would save zeros over existing data');
        return;
      }
      
      console.log('[BEACON] Sending - gold:', goldToSave, '(ref:', state.gold, 'loaded:', loaded?.gold, ')');
      
      // ALWAYS save to localStorage first (instant, synchronous)
      try {
        const backup = {
          gold: goldToSave,
          totalClicks: clicksToSave,
          totalGoldEarned: state.totalGoldEarned || goldToSave,
          timestamp: Date.now(),
          tokenId: activeTokenId,
          address: address.toLowerCase(),
        };
        localStorage.setItem(`bg_backup_${activeTokenId}`, JSON.stringify(backup));
        console.log('[BEACON] localStorage backup saved with gold:', goldToSave);
      } catch (e) {
        console.warn('[BEACON] localStorage backup failed:', e);
      }
      
      const payload = JSON.stringify({
        address,
        tokenId: activeTokenId,
        gameState: {
          gold: goldToSave,
          totalClicks: clicksToSave,
          totalGoldEarned: state.totalGoldEarned || goldToSave,
          upgrades: state.upgrades,
          maxCombo: state.maxCombo,
          autoClickRate: state.autoClickRate || 0,
          goldPerSecond: Math.floor(state.basePerSecond * state.boostMultiplier * state.globalMultiplier),
          // Season reset acknowledgment — tells server this is a fresh post-reset session
          ...(seasonResetAckRef.current ? { seasonResetAck: true } : {}),
          // CRITICAL FIX: include ALL s3 data so achievements/raids/streaks survive tab close/switch
          // Previously this beacon stripped s3, causing achievements to be wiped from Redis on every tab leave
          s3: {
            activeExpedition: state.activeExpedition,
            completedExpeditions: state.completedExpeditions,
            legendaryExpeditions: state.legendaryExpeditions,
            expeditionGpsBonus: state.expeditionGpsBonus,
            expeditionTempMultiplier: state.expeditionTempMultiplier,
            achievements: achievementsRef.current,
            maxComboReached: state.maxComboReached,
            dailyChallengeState: state.dailyChallengeState,
            loginStreak: state.loginStreak,
            bossesDefeated: state.bossesDefeated,
            warChest: warChestRef.current,
            raidState: raidStateRef.current,
          },
        },
      });
      
      // CRITICAL: Use Blob with proper content-type for cross-browser compatibility
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        const success = navigator.sendBeacon('/api/game', blob);
        console.log('[BEACON] Sent:', success);
        
        if (!success) {
          console.log('[BEACON] Failed, trying fetch keepalive');
          fetch('/api/game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true,
          }).catch(e => console.warn('[BEACON] Keepalive fetch also failed:', e));
        }
      } else {
        console.warn('[BEACON] sendBeacon not available, using keepalive fetch');
        fetch('/api/game', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(e => console.warn('[BEACON] Keepalive fetch failed:', e));
      }
    };

    // Save when user is about to leave/refresh the page
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      sendSaveBeacon();
    };

    // CRITICAL FOR MOBILE: pagehide is more reliable than beforeunload on mobile browsers
    const handlePageHide = (e: PageTransitionEvent) => {
      sendSaveBeacon();
    };

    // Save when tab becomes hidden (user switches tabs/apps)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Use beacon for reliability (async save might not complete)
        sendSaveBeacon();
      }
    };
    
    // Save on blur (another mobile fallback)
    const handleBlur = () => {
      sendSaveBeacon();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
    };
  }, [address, hasLoadedGame, activeTokenId]);

  // Function to trigger save (debounced to prevent rate-limit hits from rapid upgrades)
  const triggerSave = useCallback(() => {
    if (triggerSaveTimerRef.current) clearTimeout(triggerSaveTimerRef.current);
    triggerSaveTimerRef.current = setTimeout(() => {
      if (saveGameRef.current) {
        saveGameRef.current();
      }
    }, 5000); // Wait 5s after last action before saving — prevents 25s rate-limit hits
  }, []);

  // ============ MOBILE: SAVE ON USER INTERACTION ============
  // Mobile browsers often don't fire visibility/unload events reliably
  // So we save every 10 seconds of user inactivity after interaction
  useEffect(() => {
    if (!address || !hasLoadedGame || !activeTokenId) return;
    
    let saveTimeout: NodeJS.Timeout | null = null;
    
    const handleInteraction = () => {
      // Clear any pending save
      if (saveTimeout) clearTimeout(saveTimeout);
      // Schedule a save 10 seconds after last interaction
      saveTimeout = setTimeout(() => {
        if (saveGameRef.current) {
          saveGameRef.current();
        }
      }, 10000);
    };
    
    // Listen to various interaction events
    window.addEventListener('touchstart', handleInteraction, { passive: true });
    window.addEventListener('touchend', handleInteraction, { passive: true });
    window.addEventListener('click', handleInteraction, { passive: true });
    window.addEventListener('scroll', handleInteraction, { passive: true });
    
    return () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      window.removeEventListener('touchstart', handleInteraction);
      window.removeEventListener('touchend', handleInteraction);
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('scroll', handleInteraction);
    };
  }, [address, hasLoadedGame, activeTokenId]);

  // ============ PASSIVE INCOME ============
  useEffect(() => {
    const totalGPS = basePerSecond + expeditionGpsBonus;
    if (totalGPS === 0) return;
    
    const interval = setInterval(() => {
      const rushMult = goldRushActive ? GOLD_RUSH_MULTIPLIER : 1;
      const expMult = expeditionTempMultiplier && Date.now() < expeditionTempMultiplier.endTime 
        ? expeditionTempMultiplier.multiplier : 1;
      const earned = Math.floor(totalGPS * boostMultiplier * globalMultiplier * rushMult * expMult * eventGpsMult);
      setGold(g => {
        const newGold = g + earned;
        // CRITICAL: Update ref immediately so save has latest value
        gameStateRef.current.gold = newGold;
        return newGold;
      });
      setTotalGoldEarned(t => {
        const newTotal = t + earned;
        gameStateRef.current.totalGoldEarned = newTotal;
        return newTotal;
      });
      // Track daily gold earned for challenges
      setDailyChallengeState(prev => {
        const updated = {
          ...prev,
          dailyGoldEarned: prev.dailyGoldEarned + earned,
        };
        gameStateRef.current.dailyChallengeState = updated;
        return updated;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [basePerSecond, boostMultiplier, globalMultiplier, expeditionGpsBonus, goldRushActive, expeditionTempMultiplier, eventGpsMult]);

  // ============ LOCAL STORAGE BACKUP (Every 2 seconds) ============
  // This provides instant backup even if network save fails
  useEffect(() => {
    if (!address || !hasLoadedGame || !activeTokenId) return;
    
    const backupInterval = setInterval(() => {
      const state = gameStateRef.current;
      const backup = {
        gold: state.gold,
        totalClicks: state.totalClicks,
        totalGoldEarned: state.totalGoldEarned,
        timestamp: Date.now(),
        tokenId: activeTokenId,
        address: address.toLowerCase(),
      };
      try {
        localStorage.setItem(`bg_backup_${activeTokenId}`, JSON.stringify(backup));
      } catch (e) {
        // localStorage might be full or disabled
      }
    }, 2000);
    
    return () => clearInterval(backupInterval);
  }, [address, hasLoadedGame, activeTokenId]);

  // ============ SAVE TIMER DISPLAY UPDATE ============
  // Update the "X seconds ago" display every second
  useEffect(() => {
    if (!lastSaveTime) return;
    
    const tickInterval = setInterval(() => {
      setSaveTick(t => t + 1); // Force re-render to update display
    }, 1000);
    
    return () => clearInterval(tickInterval);
  }, [lastSaveTime]);

  // ============ AUTO-CLICK (Golden Goat) ============
  // Auto-clicks should build combo just like manual clicks
  const autoClickRef = useRef<() => void>();
  
  useEffect(() => {
    autoClickRef.current = () => {
      const now = Date.now();
      
      // Use functional update to get latest combo value
      setCombo(currentCombo => {
        const newCombo = Math.min(currentCombo + 1, maxCombo);
        
        // Calculate gold earned with new combo
        let earned = basePerClick * newCombo * boostMultiplier * globalMultiplier;
        // Apply Gold Rush to auto-clicks too
        if (goldRushActive) earned *= GOLD_RUSH_MULTIPLIER;
        // Apply environmental event click multiplier
        earned *= eventClickMult;
        let isCrit = false;
        
        // Lucky bonus (crit) + event crit boost
        const totalCritChance = effectiveLuckyChance + eventCritBoost;
        if (totalCritChance > 0 && Math.random() < totalCritChance) {
          earned *= effectiveLuckyMultiplier;
          isCrit = true;
          playSound('combo', 5, soundEnabled);
        }
        
        // Ore multiplier for auto-clicks
        const ore = rollOre(level, bonuses.unlocksOres);
        if (ore.multiplier > 1) {
          earned *= ore.multiplier;
        }
        
        earned = Math.floor(earned);
        
        // Update other state AND ref directly for reliable saving
        setGold(g => {
          const newGold = g + earned;
          gameStateRef.current.gold = newGold;
          return newGold;
        });
        setTotalClicks(c => {
          const newClicks = c + 1;
          gameStateRef.current.totalClicks = newClicks;
          return newClicks;
        });
        setTotalGoldEarned(t => {
          const newTotal = t + earned;
          gameStateRef.current.totalGoldEarned = newTotal;
          return newTotal;
        });
        setLastClickTime(now);
        
        // Visual effect for auto-click (center of click area)
        const id = effectIdRef.current++;
        const x = 150 + Math.random() * 100 - 50;
        const y = 150 + Math.random() * 100 - 50;
        setClickEffects(prev => [...prev.slice(-10), { id, x, y, amount: earned, isCrit }]);
        setTimeout(() => setClickEffects(prev => prev.filter(ef => ef.id !== id)), 1000);
        
        return newCombo;
      });
    };
  }, [maxCombo, basePerClick, boostMultiplier, globalMultiplier, bonuses, soundEnabled, effectiveLuckyChance, effectiveLuckyMultiplier, goldRushActive, eventClickMult, eventCritBoost, level]);
  
  useEffect(() => {
    if (bonuses.autoClickRate === 0) return;
    
    const interval = setInterval(() => {
      autoClickRef.current?.();
    }, 1000 / bonuses.autoClickRate);
    
    return () => clearInterval(interval);
  }, [bonuses.autoClickRate]);

  // ============ COMBO DECAY ============
  // Only decay if we're NOT auto-clicking (Golden Goat keeps combo alive)
  // Phoenix Flame also prevents combo decay
  useEffect(() => {
    if (combo <= 1) return;
    if (bonuses.autoClickRate > 0) return; // Don't decay with auto-click active
    if (bonuses.noComboDecay) return; // Phoenix Flame prevents decay
    if (eventNoComboDecay) return; // Underground River event prevents decay
    
    const timeout = setTimeout(() => {
      setCombo(c => Math.max(1, c - 1));
    }, 1500);
    
    return () => clearTimeout(timeout);
  }, [combo, lastClickTime, bonuses.autoClickRate, bonuses.noComboDecay, eventNoComboDecay]);

  // ============ CLICK HANDLER ============
  const handleClick = useCallback((e?: React.MouseEvent) => {
    const now = Date.now();
    
    // Per-click interval detection — catches autoclicker burst patterns.
    // A human cannot click faster than ~100ms between clicks.
    // Scripts fire at 10-50ms intervals which passes the 5/sec window check
    // but fails this per-click gap check.
    const MIN_CLICK_INTERVAL_MS = 100;
    const lastTimestamp = clickTimestampsRef.current[clickTimestampsRef.current.length - 1] || 0;
    if (lastTimestamp > 0 && now - lastTimestamp < MIN_CLICK_INTERVAL_MS) {
      return; // Too fast between clicks — script detected, drop silently
    }

    // [S3 LAUNCH] CPS throttle — hard cap at 5 manual clicks per second
    // Drop clicks that exceed the limit (external autoclicker protection)
    const recentClicks = clickTimestampsRef.current.filter(t => now - t < 1000);
    if (recentClicks.length >= CLIENT_CPS_LIMIT) {
      return; // Silently drop — too fast
    }
    clickTimestampsRef.current = [...recentClicks, now];
    
    // Calculate combo
    let newCombo = combo;
    if (now - lastClickTime < 500) {
      newCombo = Math.min(combo + 1, maxCombo);
    } else if (now - lastClickTime > 1500) {
      // Only reset if it's been a while (not just slightly over 500ms)
      newCombo = Math.max(1, combo - 1);
    }
    setCombo(newCombo);
    setLastClickTime(now);
    
    // Calculate gold earned
    let earned = basePerClick * newCombo * boostMultiplier * globalMultiplier;
    // Apply Gold Rush to clicks too (not just passive)
    if (goldRushActive) earned *= GOLD_RUSH_MULTIPLIER;
    // Apply environmental event click multiplier
    earned *= eventClickMult;
    let isCrit = false;
    
    // Lucky bonus (crit) + event crit boost
    const totalCritChance = effectiveLuckyChance + eventCritBoost;
    if (totalCritChance > 0 && Math.random() < totalCritChance) {
      earned *= effectiveLuckyMultiplier;
      isCrit = true;
      playSound('combo', 5, soundEnabled);
    }
    
    // Season 3 v2: Roll ore type for visual
    const ore = rollOre(level, bonuses.unlocksOres);
    // Ore multiplier only applies to non-copper (copper = 1x = no bonus)
    if (ore.multiplier > 1) {
      earned *= ore.multiplier;
    }
    
    earned = Math.floor(earned);
    
    // Update state AND ref directly for reliable saving
    setGold(g => {
      const newGold = g + earned;
      gameStateRef.current.gold = newGold;
      return newGold;
    });
    setTotalClicks(c => {
      const newClicks = c + 1;
      gameStateRef.current.totalClicks = newClicks;
      return newClicks;
    });
    setTotalGoldEarned(t => {
      const newTotal = t + earned;
      gameStateRef.current.totalGoldEarned = newTotal;
      return newTotal;
    });
    
    // Season 3 v2: Track active clicking for clover spawning
    lastActiveClickRef.current = now;
    setIsActivelyClicking(true);
    
    // Visual effect with ore type
    if (e) {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const id = effectIdRef.current++;
      setClickEffects(prev => [...prev.slice(-10), { 
        id, x, y, amount: earned, isCrit,
        oreEmoji: ore.multiplier > 1 ? ore.emoji : undefined,
        oreColor: ore.multiplier > 1 ? ore.color : undefined,
      }]);
      setTimeout(() => setClickEffects(prev => prev.filter(ef => ef.id !== id)), 1000);
    }
    
    playSound('click', newCombo, soundEnabled);
    if (newCombo >= 5) playSound('combo', newCombo, soundEnabled);
    
    // Season 3: Track daily challenge progress
    setDailyChallengeState(prev => {
      const updated = {
        ...prev,
        dailyClicks: prev.dailyClicks + 1,
        dailyGoldEarned: prev.dailyGoldEarned + earned,
      };
      // CRITICAL: Sync ref immediately so saves always get latest counters
      gameStateRef.current.dailyChallengeState = updated;
      return updated;
    });
    
    // Season 3: Boss spawn tracking
    setClicksSinceLastBoss(prev => {
      const newCount = prev + 1;
      const interval = getBossInterval(level);
      if (newCount >= interval && !activeBoss) {
        // Spawn boss!
        const boss = selectBoss(level);
        setActiveBoss(boss);
        return 0;
      }
      return newCount;
    });
  }, [combo, lastClickTime, basePerClick, boostMultiplier, globalMultiplier, maxCombo, bonuses, soundEnabled, effectiveLuckyChance, effectiveLuckyMultiplier, level, activeBoss, goldRushActive, eventClickMult, eventCritBoost]);

  // ============ UPGRADE HANDLER ============
  const handleUpgrade = useCallback((key: string) => {
    // CRITICAL: Read from ref, NOT React state closure.
    // React 18 batches state updates, so rapid clicks would all see the same
    // stale gold/upgrades from the closure. The ref is updated synchronously.
    const refState = gameStateRef.current;
    const currentGold = refState.gold ?? gold;
    const currentUpgrades = refState.upgrades ?? upgrades;
    const upgrade = currentUpgrades[key as keyof typeof currentUpgrades];
    if (!upgrade) return;
    if (currentGold < upgrade.cost || level < upgrade.unlockLevel) return;
    // Enforce max owned cap
    if ((upgrade as any).maxOwned && upgrade.owned >= (upgrade as any).maxOwned) return;
    
    // Calculate new values from ref (not closure!)
    const newGold = currentGold - upgrade.cost;
    const newUpgrades = {
      ...currentUpgrades,
      [key]: {
        ...upgrade,
        owned: upgrade.owned + 1,
        cost: Math.floor(upgrade.cost * upgrade.multiplier),
      },
    };
    
    // CRITICAL: Update ref IMMEDIATELY so next rapid click reads fresh values
    gameStateRef.current = { 
      ...gameStateRef.current, 
      gold: newGold, 
      upgrades: newUpgrades 
    };
    
    // CRITICAL: Also update loadedRef so save protections don't treat
    // legitimate gold decrease from purchases as suspicious
    if (loadedGameRef.current) {
      loadedGameRef.current = { ...loadedGameRef.current, gold: newGold, upgrades: newUpgrades };
    }
    
    // Update React state (will trigger re-render)
    setGold(newGold);
    setUpgrades(newUpgrades);
    playSound('upgrade', 1, soundEnabled);
    
    // Season 3: Track daily upgrade purchases
    setDailyChallengeState(prev => {
      const updated = {
        ...prev,
        dailyUpgradesBought: prev.dailyUpgradesBought + 1,
      };
      gameStateRef.current.dailyChallengeState = updated;
      return updated;
    });
    
    // Trigger debounced save (won't hammer rate limit on rapid purchases)
    triggerSave();
  }, [gold, upgrades, level, soundEnabled, triggerSave]);

  // ============ PURCHASE HISTORY LOADER ============
  const loadPurchaseHistory = useCallback(async (forceRefresh = false) => {
    if (!address || isLoadingHistory) return;
    setIsLoadingHistory(true);
    try {
      // If force refresh, re-scan blockchain first to update Redis cache
      if (forceRefresh) {
        await fetch(`/api/purchases?address=${address}&refresh=true`);
      }
      const res = await fetch(`/api/purchases/history?address=${address}`);
      const data = await res.json();
      if (data.receipts !== undefined) {
        setPurchaseHistory(data);
        console.log(`[HISTORY] Loaded ${data.receipts?.length || 0} receipts via ${data.source || 'api'}`);
      }
    } catch (e) {
      console.error('[HISTORY] Failed to load purchase history:', e);
    }
    setIsLoadingHistory(false);
  }, [address, isLoadingHistory]);

  // ============ SHOP PURCHASE HANDLER ============
  const handlePurchase = useCallback((item: typeof SHOP_ITEMS[0]) => {
    setSelectedItem(item);
    setShowPurchaseModal(true);
  }, []);

  // [V5 FIX] Lock the item at purchase time — not at confirmation time.
  // This prevents the exploit where clicking another item while a tx is confirming
  // credits the NEW item for free (because selectedItem changed in the dependency array).
  const purchasedItemRef = useRef<typeof SHOP_ITEMS[0] | null>(null);

  const confirmPurchase = useCallback(() => {
    if (!selectedItem) return;
    
    // [V6 SECURITY M-6] Enforce maxOwned — prevents devtools bypass of disabled button
    if (selectedItem.maxOwned > 0) {
      const ownedCount = verifiedPurchases.filter(p => p.itemId === selectedItem.id).length;
      if (ownedCount >= selectedItem.maxOwned) {
        console.warn(`[SECURITY] Blocked purchase: ${selectedItem.id} already at max (${ownedCount}/${selectedItem.maxOwned})`);
        setShowPurchaseModal(false);
        return;
      }
    }
    
    // Lock the item being purchased BEFORE sending the tx
    purchasedItemRef.current = selectedItem;
    
    buyAndBurn({
      address: INSTANT_BURN,
      abi: INSTANT_BURN_ABI,
      functionName: 'buyAndBurn',
      value: parseEther(selectedItem.priceETH),
    });
  }, [selectedItem, buyAndBurn, verifiedPurchases]);

  // Handle successful purchase — uses the LOCKED item, not current selectedItem
  useEffect(() => {
    if (isBurnConfirmed && burnTxHash && purchasedItemRef.current) {
      // [V5 FIX] Skip if this tx was already processed
      if (processedBurnTxRef.current.has(burnTxHash)) return;
      processedBurnTxRef.current.add(burnTxHash);
      
      const item = purchasedItemRef.current;
      playSound('purchase', 1, soundEnabled);
      setShowPurchaseModal(false);
      setSelectedItem(null);
      purchasedItemRef.current = null;
      
      // Add to verified purchases using the LOCKED item
      setVerifiedPurchases(prev => [...prev, {
        itemId: item.id,
        ethAmount: item.priceETH,
        bgBurned: 0,
        timestamp: Date.now(),
        txHash: burnTxHash,
      }]);
      setBurnCount(c => c + 1);
    }
  }, [isBurnConfirmed, burnTxHash, soundEnabled]);

  // ============ BUY ETH HANDLER (iOS-compatible) ============
  const handleBuyEth = useCallback(async () => {
    if (!address) return;
    setBuyEthLoading(true);
    
    // Build fallback URL
    const fallbackUrl = `https://pay.coinbase.com/buy/select-asset?addresses=${encodeURIComponent(JSON.stringify({[address]: ["base"]}))}&assets=${encodeURIComponent(JSON.stringify(["ETH"]))}`;
    
    // Detect platform
    const isInAppBrowser = /FBAN|FBAV|Instagram|Telegram|Twitter|wv|WebView/i.test(navigator.userAgent);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    
    // For in-app browsers, navigate in same window to avoid popup blocking
    if (isInAppBrowser) {
      window.location.href = fallbackUrl;
      return;
    }
    
    // For iOS Safari: Open window IMMEDIATELY on user gesture, then update URL after API call
    let newWindow: Window | null = null;
    if (isIOS) {
      newWindow = window.open('about:blank', '_blank');
      if (newWindow) {
        newWindow.document.write(`
          <html>
            <head><title>Loading Coinbase...</title></head>
            <body style="background:#0a0a0f;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
              <div style="text-align:center;">
                <div style="font-size:48px;margin-bottom:16px;">💰</div>
                <div style="color:#D4AF37;">Loading Coinbase Pay...</div>
              </div>
            </body>
          </html>
        `);
      }
    }
    
    try {
      const res = await fetch('/api/onramp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      
      const targetUrl = data.url || (data.token ? `https://pay.coinbase.com/buy?sessionToken=${data.token}` : fallbackUrl);
      
      if (isIOS && newWindow) {
        newWindow.location.href = targetUrl;
      } else {
        window.open(targetUrl, '_blank');
      }
    } catch (err) {
      if (isIOS && newWindow) {
        newWindow.location.href = fallbackUrl;
      } else {
        window.open(fallbackUrl, '_blank');
      }
    } finally {
      setBuyEthLoading(false);
    }
  }, [address]);

  // ============ LEADERBOARD SUBMIT ============
  const submitToLeaderboard = useCallback(async () => {
    if (!address) {
      alert('Please connect your wallet first!');
      return;
    }

    if (!activeTokenId) {
      alert('You need a Gold Mine NFT to submit to the leaderboard!');
      return;
    }
    
    // Confirmation dialog to prevent accidental taps triggering wallet signing
    const previewScore = Math.max(totalGoldEarned, gameStateRef.current.totalGoldEarned || 0, gold);
    if (!confirm(`Submit your score to the leaderboard?\n\nTotal Gold Mined: ${previewScore.toLocaleString()}\n\nThis will ask you to sign a message with your wallet.`)) {
      return;
    }
    
    setIsSubmittingScore(true);
    
    // Get the most current values from ref AND state, use whichever is higher
    const refGold = gameStateRef.current.gold;
    const refClicks = gameStateRef.current.totalClicks;
    const refTotalEarned = gameStateRef.current.totalGoldEarned;
    const currentGold = Math.max(gold, refGold);
    const currentClicks = Math.max(totalClicks, refClicks);
    // Leaderboard ranks by totalGoldEarned (lifetime) — fairer with raids/spending
    const currentScore = Math.max(totalGoldEarned, refTotalEarned, currentGold);
    
    console.log('[LEADERBOARD SUBMIT] Gold:', currentGold, 'TotalEarned:', currentScore, 'Clicks:', currentClicks);
    
    try {
      // CRITICAL: Save current state FIRST and wait for confirmation
      // This ensures the leaderboard has the latest gold value
      try {
        console.log('[LEADERBOARD] Saving state before submit with score:', currentScore);
        const saveRes = await fetch('/api/game', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address,
            tokenId: activeTokenId,
            gameState: { 
              gold: currentGold, 
              totalClicks: currentClicks, 
              totalGoldEarned: currentScore, 
              upgrades,
              maxCombo,
              autoClickRate: bonuses.autoClickRate || 0,
              goldPerSecond: Math.floor(basePerSecond * boostMultiplier * globalMultiplier),
            },
          }),
        });
        
        if (!saveRes.ok) {
          console.warn('[LEADERBOARD] Pre-save failed with status:', saveRes.status);
        } else {
          const saveData = await saveRes.json();
          console.log('[LEADERBOARD] Pre-save response:', saveData);
          // Update loadedGameRef on successful save
          if (saveData.success) {
            loadedGameRef.current = { gold: currentGold, totalClicks: currentClicks, upgrades };
          }
        }
      } catch (e) {
        console.warn('[LEADERBOARD] Pre-submit save error:', e);
        // Continue anyway - the leaderboard will use submitted gold
      }
      
      // Sign message for leaderboard
      const timestamp = Date.now();
      const message = `BaseGold Leaderboard Submission\n\nMine #${activeTokenId}\nGold: ${currentScore}\nClicks: ${currentClicks}\nTimestamp: ${timestamp}`;
      
      const signature = await signMessageAsync({ message });
      
      // Submit to leaderboard
      const res = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          tokenId: activeTokenId,
          signature,
          message,
          name: `Mine #${activeTokenId}`,
          gold: currentScore, // totalGoldEarned = lifetime score
          totalClicks: currentClicks,
          timestamp,
        }),
      });
      
      const data = await res.json();
      if (data.success) {
        if (data.message?.includes('not updated')) {
          alert(`Score not updated - leaderboard already has ${data.entry?.gold?.toLocaleString() || 'a higher score'}!`);
        } else {
          const submittedGold = data.entry?.gold || currentScore;
          alert(`✅ Score submitted!\n\nTotal Gold Mined: ${submittedGold.toLocaleString()}\nRank: #${data.rank}`);
        }
      } else {
        alert(data.error || data.reason || 'Failed to submit');
      }
    } catch (e: any) {
      if (e.message?.includes('rejected') || e.message?.includes('denied')) {
        // User cancelled signing
      } else {
        console.error('Submit error:', e);
        alert('Failed to submit score');
      }
    } finally {
      setIsSubmittingScore(false);
    }
  }, [gold, totalClicks, totalGoldEarned, address, signMessageAsync, upgrades, maxCombo, basePerSecond, boostMultiplier, globalMultiplier, activeTokenId, bonuses.autoClickRate]);

  // ============ SEASON 3: EXPEDITION HANDLERS ============
  const handleSendExpedition = useCallback((expedition: ExpeditionType) => {
    if (activeExpedition) return; // Only 1 at a time
    if (level < expedition.levelRequired) return;
    
    const now = Date.now();
    const newExpedition: ActiveExpedition = {
      expeditionId: expedition.id,
      startTime: now,
      endTime: now + expedition.duration,
      gpsAtStart: Math.floor(basePerSecond * boostMultiplier * globalMultiplier),
      status: 'active',
    };
    
    setActiveExpedition(newExpedition);
    playSound('purchase', 1, soundEnabled);
    
    // Save immediately
    triggerSave();
  }, [activeExpedition, level, basePerSecond, boostMultiplier, globalMultiplier, soundEnabled, triggerSave]);
  
  const handleClaimExpedition = useCallback(() => {
    if (!activeExpedition) return;
    const expedition = EXPEDITIONS.find(e => e.id === activeExpedition.expeditionId);
    if (!expedition) return;
    
    const now = Date.now();
    if (now < activeExpedition.endTime) return; // Not done yet
    
    // Calculate rewards
    const durationHours = expedition.duration / (1000 * 60 * 60);
    const relicMult = bonuses.expeditionMultiplier; // Ancient Relic doubles expedition rewards
    const passiveGold = Math.floor(activeExpedition.gpsAtStart * 3600 * durationHours * expedition.rewards.goldMultiplier * relicMult);
    const totalGoldReward = passiveGold + Math.floor(expedition.rewards.bonusGold * relicMult);
    
    // Apply rewards
    setGold(g => {
      const newGold = g + totalGoldReward;
      gameStateRef.current.gold = newGold;
      return newGold;
    });
    setTotalGoldEarned(t => {
      const newTotal = t + totalGoldReward;
      gameStateRef.current.totalGoldEarned = newTotal;
      return newTotal;
    });
    
    // Add permanent GPS bonus (scaled by Ancient Relic if owned)
    setExpeditionGpsBonus(prev => prev + Math.floor(expedition.rewards.gpsBonus * relicMult));
    
    // Set temporary multiplier
    if (expedition.rewards.tempMultiplier > 1) {
      setExpeditionTempMultiplier({
        multiplier: expedition.rewards.tempMultiplier,
        endTime: now + expedition.rewards.tempMultiplierDuration,
      });
    }
    
    // Track completion
    setCompletedExpeditions(c => c + 1);
    if (expedition.id === 'legendary') {
      setLegendaryExpeditions(l => l + 1);
    }
    
    // Clear active expedition
    setActiveExpedition(null);
    
    playSound('upgrade', 1, soundEnabled);
    triggerSave();
  }, [activeExpedition, soundEnabled, triggerSave, bonuses.expeditionMultiplier]);
  
  // ============ SEASON 3: ACHIEVEMENT CHECKER ============
  // Check achievements whenever relevant stats change
  useEffect(() => {
    if (!hasLoadedGame) return;
    
    const totalUpgradeCount = Object.values(upgrades).reduce((sum, u) => sum + u.owned, 0);
    let newUnlocks: AchievementDef[] = [];
    
    // Use current achievements so claimed flags are never clobbered by a stale closure
    const updatedAchievements = { ...achievements };
    
    ACHIEVEMENTS.forEach(achievement => {
      if (updatedAchievements[achievement.id]?.unlocked) return; // Already unlocked — never overwrite
      
      let progress = 0;
      switch (achievement.category) {
        case 'clicks': progress = totalClicks; break;
        case 'gold': progress = totalGoldEarned; break;
        case 'combo': progress = maxComboReached; break;
        case 'burns': progress = burnCount; break;
        case 'expeditions':
          if (achievement.id === 'expedition_legendary') progress = legendaryExpeditions;
          else progress = completedExpeditions;
          break;
        case 'upgrades': progress = totalUpgradeCount; break;
        case 'streaks': progress = loginStreak.currentStreak; break;
      }
      
      if (progress >= achievement.target) {
        // Preserve claimed flag — never reset a claimed achievement
        const existing = updatedAchievements[achievement.id];
        updatedAchievements[achievement.id] = {
          unlocked: true,
          unlockedAt: existing?.unlockedAt || Date.now(),
          claimed: existing?.claimed ?? false,
        };
        newUnlocks.push(achievement);
      }
    });
    
    if (newUnlocks.length > 0) {
      setAchievements(updatedAchievements);
      setAchievementPopupQueue(prev => [...prev, ...newUnlocks]);
    }
  // achievements must be in deps so closure always reads current claimed state
  }, [totalClicks, totalGoldEarned, maxComboReached, burnCount, completedExpeditions, legendaryExpeditions, loginStreak.currentStreak, upgrades, hasLoadedGame, achievements]);
  
  // Process achievement popup queue
  const handleDismissAchievement = useCallback(() => {
    setAchievementPopupQueue(prev => prev.slice(1));
  }, []);
  
  // Claim achievement reward
  const handleClaimAchievement = useCallback((achievementId: string) => {
    const achievement = ACHIEVEMENTS.find(a => a.id === achievementId);
    if (!achievement) return;

    // Guard: already claimed (prevents double-claim on rapid clicks)
    if (achievementsRef.current?.[achievementId]?.claimed) return;

    // 1. Update achievements — write to BOTH refs immediately (no React batching delay)
    const updatedAchievements = {
      ...achievementsRef.current,
      [achievementId]: {
        ...(achievementsRef.current?.[achievementId] || {}),
        unlocked: true,
        claimed: true,
      },
    };
    achievementsRef.current = updatedAchievements;
    gameStateRef.current.achievements = updatedAchievements;
    setAchievements(updatedAchievements);

    // 2. Update gold — write to ref immediately
    const newGold = gameStateRef.current.gold + achievement.goldReward;
    gameStateRef.current.gold = newGold;
    setGold(newGold);

    const newTotal = gameStateRef.current.totalGoldEarned + achievement.goldReward;
    gameStateRef.current.totalGoldEarned = newTotal;
    setTotalGoldEarned(newTotal);

    playSound('purchase', 1, soundEnabled);
    // Save immediately — ref is already up-to-date so no race condition
    setTimeout(() => { if (saveGameRef.current) saveGameRef.current(); }, 200);
  }, [soundEnabled]);
  
  // Track max combo for achievements
  useEffect(() => {
    if (combo > maxComboReached) {
      setMaxComboReached(combo);
      // Also update daily challenge max combo
      setDailyChallengeState(prev => {
        const updated = {
          ...prev,
          dailyMaxCombo: Math.max(prev.dailyMaxCombo, combo),
        };
        gameStateRef.current.dailyChallengeState = updated;
        return updated;
      });
    }
  }, [combo, maxComboReached]);
  
  // ============ SEASON 3: DAILY CHALLENGE TRACKER ============
  // Initialize daily challenges on load
  useEffect(() => {
    if (!hasLoadedGame) return;
    const todayKey = getTodayKey();
    
    if (dailyChallengeState.dayKey !== todayKey) {
      // New day - reset challenges
      const todaysChallenges = getDailyChallenges(todayKey);
      const freshState = {
        dayKey: todayKey,
        challenges: todaysChallenges.map(c => ({
          templateId: c.id,
          progress: 0,
          completed: false,
          claimed: false,
        })),
        dailyClicks: 0,
        dailyGoldEarned: 0,
        dailyUpgradesBought: 0,
        dailyMaxCombo: 0,
      };
      setDailyChallengeState(freshState);
      gameStateRef.current.dailyChallengeState = freshState;
    }
  }, [hasLoadedGame]);
  
  // Update daily challenge progress
  useEffect(() => {
    if (!hasLoadedGame || dailyChallengeState.dayKey !== getTodayKey()) return;
    
    const todaysChallenges = getDailyChallenges(dailyChallengeState.dayKey);
    const updatedChallenges = dailyChallengeState.challenges.map((challenge, index) => {
      // Never overwrite a claimed challenge — claimed implies completed
      if (challenge.claimed || challenge.completed) return challenge;
      const template = todaysChallenges[index];
      if (!template) return challenge;
      
      let progress = 0;
      switch (template.type) {
        case 'clicks': progress = dailyChallengeState.dailyClicks; break;
        case 'gold_earned': progress = dailyChallengeState.dailyGoldEarned; break;
        case 'combo_reached': progress = dailyChallengeState.dailyMaxCombo; break;
        case 'upgrades_bought': progress = dailyChallengeState.dailyUpgradesBought; break;
      }
      
      return {
        ...challenge,
        progress,
        completed: progress >= template.target,
      };
    });
    
    const hasChanges = updatedChallenges.some((c, i) => c.progress !== dailyChallengeState.challenges[i]?.progress);
    if (hasChanges) {
      setDailyChallengeState(prev => ({ ...prev, challenges: updatedChallenges }));
    }
  }, [dailyChallengeState.dailyClicks, dailyChallengeState.dailyGoldEarned, dailyChallengeState.dailyMaxCombo, dailyChallengeState.dailyUpgradesBought, hasLoadedGame]);
  
  // Claim daily challenge reward
  const handleClaimChallenge = useCallback((index: number) => {
    const todaysChallenges = getDailyChallenges(dailyChallengeState.dayKey);
    const challenge = todaysChallenges[index];
    if (!challenge) return;

    // Guard: already claimed — read from live ref, not gameStateRef which may be stale
    const liveChallenge = gameStateRef.current.dailyChallengeState?.challenges?.[index];
    if (liveChallenge?.claimed) return;

    // Update dailyChallengeState ref immediately
    const updatedChallenges = [...(gameStateRef.current.dailyChallengeState?.challenges || [])];
    updatedChallenges[index] = { ...(updatedChallenges[index] || {}), claimed: true };
    gameStateRef.current.dailyChallengeState = {
      ...(gameStateRef.current.dailyChallengeState || {}),
      challenges: updatedChallenges,
    } as any;
    setDailyChallengeState(prev => {
      const updated = { ...prev, challenges: [...prev.challenges] };
      updated.challenges[index] = { ...updated.challenges[index], claimed: true };
      return updated;
    });

    const newGold = gameStateRef.current.gold + challenge.goldReward;
    gameStateRef.current.gold = newGold;
    setGold(newGold);

    const newTotal = gameStateRef.current.totalGoldEarned + challenge.goldReward;
    gameStateRef.current.totalGoldEarned = newTotal;
    setTotalGoldEarned(newTotal);

    playSound('purchase', 1, soundEnabled);
    setTimeout(() => { if (saveGameRef.current) saveGameRef.current(); }, 200);
  }, [dailyChallengeState.dayKey, soundEnabled]);
  
  // Claim streak bonus
  const handleClaimStreakBonus = useCallback(() => {
    if (loginStreak.streakRewardClaimed) return;
    
    const bonus = getStreakBonus(loginStreak.currentStreak);
    
    setLoginStreak(prev => ({ ...prev, streakRewardClaimed: true }));
    
    setGold(g => {
      const newGold = g + bonus;
      gameStateRef.current.gold = newGold;
      return newGold;
    });
    setTotalGoldEarned(t => {
      const newTotal = t + bonus;
      gameStateRef.current.totalGoldEarned = newTotal;
      return newTotal;
    });
    
    playSound('purchase', 1, soundEnabled);
    // Immediately persist claimed flag — don't wait for 30s auto-save
    setTimeout(() => { if (saveGameRef.current) saveGameRef.current(); }, 500);
  }, [loginStreak, soundEnabled]);
  
  // ============ SEASON 3: LOGIN STREAK TRACKER ============
  useEffect(() => {
    if (!hasLoadedGame) return;
    const todayKey = getTodayKey();
    
    if (loginStreak.lastLoginDay !== todayKey) {
      setLoginStreak(prev => {
        // Check if this is a consecutive day
        const yesterday = new Date();
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        const yesterdayKey = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterday.getUTCDate()).padStart(2, '0')}`;
        
        const isConsecutive = prev.lastLoginDay === yesterdayKey;
        const newStreak = isConsecutive ? prev.currentStreak + 1 : 1;
        
        return {
          lastLoginDay: todayKey,
          currentStreak: newStreak,
          longestStreak: Math.max(prev.longestStreak, newStreak),
          streakRewardClaimed: false, // Reset for new day
        };
      });
    }
  }, [hasLoadedGame]);
  
  // ============ SEASON 3: GOLD RUSH EVENT TIMER ============
  useEffect(() => {
    if (!hasLoadedGame) return;
    
    // Schedule random gold rush events
    let rushTimeout: NodeJS.Timeout | null = null;
    let endTimeout: NodeJS.Timeout | null = null;
    let isMounted = true;
    
    const scheduleNextRush = () => {
      const delay = GOLD_RUSH_INTERVAL_MIN + Math.random() * (GOLD_RUSH_INTERVAL_MAX - GOLD_RUSH_INTERVAL_MIN);
      const actualDelay = TEST_MODE ? delay / 10 : delay;
      
      rushTimeout = setTimeout(() => {
        if (!isMounted) return;
        setGoldRushActive(true);
        setGoldRushEndTime(Date.now() + GOLD_RUSH_DURATION);
        playSound('combo', 10, soundEnabled);
        
        // End the rush after duration, then schedule next
        endTimeout = setTimeout(() => {
          if (!isMounted) return;
          setGoldRushActive(false);
          setGoldRushEndTime(0);
          // Schedule next rush after this one ends
          scheduleNextRush();
        }, TEST_MODE ? GOLD_RUSH_DURATION / 2 : GOLD_RUSH_DURATION);
      }, actualDelay);
    };
    
    scheduleNextRush();
    
    return () => {
      isMounted = false;
      if (rushTimeout) clearTimeout(rushTimeout);
      if (endTimeout) clearTimeout(endTimeout);
    };
  }, [hasLoadedGame, soundEnabled]);
  
  // Gold rush tick for countdown display
  useEffect(() => {
    if (!goldRushActive) return;
    const interval = setInterval(() => setGoldRushTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [goldRushActive]);
  
  // Gold rush multiplier for earnings calculations
  const goldRushMultiplier = goldRushActive ? GOLD_RUSH_MULTIPLIER : 1;
  
  // ============ SEASON 3: MINI-BOSS HANDLERS ============
  const handleBossDefeat = useCallback((reward: number) => {
    setGold(g => {
      const newGold = g + reward;
      gameStateRef.current.gold = newGold;
      return newGold;
    });
    setTotalGoldEarned(t => {
      const newTotal = t + reward;
      gameStateRef.current.totalGoldEarned = newTotal;
      return newTotal;
    });
    setBossesDefeated(d => d + 1);
    setActiveBoss(null);
    playSound('upgrade', 1, soundEnabled);
  }, [soundEnabled]);
  
  const handleBossTimeout = useCallback(() => {
    setActiveBoss(null);
    // Boss escaped — no reward
  }, []);
  
  // ============ SEASON 3 v2: WAR CHEST DEPOSIT HANDLER ============
  const handleWarChestDeposit = useCallback((amount: number) => {
    if (amount < 1000 || gold < amount) return;
    
    // Enforce daily cap based on mine tier
    const tier = getVaultTier(level);
    const today = new Date().toISOString().split('T')[0];
    const vaultedToday = warChest.todayKey === today ? warChest.vaultedToday : 0;
    const dailyRemaining = Math.max(0, tier.dailyCap - vaultedToday);
    
    // Clamp to daily remaining
    const actual = Math.min(amount, gold, dailyRemaining);
    if (actual < 1000) return;
    
    // Remove gold from spendable balance
    setGold(g => {
      const newGold = g - actual;
      gameStateRef.current.gold = newGold;
      return newGold;
    });
    
    // Add to vault with daily tracking
    setWarChestSync(prev => ({
      ...prev,
      totalVaulted: prev.totalVaulted + actual,
      depositCount: prev.depositCount + 1,
      lastDepositTime: Date.now(),
      biggestDeposit: Math.max(prev.biggestDeposit, actual),
      vaultedToday: (prev.todayKey === today ? prev.vaultedToday : 0) + actual,
      todayKey: today,
    }));
    
    playSound('combo', 8, soundEnabled);
    
    // Trigger immediate save
    setTimeout(() => {
      if (saveGameRef.current) saveGameRef.current();
    }, 500);
  }, [gold, level, warChest.todayKey, warChest.vaultedToday, soundEnabled]);
  
  // ============ SEASON 3 v2: RAID HANDLERS (army + 2-day cycle) ============
  // Army = total roster including deployed. MineRaids component calculates "available" by subtracting active deployments.
  
  // Build barracks: spend gold, mark barracks as built
  const handleBuildBarracks = useCallback((classId: string, cost: number) => {
    if (gold < cost) return;
    setGold(g => {
      const newGold = g - cost;
      gameStateRef.current.gold = newGold;
      return newGold;
    });
    setRaidStateSync(prev => ({
      ...prev,
      barracks: { ...prev.barracks, [classId]: true },
    }));
    playSound('upgrade', 1, soundEnabled);
    // Immediate save: barracks is a permanent purchase — save right away
    setTimeout(() => { if (saveGameRef.current) saveGameRef.current(); }, 100);
  }, [gold, soundEnabled]);

  // Queue training: spend gold, add to training queue
  const handleQueueTraining = useCallback((classId: string, count: number, cost: number) => {
    if (gold < cost) return;
    setGold(g => {
      const newGold = g - cost;
      gameStateRef.current.gold = newGold;
      return newGold;
    });
    setRaidStateSync(prev => {
      const existingIdx = prev.trainingQueue.findIndex(t => t.classId === classId);
      const barracksConfig = BARRACKS.find(b => b.id === classId);
      const trainTime = TEST_MODE ? (barracksConfig?.trainTimeTest || 3000) : (barracksConfig?.trainTime || 15000);
      
      if (existingIdx >= 0) {
        // Add to existing queue for this class
        const updated = [...prev.trainingQueue];
        updated[existingIdx] = {
          ...updated[existingIdx],
          totalCount: updated[existingIdx].totalCount + count,
        };
        return { ...prev, trainingQueue: updated };
      } else {
        // New training queue item
        return {
          ...prev,
          trainingQueue: [...prev.trainingQueue, {
            classId,
            totalCount: count,
            trainedCount: 0,
            currentStart: Date.now(),
            trainTimePerUnit: trainTime,
          }],
        };
      }
    });
    playSound('click', 2, soundEnabled);
    // Immediate save: training queue must persist so troops aren't lost on page close
    setTimeout(() => { if (saveGameRef.current) saveGameRef.current(); }, 100);
  }, [gold, soundEnabled]);

  // Training tick: process training queue every second
  useEffect(() => {
    const interval = setInterval(() => {
      setRaidStateSync(prev => {
        const now = Date.now();
        let changed = false;
        let newArmy = { ...prev.army };
        let newQueue = prev.trainingQueue.map(item => ({ ...item }));
        let addedTotal = 0;
        
        for (let i = newQueue.length - 1; i >= 0; i--) {
          const item = newQueue[i];
          if (item.trainedCount >= item.totalCount) {
            newQueue.splice(i, 1);
            changed = true;
            continue;
          }
          
          // Check if current raider finished training
          const elapsed = now - item.currentStart;
          if (elapsed >= item.trainTimePerUnit) {
            // How many completed in the elapsed time
            const completed = Math.min(
              Math.floor(elapsed / item.trainTimePerUnit),
              item.totalCount - item.trainedCount
            );
            if (completed > 0) {
              newArmy[item.classId] = (newArmy[item.classId] || 0) + completed;
              item.trainedCount += completed;
              item.currentStart = now;
              addedTotal += completed;
              changed = true;
              
              if (item.trainedCount >= item.totalCount) {
                newQueue.splice(i, 1);
              }
            }
          }
        }
        
        if (!changed) return prev;
        return {
          ...prev,
          army: newArmy,
          trainingQueue: newQueue,
          totalRecruited: prev.totalRecruited + addedTotal,
        };
      });
      // When troops finish training, persist immediately so army count survives page refresh
      if (raidStateRef.current.trainingQueue.length === 0 && raidStateRef.current.army) {
        if (saveGameRef.current) saveGameRef.current();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Launch: DON'T subtract from army (component handles availability via deployed calc)
  const handleLaunchRaid = useCallback((raid: ActiveRaid) => {
    const today = new Date().toISOString().split('T')[0];
    setRaidStateSync(prev => ({
      ...prev,
      activeRaids: [...prev.activeRaids, raid],
      raidsToday: prev.todayKey === today ? prev.raidsToday + 1 : 1,
      todayKey: today,
      lastRaidTime: Date.now(),
    }));
    playSound('click', 3, soundEnabled);
    // Immediate save: raid is live — timestamps must persist for phase advancement on reload
    setTimeout(() => { if (saveGameRef.current) saveGameRef.current(); }, 100);
  }, [soundEnabled]);

  // Use catapults: decrement local count by N optimistically
  const handleUseCatapults = useCallback((count: number) => {
    setPlayerCatapults(c => Math.max(0, c - count));
  }, []);

  // Sync catapult count to server-confirmed value after use
  const handleSyncCatapults = useCallback((serverCount: number) => {
    setPlayerCatapults(Math.max(0, serverCount));
  }, []);

  // Build gold wall: deduct gold, increment wall HP
  const handleBuildGoldWall = useCallback((cost: number) => {
    setGold(g => {
      const newGold = g - cost;
      gameStateRef.current.gold = newGold;
      return newGold;
    });
    setPlayerWallHP(hp => hp + 1);
    setGoldWallsBuilt(c => c + 1);
    playSound('upgrade', 1, soundEnabled);
  }, [soundEnabled]);

  // Attack status from WarPanel
  // Attack menu handler — passes tokenId to MineRaids via preSelectTokenId prop
  const [attackMenuTarget, setAttackMenuTarget] = useState<number | null>(null);
  const handleAttackMenuRaid = useCallback((targetTokenId: number) => {
    if (raidInProgress) return;
    setAttackMenuTarget(targetTokenId);
    setRaidInProgress(true);
  }, [raidInProgress]);

  const handleAttackStatus = useCallback((underAttack: boolean, attackCount: number) => {
    setIsUnderAttack(underAttack);
    setRecentAttackCount(attackCount);
  }, []);

  // Collect: apply gold/BG, REMOVE dead raiders from army, move raid to completed
  const handleCollectRaid = useCallback(async (raidId: string) => {
    const raid = raidState.activeRaids.find(r => r.id === raidId);
    if (!raid) return;

    const isBG = raid.raidType === 'bg';
    const isWallSiege = raid.wallBlocked;

    // ── Server-side collect: all economic effects execute server-side ──
    let goldChange = 0;
    let bgCollected = 0;
    try {
      const res = await fetch('/api/war-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'collect_raid',
          raidId,
          attackerTokenId: activeTokenId,
          attackerAddress: address,
        }),
      });
      const data = await res.json();
      if (data.collected) {
        goldChange = data.goldChange || 0;
        bgCollected = data.bgStolen || 0;
      } else {
        // Fallback for pre-update raids (no pending_raid in Redis)
        if (!isWallSiege) {
          if (isBG) {
            goldChange = raid.success ? 0 : -raid.goldAmount;
          } else {
            goldChange = raid.success ? raid.goldAmount : -raid.goldAmount;
          }
        }
      }
    } catch (e) {
      console.error('[RAID COLLECT] Server error, using client fallback:', e);
      if (!isWallSiege) {
        if (isBG) {
          goldChange = raid.success ? 0 : -raid.goldAmount;
        } else {
          goldChange = raid.success ? raid.goldAmount : -raid.goldAmount;
        }
      }
    }

    // Apply gold change
    if (goldChange !== 0) {
      setGold(g => {
        const newGold = Math.max(0, g + goldChange);
        gameStateRef.current.gold = newGold;
        return newGold;
      });
      if (goldChange > 0) {
        setTotalGoldEarned(t => {
          const newTotal = t + goldChange;
          gameStateRef.current.totalGoldEarned = newTotal;
          return newTotal;
        });
      }
    }

    // Remove DEAD raiders from army roster
    setRaidStateSync(prev => {
      const newArmy = { ...prev.army };
      let lostCount = 0;
      for (const [tierId, count] of Object.entries(raid.raidersLost)) {
        newArmy[tierId] = Math.max(0, (newArmy[tierId] || 0) - count);
        lostCount += count;
      }

      const collected = { ...raid, collected: true };
      return {
        ...prev,
        army: newArmy,
        activeRaids: prev.activeRaids.filter(r => r.id !== raidId),
        completedRaids: [...prev.completedRaids, collected].slice(-20),
        raidsWon: prev.raidsWon + (!isWallSiege && raid.success ? 1 : 0),
        raidsLost: prev.raidsLost + (!isWallSiege && !raid.success ? 1 : 0),
        totalStolen: prev.totalStolen + (!isWallSiege && !isBG && raid.success ? Math.max(0, goldChange) : 0),
        totalGoldLost: prev.totalGoldLost + (!isWallSiege && !raid.success ? Math.abs(goldChange) : 0),
        totalBGStolen: (prev.totalBGStolen || 0) + (!isWallSiege && isBG && raid.success ? bgCollected : 0),
        totalLost: prev.totalLost + lostCount,
      };
    });
    playSound(raid.success ? 'upgrade' : 'click', 1, soundEnabled);
    // Immediate save: army losses + gold/BG changes from collection must persist
    setTimeout(() => { if (saveGameRef.current) saveGameRef.current(); }, 500);
  }, [soundEnabled, raidState.activeRaids, activeTokenId, address]);
  
  // ============ SEASON 3 v2: CLOVER COLLECT HANDLER ============
  const handleCloverCollect = useCallback((cloverGold: number, cloverName: string) => {
    setGold(g => {
      const newGold = g + cloverGold;
      gameStateRef.current.gold = newGold;
      return newGold;
    });
    setTotalGoldEarned(t => {
      const newTotal = t + cloverGold;
      gameStateRef.current.totalGoldEarned = newTotal;
      return newTotal;
    });
    playSound('combo', 8, soundEnabled);
  }, [soundEnabled]);
  
  // ============ SEASON 3 v2: ACTIVE CLICKING TRACKER ============
  useEffect(() => {
    if (!isActivelyClicking) return;
    const timeout = setTimeout(() => {
      if (Date.now() - lastActiveClickRef.current > 5000) {
        setIsActivelyClicking(false);
      }
    }, 5500);
    return () => clearTimeout(timeout);
  }, [isActivelyClicking, totalClicks]); // re-check on each click
  
  // Expedition temp multiplier for earnings calculations
  const expTempMultiplier = expeditionTempMultiplier && Date.now() < expeditionTempMultiplier.endTime 
    ? expeditionTempMultiplier.multiplier : 1;
  
  // ============ SEASON 3: EFFECTIVE GPS WITH ALL BONUSES ============
  const effectiveGPS = Math.floor(
    (basePerSecond + expeditionGpsBonus) * boostMultiplier * globalMultiplier * goldRushMultiplier * expTempMultiplier * eventGpsMult
  );

  // ============ RENDER ============
  return (
    <div className="space-y-6">
      {/* ═══ ONBOARDING TUTORIAL (hidden while season claim is active) ═══ */}
      {showTutorial && !showSeasonClaim && (
        <GameTutorial onComplete={() => setShowTutorial(false)} />
      )}

      {/* ═══ SEASON REWARDS CLAIM ═══ */}
      {showSeasonClaim && seasonRewards && (
        <SeasonClaim
          tokenId={activeTokenId!}
          currentGold={gold}
          playerData={seasonRewards.playerData}
          season={seasonRewards.season}
          poolMicroBG={seasonRewards.poolMicroBG}
          poolBG={seasonRewards.poolBG}
          totalPlayers={seasonRewards.totalPlayers}
          snapshotTime={seasonRewards.snapshotTime}
          onComplete={(goldSpent: number) => {
            // Deduct gold from local state (server already deducted)
            setGold(g => {
              const newGold = Math.max(0, g - goldSpent);
              gameStateRef.current.gold = newGold;
              return newGold;
            });
            setShowSeasonClaim(false);
            setSeasonRewards(null);
          }}
        />
      )}

      {/* RPG-Style HUD Bar */}
      <div className="hud-bar">
        <div className="hud-stat">
          <div className="hud-label">Level</div>
          <div className="relative inline-flex items-center justify-center">
            <div className="level-badge">
              <span className="hud-value text-lg text-[#D4AF37] relative z-10">{level}</span>
            </div>
          </div>
          <div className="text-[9px] text-gray-500 font-display truncate max-w-[80px] mx-auto">{LEVEL_TITLES[level - 1]}</div>
          {(warChest.totalVaulted > 0 || getTotalBG(warChest) > 0) && (
            <div className="text-[9px] mt-0.5">
              {warChest.totalVaulted > 0 && <span className="text-[#D4AF37]">🏦 {fmtNum(warChest.totalVaulted)}</span>}
              {getTotalBG(warChest) > 0 && <span className="text-[#FDE047] ml-1">🔒 {getTotalBG(warChest).toFixed(4)}</span>}
            </div>
          )}
        </div>
        <div className="hud-stat">
          <div className="hud-label"><span className="hud-gold-icon" style={{ perspective: '100px' }}>🪙</span> Gold</div>
          <div className="hud-value text-lg text-[#FDE047]" title={gold.toLocaleString()}>{fmtNum(gold)}</div>
          {tradePickaxe.id !== 'none' && (
            <div className="text-[9px] text-orange-400 mt-0.5">{tradePickaxe.emoji} {tradePickaxe.name}</div>
          )}
        </div>
        <div className="hud-stat">
          <div className="hud-label">Click</div>
          <div className="hud-value text-lg text-green-400">+{fmtNum(Math.floor(basePerClick * combo * boostMultiplier * globalMultiplier * eventClickMult))}</div>
        </div>
        <div className="hud-stat">
          <div className="hud-label">GPS</div>
          <div className="hud-value text-lg text-blue-400 hud-gps-tick">+{fmtNum(effectiveGPS)}</div>
          {expeditionGpsBonus > 0 && <div className="text-[9px] text-emerald-400">+{fmtNum(expeditionGpsBonus)} exp</div>}
        </div>
      </div>

      {/* Active Event Banner */}
      {activeEvent && <MineEventBanner activeEvent={activeEvent} />}

      {/* Trade Pickaxe Badge */}
      {tradePickaxe.id !== 'none' && (
        <div className="bg-gradient-to-r from-orange-900/20 to-transparent border border-orange-500/30 rounded-xl p-3 flex items-center gap-3">
          <span className="text-2xl">{tradePickaxe.emoji}</span>
          <div className="flex-1">
            <div className="text-sm font-bold text-orange-400">{tradePickaxe.name}</div>
            <div className="text-xs text-gray-400">{tradePickaxe.description}</div>
          </div>
          <div className="text-xs text-gray-500 font-mono">{mineswapTradeCount} trades</div>
        </div>
      )}

      {/* XP Progress — Carved Bar with Notches */}
      <div className="px-1">
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-gray-500 font-display text-[10px] tracking-wider uppercase">Level {level}</span>
          <span className="text-[#D4AF37] font-numbers text-[11px]">{xpProgress.percent.toFixed(1)}%</span>
        </div>
        <div className="xp-bar-track relative">
          <div 
            className="xp-bar-fill"
            style={{ width: `${xpProgress.percent}%` }}
          />
          {/* Notch marks at 25/50/75% */}
          <div className="xp-notch" style={{ left: '25%' }} />
          <div className="xp-notch" style={{ left: '50%' }} />
          <div className="xp-notch" style={{ left: '75%' }} />
        </div>
        <div className="text-[9px] text-gray-600 mt-1 font-numbers text-center">
          {fmtNum(xpProgress.current)} / {fmtNum(xpProgress.needed)} XP
        </div>
      </div>

      {/* Active Boost Banner */}
      {bonuses.activeBoost && (
        <div className="bg-gradient-to-r from-purple-900/50 to-blue-900/50 border border-purple-500 rounded-xl p-4 text-center animate-pulse">
          <span className="text-purple-300">⚡ {bonuses.activeBoost.multiplier}x BOOST ACTIVE</span>
          <span className="text-gray-400 ml-2">
            {Math.floor(bonuses.activeBoost.remaining / 60000)}:{String(Math.floor((bonuses.activeBoost.remaining % 60000) / 1000)).padStart(2, '0')} remaining
          </span>
        </div>
      )}

      {/* Tab Navigation — Medieval Style */}
      <div className="game-tab-bar scrollbar-hide">
        {(['game', 'expeditions', 'progress', 'war', 'shop'] as const).map(view => (
          <button
            key={view}
            onClick={() => {
              // Save before switching views to prevent data loss
              if (saveGameRef.current) saveGameRef.current();
              setActiveView(view);
            }}
            className={`game-tab ${
              activeView === view
                ? view === 'war'
                  ? 'game-tab-war-active'
                  : 'game-tab-active'
                : view === 'war'
                  ? 'game-tab-war-inactive'
                  : ''
            } ${view === 'war' && isUnderAttack && activeView !== 'war' ? 'war-tab-shake' : ''}`}
          >
            {view === 'game' && '⛏️ Mine'}
            {view === 'expeditions' && '🗺️ Dig'}
            {view === 'progress' && '🏆 Goals'}
            {view === 'war' && (
              <span className="relative">
                ⚔️ War
                {isUnderAttack && activeView !== 'war' && (
                  <span className="absolute -top-1 -right-2 w-2.5 h-2.5 bg-red-500 rounded-full animate-ping" />
                )}
                {isUnderAttack && activeView !== 'war' && (
                  <span className="absolute -top-1 -right-2 w-2.5 h-2.5 bg-red-500 rounded-full" />
                )}
              </span>
            )}
            {view === 'shop' && '🛒 Shop'}
          </button>
        ))}
      </div>

      {/* Season 3 Badge */}
      {TEST_MODE && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-2 text-center">
          <span className="text-emerald-400 text-xs font-bold">🍀 SEASON 3 TEST BUILD — "The War"</span>
        </div>
      )}
      
      {/* Gold Rush Overlay */}
      <GoldRushOverlay 
        isActive={goldRushActive} 
        timeRemaining={goldRushEndTime - Date.now()} 
        multiplier={GOLD_RUSH_MULTIPLIER} 
      />
      
      {/* Achievement Popup */}
      {achievementPopupQueue.length > 0 && (
        <AchievementPopup 
          achievement={achievementPopupQueue[0]} 
          onDismiss={handleDismissAchievement} 
        />
      )}

      {/* Mini-Boss Encounter */}
      {activeBoss && (
        <BossEncounter
          boss={activeBoss}
          onDefeat={handleBossDefeat}
          onTimeout={handleBossTimeout}
          level={level}
        />
      )}

      {/* Expedition Temp Boost Banner */}
      {expeditionTempMultiplier && Date.now() < expeditionTempMultiplier.endTime && (
        <div className="bg-gradient-to-r from-emerald-900/50 to-teal-900/50 border border-emerald-500 rounded-xl p-4 text-center">
          <span className="text-emerald-300">🗺️ Expedition Boost: {expeditionTempMultiplier.multiplier}x ALL earnings</span>
          <span className="text-gray-400 ml-2">
            {Math.floor((expeditionTempMultiplier.endTime - Date.now()) / 60000)}m remaining
          </span>
        </div>
      )}
      
      {/* Gold Rush Active Banner (inline) */}
      {goldRushActive && (
        <div className="bg-gradient-to-r from-[#D4AF37]/20 to-[#FDE047]/20 border-2 border-[#D4AF37] rounded-xl p-3 text-center animate-pulse">
          <span className="text-[#FDE047] font-bold text-lg">⚡ GOLD RUSH {GOLD_RUSH_MULTIPLIER}x ⚡</span>
          <span className="text-[#D4AF37] text-sm ml-2">{Math.max(0, Math.ceil((goldRushEndTime - Date.now()) / 1000))}s</span>
        </div>
      )}

      {/* Offline Earnings Notification */}
      {offlineEarnings && (
        <div 
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-bounce"
          onClick={() => setOfflineEarnings(null)}
        >
          <div className="bg-gradient-to-r from-[#D4AF37] to-[#FDE047] text-black px-6 py-4 rounded-xl shadow-2xl cursor-pointer">
            <div className="text-center">
              <div className="text-2xl mb-1">🎉 Welcome Back!</div>
              <div className="text-lg font-bold">
                Your Auto-Miner earned <span className="text-green-700">+{offlineEarnings.gold.toLocaleString()}</span> gold
              </div>
              <div className="text-sm opacity-80">while you were away for {offlineEarnings.time}</div>
              <div className="text-xs mt-2 opacity-60">tap to dismiss</div>
            </div>
          </div>
        </div>
      )}

      {/* Game View */}
      {activeView === 'game' && (
        <div className="relative">
          {/* Under Attack Red Vignette */}
          {isUnderAttack && <div className="under-attack-vignette" />}

          {/* Under Attack Alert Banner */}
          {isUnderAttack && (
            <div className="mb-3 rounded-xl p-3 border-2 border-red-500/60 bg-gradient-to-r from-red-900/40 to-red-950/40 relative overflow-hidden">
              {/* Floating embers */}
              {[...Array(5)].map((_, i) => (
                <div key={i} className="ember-particle" style={{ left: `${10 + i * 18}%`, bottom: '0', animationDelay: `${i * 0.5}s` }} />
              ))}
              <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-2">
                  <span className="text-xl raid-horn-icon">🚨</span>
                  <div>
                    <div className="text-sm font-bold text-red-400 font-display tracking-wide">MINE UNDER ATTACK!</div>
                    <div className="text-xs text-red-300/70">{recentAttackCount} raid{recentAttackCount !== 1 ? 's' : ''} in the last 30 min — no walls to defend!</div>
                  </div>
                </div>
                <button onClick={() => setActiveView('war')}
                  className="btn-war text-xs whitespace-nowrap">
                  🛡️ Defend
                </button>
              </div>
            </div>
          )}
          <div 
            className={`text-center relative rounded-2xl p-6 overflow-hidden transition-all duration-1000 mine-atmosphere ${
              isUnderAttack ? 'ring-2 ring-red-500/50 shadow-lg shadow-red-900/30' : ''
            }`}
            style={{ background: isUnderAttack ? 'linear-gradient(135deg, #1a0000 0%, #0a0000 50%, #1a0505 100%)' : mineTheme.bgGradient }}
          >
          {/* Floating mine particles (embers during attack) */}
          {isUnderAttack ? (
            [...Array(8)].map((_, i) => (
              <div key={i} className="ember-particle" style={{ left: `${5 + i * 12}%`, bottom: `${5 + (i * 7) % 20}%`, animationDelay: `${i * 0.4}s`, animationDuration: `${2 + i * 0.5}s` }} />
            ))
          ) : (
            mineTheme.particleEmojis.map((emoji, i) => (
              <span 
                key={i}
                className="mine-particle"
                style={{ 
                  left: `${15 + i * 20}%`, 
                  bottom: `${10 + (i * 13) % 30}%`,
                  animationDelay: `${i * 1.2}s`,
                  animationDuration: `${3 + i * 0.8}s`,
                }}
              >
                {emoji}
              </span>
            ))
          )}
          
          {/* Mine Theme Name */}
          <div className="text-[10px] font-display tracking-widest mb-2 opacity-50 uppercase" style={{ color: mineTheme.accentColor }}>
            ⛏️ {mineTheme.name}
          </div>

          {/* Lucky Clover Overlay */}
          <LuckyCloverSystem
            basePerClick={basePerClick}
            level={level}
            onCollect={handleCloverCollect}
            isActive={isActivelyClicking}
            testMode={TEST_MODE}
          />

          {/* Combo Display */}
          <div className="mb-4">
            <span className={`text-3xl font-display font-bold ${combo >= maxCombo ? 'text-red-400 animate-pulse' : combo >= 5 ? 'text-orange-400' : 'text-[#D4AF37]'}`}>
              {combo}x <span className="text-xl tracking-wider">COMBO</span>
            </span>
            {maxCombo <= 15 ? (
              <div className="flex justify-center gap-1 mt-2">
                {Array.from({ length: maxCombo }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-3 h-3 rounded-full transition-all ${
                      i < combo ? 'bg-[#D4AF37] shadow-[0_0_6px_rgba(212,175,55,0.5)]' : 'bg-gray-700'
                    }`}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-2 mx-auto max-w-xs">
                <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-200 ${
                      combo >= maxCombo ? 'bg-red-400 animate-pulse' : 'bg-gradient-to-r from-[#D4AF37] to-[#FDE047]'
                    }`}
                    style={{ width: `${(combo / maxCombo) * 100}%` }}
                  />
                </div>
                <div className="text-xs text-gray-500 mt-1 font-numbers">{combo}/{maxCombo} {(bonuses.noComboDecay || eventNoComboDecay) && '🔱 No Decay'}</div>
              </div>
            )}
          </div>

          {/* Click Target with Concentric Rings */}
          <div className="click-target-wrapper">
            {/* Outer ring — level progress arc */}
            <div className="click-ring-outer" style={{
              borderColor: isUnderAttack ? 'rgba(239, 68, 68, 0.2)' : 'rgba(212, 175, 55, 0.15)',
            }} />
            {/* Mid ring — combo indicator */}
            <div className="click-ring-mid" style={{
              borderColor: combo >= maxCombo 
                ? 'rgba(239, 68, 68, 0.5)' 
                : `rgba(212, 175, 55, ${0.1 + (combo / maxCombo) * 0.4})`,
              boxShadow: combo >= 5 ? `0 0 ${combo * 2}px rgba(212, 175, 55, ${combo / maxCombo * 0.3})` : 'none',
            }} />
            <button
              onClick={handleClick}
              className={`w-48 h-48 rounded-full bg-gradient-to-br ${mineTheme.buttonGradient} flex items-center justify-center text-7xl shadow-2xl hover:scale-105 active:scale-95 transition-transform gold-glow relative overflow-hidden`}
              style={{
                boxShadow: isUnderAttack 
                  ? '0 0 30px rgba(239, 68, 68, 0.4), 0 0 60px rgba(239, 68, 68, 0.2)' 
                  : undefined,
              }}
            >
              {bonuses.hasGoat ? '🐐' : bonuses.hasCrown ? '👑' : '⛏️'}
            </button>
            
            {/* Ore-Enhanced Click Effects */}
            {clickEffects.map(effect => (
              <div
                key={effect.id}
                className={`absolute font-numbers font-bold pointer-events-none ${
                  effect.isCrit 
                    ? 'text-green-400 text-2xl' 
                    : effect.oreColor 
                      ? 'text-xl'
                      : 'text-[#FDE047] text-xl'
                }`}
                style={{
                  left: effect.x,
                  top: effect.y,
                  transform: 'translate(-50%, -50%)',
                  animation: 'floatUp 1s ease-out forwards',
                  color: effect.oreColor || undefined,
                  textShadow: effect.isCrit 
                    ? '0 0 10px #4ADE80, 0 0 20px #4ADE80' 
                    : effect.oreColor 
                      ? `0 0 8px ${effect.oreColor}, 0 0 16px ${effect.oreColor}`
                      : 'none',
                }}
              >
                {effect.oreEmoji && <span className="text-xs">{effect.oreEmoji} </span>}
                {effect.isCrit && <span className="text-xs font-display">CRIT! </span>}
                +{fmtNum(effect.amount)}
              </div>
            ))}
          </div>

          {/* Burns & Leaderboard — NFT-gated only (no burn requirement) */}
          <div className="mt-8 grid grid-cols-2 gap-4">
            <div className="card-gold p-4">
              <div className="text-gray-400 text-xs font-display tracking-wider">🔥 Season Burns</div>
              <div className="text-2xl font-bold text-red-400 font-numbers">{burnCount}</div>
              <div className="text-[10px] text-gray-500 font-numbers">{totalBurned.toFixed(4)} BG burned</div>
            </div>
            <button
              onClick={submitToLeaderboard}
              disabled={isSubmittingScore}
              className="card-dark p-4 hover:border-[#D4AF37] border border-gray-800 transition-all disabled:opacity-50"
            >
              <div className="text-gray-400 text-xs font-display tracking-wider">🏆 Leaderboard</div>
              <div className="text-lg font-bold text-[#D4AF37] font-display">
                {isSubmittingScore ? 'Signing...' : 'Submit Score'}
              </div>
            </button>
          </div>

          {/* Sound Toggle + Manual Save + Tutorial Replay */}
          <div className="flex gap-4 justify-center items-center mt-4 flex-wrap">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="text-gray-500 hover:text-gray-300 text-sm"
            >
              {soundEnabled ? '🔊 Sound On' : '🔇 Sound Off'}
            </button>
            <button
              onClick={() => setShowTutorial(true)}
              className="text-gray-500 hover:text-gray-300 text-sm"
            >
              📖 Tutorial
            </button>
            <button
              onClick={async () => {
                // Get the most current values — use actual gold, NOT loaded gold
                // Gold legitimately decreases from purchases
                const refGold = gameStateRef.current.gold;
                const currentGold = Math.max(gold, refGold);
                const currentClicks = Math.max(totalClicks, gameStateRef.current.totalClicks);
                
                console.log('[MANUAL SAVE] State:', gold, 'Ref:', refGold, '→ Using:', currentGold);
                setLastSaveStatus('saving');
                
                try {
                  const res = await fetch('/api/game', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      address,
                      tokenId: activeTokenId,
                      gameState: { 
                        gold: currentGold, 
                        totalClicks: currentClicks, 
                        totalGoldEarned: Math.max(totalGoldEarned, currentGold), 
                        upgrades,
                        maxCombo,
                        autoClickRate: bonuses.autoClickRate || 0,
                        goldPerSecond: Math.floor(basePerSecond * boostMultiplier * globalMultiplier),
                      },
                    }),
                  });
                  const data = await res.json();
                  console.log('[MANUAL SAVE] Response:', data);
                  if (data.success) {
                    setLastSaveStatus('success');
                    setLastSaveTime(Date.now());
                    loadedGameRef.current = { gold: currentGold, totalClicks: currentClicks, upgrades };
                    // Sync state if ref had higher value
                    if (currentGold > gold) {
                      setGold(currentGold);
                    }
                  } else {
                    setLastSaveStatus('error');
                    alert('Save failed: ' + (data.error || 'Unknown error'));
                  }
                } catch (e) {
                  console.error('[MANUAL SAVE] Error:', e);
                  setLastSaveStatus('error');
                }
              }}
              disabled={lastSaveStatus === 'saving'}
              className={`text-sm px-3 py-1 rounded-lg transition-all ${
                lastSaveStatus === 'saving' 
                  ? 'bg-yellow-500/20 text-yellow-400' 
                  : lastSaveStatus === 'success' && lastSaveTime > 0 && (Date.now() - lastSaveTime) < 3000
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
              }`}
            >
              {lastSaveStatus === 'saving' ? '💾 Saving...' : '💾 Save Now'}
            </button>
          </div>

          {/* Save Status Bar */}
          <div className="mt-2 flex items-center justify-center gap-2 text-xs">
            {lastSaveStatus === 'success' && lastSaveTime > 0 && (
              <span className="text-green-400/70">
                ✓ Last save: {Math.floor((Date.now() - lastSaveTime) / 1000)}s ago
              </span>
            )}
            {lastSaveStatus === 'error' && (
              <span className="text-red-400">❌ Save failed</span>
            )}
            <span className="text-gray-600">|</span>
            <span className="text-gray-500 font-numbers">
              ⚡ {fmtNum(effectiveGPS)}/s
            </span>
          </div>

          {/* Upgrades Section - Below the mining area */}
          <div className="mt-6">
            <h3 className="text-[#D4AF37] mb-3 text-sm font-display tracking-wider flex items-center gap-2">
              <span>⚡</span>
              <span>Upgrades</span>
              <span className="text-[10px] text-gray-500 ml-auto font-numbers">Lv.{level}</span>
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(upgrades).map(([key, upgrade]) => {
                const canAfford = gold >= upgrade.cost;
                const unlocked = level >= upgrade.unlockLevel;
                const isLucky = key === 'luckyStrike';
                const isBoost = key === 'goldBoost' || key === 'refinery';
                const isS3 = ['geologist', 'deepShaft', 'refinery', 'tunnelBorer', 'motherLode', 'quantumDrill', 'voidExtractor', 'cosmicForge'].includes(key);
                const maxOwned = (upgrade as any).maxOwned || Infinity;
                const isMaxed = upgrade.owned >= maxOwned;
                const bonusText = isLucky 
                  ? `${upgrade.owned}% crit` 
                  : isBoost 
                  ? `+${Math.round((Math.pow(1 + ((upgrade as any).boostPercent || 0.1), upgrade.owned) - 1) * 100)}%` 
                  : upgrade.perClick > 0 && upgrade.perSec > 0
                  ? `+${upgrade.perClick}/clk +${upgrade.perSec}/s`
                  : upgrade.perClick > 0 
                  ? `+${upgrade.perClick}/click` 
                  : `+${upgrade.perSec}/sec`;
                
                // Locked upgrade display
                if (!unlocked) {
                  return (
                    <div
                      key={key}
                      className="p-2.5 rounded-xl border border-gray-700/50 bg-gray-900/50 text-left text-sm relative overflow-hidden"
                    >
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10">
                        <div className="text-center">
                          <div className="text-2xl mb-1">🔒</div>
                          <div className="text-xs text-gray-400">Level {upgrade.unlockLevel}</div>
                        </div>
                      </div>
                      <div className="opacity-30">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-base">{upgrade.emoji}</span>
                          <span className="text-xs font-semibold text-white">{upgrade.name}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-500 text-xs font-mono">???</span>
                        </div>
                      </div>
                    </div>
                  );
                }
                
                return (
                  <button
                    key={key}
                    onClick={() => handleUpgrade(key)}
                    disabled={!canAfford || isMaxed}
                    className={`p-2.5 rounded-xl border transition-all text-left text-sm ${
                      isMaxed
                        ? 'bg-green-900/20 border-green-500/40 opacity-80'
                        : canAfford 
                        ? 'bg-gradient-to-br from-[#D4AF37]/15 to-[#D4AF37]/5 border-[#D4AF37]/40 hover:border-[#D4AF37]/60 hover:shadow-lg hover:shadow-[#D4AF37]/10' 
                        : 'bg-white/5 border-white/10 opacity-50'
                    } ${(isLucky || isBoost) ? 'border-purple-500/40' : isS3 ? 'border-emerald-500/30' : ''}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-base">{upgrade.emoji}</span>
                      <span className="text-xs font-semibold text-white">{upgrade.name}</span>
                      {(isLucky || isBoost) && <span className="text-[8px] text-purple-400 bg-purple-500/20 px-1 rounded">STRAT</span>}
                      {isS3 && <span className="text-[8px] text-emerald-400 bg-emerald-500/20 px-1 rounded">S3</span>}
                      {isMaxed && <span className="text-[8px] text-green-400 bg-green-500/20 px-1 rounded">MAX</span>}
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex flex-col">
                        <span className="text-[#D4AF37] text-xs font-numbers">
                          {isMaxed ? 'MAXED' : fmtNum(upgrade.cost)}
                        </span>
                        <span className={`text-[9px] font-numbers ${(isLucky || isBoost) ? 'text-purple-300' : isS3 ? 'text-emerald-300' : 'text-gray-500'}`}>{bonusText}</span>
                      </div>
                      <span className="text-gray-400 text-[10px] bg-white/10 px-1.5 py-0.5 rounded font-numbers">
                        {upgrade.owned}/{maxOwned === Infinity ? '∞' : maxOwned}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        </div>
      )}

      {/* Your Mine View - Animated Working Mine */}
      {activeView === 'war' && (
        <div className="space-y-6 war-atmosphere">
          {/* ═══ WAR SCENE CANVAS — Real-time base visualization ═══ */}
          <WarSceneCanvas
            level={level}
            gold={gold}
            microBG={totalBurned}
            wallHP={playerWallHP}
            ethWallsBought={ethWallsBought}
            ethWallHP={ethWallHP}
            goldWallsBuilt={goldWallsBuilt}
            catapults={playerCatapults}
            raidState={raidState}
            upgrades={upgrades}
            isUnderAttack={isUnderAttack}
            onBuildBarracks={handleBuildBarracks}
            onBuyEthWall={() => { setPlayerWallHP(hp => hp + 5); setEthWallsBought(c => c + 1); setEthWallHP(5); }}
            onBuyGoldWall={handleBuildGoldWall}
          />

          {/* Under Attack Alert in War Tab */}
          {isUnderAttack && (
            <div className="war-card p-3 border-2 !border-red-500/60 relative overflow-hidden">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="ember-particle" style={{ left: `${15 + i * 20}%`, bottom: '0', animationDelay: `${i * 0.6}s` }} />
              ))}
              <div className="flex items-center gap-2 relative z-10">
                <span className="text-xl raid-horn-icon">🚨</span>
                <div>
                  <div className="text-sm font-bold text-red-400 font-display tracking-wide">YOUR MINE IS UNDEFENDED!</div>
                  <div className="text-xs text-red-300/70">{recentAttackCount} recent raid{recentAttackCount !== 1 ? 's' : ''} — build walls below to stop attackers!</div>
                </div>
              </div>
            </div>
          )}

          {/* Smelter — BG countdown timer + batch tracking */}
          {activeTokenId && <Smelter tokenId={activeTokenId} />}

          {/* War Chest — Gold Vault */}
          <WarChestPanel
            gold={gold}
            level={level}
            warChest={warChest}
            onDeposit={handleWarChestDeposit}
            testMode={TEST_MODE}
          />

          {/* Mine Raids — Army & Attack */}
          {level >= 3 && activeTokenId && (
            <MineRaids
              gold={gold}
              level={level}
              tokenId={activeTokenId}
              attackerAddress={address || ''}
              playerName={`Mine #${activeTokenId}`}
              targetBGMap={targetBGMap}
              raidState={raidState}
              catapults={playerCatapults}
              onBuildBarracks={handleBuildBarracks}
              onQueueTraining={handleQueueTraining}
              onLaunchRaid={handleLaunchRaid}
              onCollectRaid={handleCollectRaid}
              onUseCatapults={handleUseCatapults}
              onSyncCatapults={handleSyncCatapults}
              testMode={TEST_MODE}
              preSelectTokenId={attackMenuTarget}
              onPreSelectConsumed={() => { setAttackMenuTarget(null); setTimeout(() => setRaidInProgress(false), 5000); }}
            />
          )}

          {/* Attack Menu — full player target list with mBG, walls, incoming raids */}
          {level >= 3 && activeTokenId && (
            <AttackMenu
              myTokenId={activeTokenId}
              onAttack={handleAttackMenuRaid}
              raidInProgress={raidInProgress}
            />
          )}

          {/* War Panel — Defense log, walls, catapults */}
          {level >= 3 && activeTokenId && (
            <WarPanel
              tokenId={activeTokenId}
              address={address || ''}
              playerName={`Mine #${activeTokenId}`}
              level={level}
              gold={gold}
              wallHP={playerWallHP}
              ethWallsBought={ethWallsBought}
              ethWallHP={ethWallHP}
              goldWallsBuilt={goldWallsBuilt}
              catapults={playerCatapults}
              onWallPurchased={() => { setPlayerWallHP(hp => hp + 5); setEthWallsBought(c => c + 1); setEthWallHP(5); }}
              onGoldWallBuilt={handleBuildGoldWall}
              onCatapultPurchased={() => setPlayerCatapults(c => c + 1)}
              onAttackStatus={handleAttackStatus}
            />
          )}

          {/* MineVisualization replaced by WarSceneCanvas above */}
        </div>
      )}

      {/* Season 3: Expeditions Tab */}
      {activeView === 'expeditions' && (
        <ExpeditionSystem
          level={level}
          gold={gold}
          goldPerSecond={effectiveGPS}
          activeExpedition={activeExpedition}
          completedExpeditions={completedExpeditions}
          legendaryExpeditions={legendaryExpeditions}
          expeditionGpsBonus={expeditionGpsBonus}
          expeditionTempMultiplier={expeditionTempMultiplier}
          onSendExpedition={handleSendExpedition}
          onClaimExpedition={handleClaimExpedition}
          soundEnabled={soundEnabled}
        />
      )}

      {/* Season 3: Progress Tab (Achievements + Daily Challenges) */}
      {activeView === 'progress' && (
        <div className="space-y-6">
          {/* Daily Challenges & Streak */}
          <DailyChallengesPanel
            challengeState={dailyChallengeState}
            loginStreak={loginStreak}
            onClaimChallenge={handleClaimChallenge}
            onClaimStreakBonus={handleClaimStreakBonus}
          />
          
          {/* Achievements */}
          <AchievementsPanel
            achievements={achievements}
            totalClicks={totalClicks}
            totalGoldEarned={totalGoldEarned}
            maxComboReached={maxComboReached}
            burnCount={burnCount}
            completedExpeditions={completedExpeditions}
            legendaryExpeditions={legendaryExpeditions}
            totalUpgrades={Object.values(upgrades).reduce((sum, u) => sum + u.owned, 0)}
            loginStreak={loginStreak.currentStreak}
            onClaimAchievement={handleClaimAchievement}
          />
        </div>
      )}

      {/* Shop View */}
      {activeView === 'shop' && (
        <div className="space-y-6">
          {/* Classic Items - Show first */}
          <div>
            <h3 className="text-gray-300 font-bold mb-4 flex items-center gap-2 font-display tracking-wider">
              ⛏️ Classic Items
              <span className="text-xs text-gray-500 font-numbers">(Stackable)</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {SHOP_ITEMS.filter(item => item.season === 1).map(item => {
                const owned = verifiedPurchases.filter(p => p.itemId === item.id).length;
                const isMaxed = item.maxOwned > 0 && owned >= item.maxOwned;
                return (
                  <div key={item.id} className={`bg-[#1a1a1a] p-4 rounded-xl border transition-all ${isMaxed ? 'border-green-700/50' : 'border-gray-700 hover:border-gray-500'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{item.emoji}</span>
                        <div>
                          <div className="font-bold text-white">{item.name}</div>
                          <div className="text-xs text-gray-400">{item.description}</div>
                        </div>
                      </div>
                      {/* Ownership tally */}
                      <span className={`text-xs font-numbers px-2 py-1 rounded-md ${
                        isMaxed ? 'bg-green-900/40 text-green-400' :
                        owned > 0 ? 'bg-[#D4AF37]/10 text-[#D4AF37]' : 'bg-gray-800 text-gray-500'
                      }`}>
                        {owned}/{item.maxOwned > 0 ? item.maxOwned : '∞'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-white font-bold">{item.priceETH} ETH</div>
                        <div className="text-xs text-gray-500">{item.priceUSD}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        {isMaxed ? (
                          <span className="text-green-400 font-bold text-sm">✓ Maxed</span>
                        ) : (
                          <button
                            onClick={() => handlePurchase(item)}
                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-all"
                          >
                            Buy & Burn
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Season 3 Exclusives - Premium styling */}
          <div>
            <h3 className="text-[#D4AF37] font-bold mb-4 flex items-center gap-2">
              ✨ Season 3 Exclusives
              <span className="text-xs bg-gradient-to-r from-emerald-500 to-teal-500 text-black px-2 py-0.5 rounded font-bold">🍀 NEW</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {SHOP_ITEMS.filter(item => item.season === 3).map(item => {
                const ownedCount = verifiedPurchases.filter(p => p.itemId === item.id).length;
                const owned = ownedCount > 0;
                return (
                  <div
                    key={item.id}
                    className={`p-4 rounded-xl ${
                      owned 
                        ? 'bg-green-900/20 border-2 border-green-500' 
                        : 'bg-gradient-to-br from-[#D4AF37]/10 to-transparent border-2 border-[#D4AF37]/50 hover:border-[#D4AF37] transition-all'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">{item.emoji}</span>
                        <div>
                          <div className="font-bold text-white flex items-center gap-2">
                            {item.name}
                            {item.tag && (
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                item.tag === 'LEGENDARY' ? 'bg-purple-500' :
                                item.tag === 'EPIC' ? 'bg-orange-500' :
                                item.tag === 'NFT TRAIT' ? 'bg-gradient-to-r from-cyan-500 to-blue-500' :
                                'bg-green-500'
                              } text-white font-bold`}>
                                {item.tag}
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-300">{item.description}</div>
                        </div>
                      </div>
                      {/* Ownership tally */}
                      <span className={`text-xs font-numbers px-2 py-1 rounded-md shrink-0 ${
                        owned ? 'bg-green-900/40 text-green-400' : 'bg-gray-800 text-gray-500'
                      }`}>
                        {ownedCount}/{item.maxOwned || '∞'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[#FDE047] font-bold text-lg">{item.priceETH} ETH</div>
                        <div className="text-xs text-gray-400">{item.priceUSD}</div>
                      </div>
                      {owned ? (
                        <span className="text-green-400 font-bold">✓ Owned</span>
                      ) : (
                        <button
                          onClick={() => handlePurchase(item)}
                          className="btn-gold px-5 py-2 text-sm font-bold"
                        >
                          🔥 Buy & Burn
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ⚔️ War Items — ETH Walls & Catapults */}
          <div>
            <h3 className="text-red-400 font-bold mb-4 flex items-center gap-2">
              ⚔️ War Items
              <span className="text-xs bg-red-900/50 text-red-300 px-2 py-0.5 rounded font-bold">DEFENSE & ATTACK</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* ETH Wall */}
              <div className={`p-4 rounded-xl ${
                ethWallHP > 0
                  ? 'bg-blue-900/20 border-2 border-blue-500'
                  : 'bg-gradient-to-br from-blue-500/10 to-transparent border-2 border-blue-500/50 hover:border-blue-400 transition-all'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">🧱</span>
                    <div>
                      <div className="font-bold text-white flex items-center gap-2">
                        ETH Wall
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-600 text-white font-bold">DEFENSE</span>
                      </div>
                      <div className="text-sm text-gray-300">{ETH_WALL_HP} HP shield. Rebuy when destroyed.</div>
                    </div>
                  </div>
                  {/* Ownership tally — active wall status */}
                  <span className={`text-xs font-numbers px-2 py-1 rounded-md shrink-0 ${
                    ethWallHP > 0 ? 'bg-blue-900/40 text-blue-400' : 'bg-gray-800 text-gray-500'
                  }`}>
                    {ethWallHP > 0 ? `${ethWallHP}/${ETH_WALL_HP} HP` : '0/1'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-blue-400 font-bold text-lg">{WALL_PRICE_ETH} ETH</div>
                    <div className="text-xs text-gray-400">~$2.50 • Lifetime bought: {ethWallsBought}</div>
                  </div>
                  {ethWallHP > 0 ? (
                    <span className="text-blue-400 font-bold text-sm">⛓️ Active</span>
                  ) : (
                    <button
                      onClick={() => setActiveView('war')}
                      className="px-5 py-2 text-sm font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-all"
                    >
                      🧱 Buy in War Tab
                    </button>
                  )}
                </div>
              </div>

              {/* Catapult */}
              <div className="p-4 rounded-xl bg-gradient-to-br from-red-500/10 to-transparent border-2 border-red-500/50 hover:border-red-400 transition-all">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">🏗️</span>
                    <div>
                      <div className="font-bold text-white flex items-center gap-2">
                        Catapult
                        <span className="text-xs px-1.5 py-0.5 rounded bg-red-600 text-white font-bold">ATTACK</span>
                      </div>
                      <div className="text-sm text-gray-300">Deals {CATAPULT_DAMAGE} HP damage to enemy walls.</div>
                    </div>
                  </div>
                  {/* Ownership tally */}
                  <span className={`text-xs font-numbers px-2 py-1 rounded-md shrink-0 ${
                    playerCatapults > 0 ? 'bg-red-900/40 text-red-400' : 'bg-gray-800 text-gray-500'
                  }`}>
                    {playerCatapults}/∞
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-red-400 font-bold text-lg">{CATAPULT_PRICE_ETH} ETH</div>
                    <div className="text-xs text-gray-400">~$1.70 • Consumable (used on attack)</div>
                  </div>
                  <button
                    onClick={() => setActiveView('war')}
                    className="px-5 py-2 text-sm font-bold rounded-lg bg-red-600 hover:bg-red-500 text-white transition-all"
                  >
                    🏗️ Buy in War Tab
                  </button>
                </div>
              </div>

              {/* Gold Wall (free — costs in-game gold) */}
              <div className={`p-4 rounded-xl md:col-span-2 ${
                goldWallsBuilt >= MAX_GOLD_WALLS
                  ? 'bg-yellow-900/10 border-2 border-yellow-600/50'
                  : 'bg-gradient-to-br from-yellow-500/5 to-transparent border-2 border-yellow-600/30 hover:border-yellow-500/50 transition-all'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🪨</span>
                    <div>
                      <div className="font-bold text-white flex items-center gap-2">
                        Gold Wall
                        <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-700 text-yellow-200 font-bold">FREE (Gold)</span>
                      </div>
                      <div className="text-xs text-gray-400">1 HP each. Costs in-game gold (scales per wall). Build in War tab.</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-numbers px-2 py-1 rounded-md ${
                      goldWallsBuilt >= MAX_GOLD_WALLS ? 'bg-green-900/40 text-green-400' :
                      goldWallsBuilt > 0 ? 'bg-yellow-900/30 text-yellow-400' : 'bg-gray-800 text-gray-500'
                    }`}>
                      {goldWallsBuilt}/{MAX_GOLD_WALLS}
                    </span>
                    {goldWallsBuilt < MAX_GOLD_WALLS && (
                      <button
                        onClick={() => setActiveView('war')}
                        className="px-4 py-1.5 text-xs font-bold rounded-lg bg-yellow-700 hover:bg-yellow-600 text-white transition-all"
                      >
                        Build →
                      </button>
                    )}
                    {goldWallsBuilt >= MAX_GOLD_WALLS && (
                      <span className="text-green-400 font-bold text-sm">✓ Maxed</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Info */}
          <div className="bg-[#1a1a1a] border border-gray-700 rounded-xl p-4 text-center text-sm">
            <p className="text-[#D4AF37] font-bold mb-1">🔥 100% of shop purchases burn BG!</p>
            <p className="text-gray-400">ETH is used to buy BG from the market and send it to the burn address.</p>
          </div>

          {/* ═══ PURCHASE HISTORY & BG BURN TRACKER ═══ */}
          <div className="bg-[#1a1a1a] border border-gray-700 rounded-xl overflow-hidden">
            <button
              onClick={() => {
                setShowPurchaseHistory(!showPurchaseHistory);
                if (!purchaseHistory && !isLoadingHistory) loadPurchaseHistory();
              }}
              className="w-full p-4 flex items-center justify-between hover:bg-[#222] transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">📜</span>
                <div className="text-left">
                  <div className="font-bold text-white">Purchase History</div>
                  <div className="text-xs text-gray-400">
                    {verifiedPurchases.length > 0
                      ? `${verifiedPurchases.length} purchase${verifiedPurchases.length !== 1 ? 's' : ''} • ${totalBurned > 0 ? totalBurned.toFixed(4) + ' BG burned' : 'Tap to load burn data'}`
                      : 'No purchases yet'}
                  </div>
                </div>
              </div>
              <span className={`text-gray-400 transition-transform ${showPurchaseHistory ? 'rotate-180' : ''}`}>▼</span>
            </button>

            {showPurchaseHistory && (
              <div className="border-t border-gray-700">
                {isLoadingHistory ? (
                  <div className="p-6 text-center">
                    <div className="animate-spin text-2xl mb-2">⛏️</div>
                    <p className="text-gray-400 text-sm">Loading purchase history from BaseScan...</p>
                  </div>
                ) : purchaseHistory ? (
                  <>
                    {/* Summary Stats */}
                    <div className="grid grid-cols-2 gap-3 p-4">
                      <div className="bg-black/50 rounded-lg p-3 text-center">
                        <div className="text-[#D4AF37] text-xl font-bold font-numbers">
                          {purchaseHistory.summary.totalBgBurned !== '0.000000'
                            ? parseFloat(purchaseHistory.summary.totalBgBurned).toFixed(4)
                            : '0'}
                        </div>
                        <div className="text-xs text-gray-400">🔥 Total BG Burned</div>
                      </div>
                      <div className="bg-black/50 rounded-lg p-3 text-center">
                        <div className="text-blue-400 text-xl font-bold font-numbers">
                          {parseFloat(purchaseHistory.summary.totalEthSpent).toFixed(4)}
                        </div>
                        <div className="text-xs text-gray-400">Ξ Total ETH Spent</div>
                      </div>
                      <div className="bg-black/50 rounded-lg p-3 text-center">
                        <div className="text-green-400 text-xl font-bold font-numbers">
                          {purchaseHistory.summary.totalPurchases}
                        </div>
                        <div className="text-xs text-gray-400">✅ Successful</div>
                      </div>
                      <div className="bg-black/50 rounded-lg p-3 text-center">
                        <div className={`text-xl font-bold font-numbers ${purchaseHistory.summary.failedPurchases > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                          {purchaseHistory.summary.failedPurchases}
                        </div>
                        <div className="text-xs text-gray-400">❌ Failed/Reverted</div>
                      </div>
                    </div>

                    {/* Item Breakdown */}
                    {purchaseHistory.summary.itemBreakdown.length > 0 && (
                      <div className="px-4 pb-3">
                        <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Item Breakdown</div>
                        <div className="space-y-1">
                          {purchaseHistory.summary.itemBreakdown.map((item: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between text-sm bg-black/30 rounded px-3 py-1.5">
                              <span className="text-white">{item.itemName} <span className="text-gray-500">×{item.count}</span></span>
                              <span className="text-[#D4AF37] font-numbers text-xs">
                                {parseFloat(item.totalBgBurned) > 0 ? `${parseFloat(item.totalBgBurned).toFixed(4)} BG` : `${parseFloat(item.totalEthSpent).toFixed(4)} ETH`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Individual Receipts */}
                    {purchaseHistory.receipts.length > 0 && (
                      <div className="px-4 pb-4">
                        <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Transaction Receipts</div>
                        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                          {purchaseHistory.receipts.map((receipt: any, idx: number) => (
                            <div
                              key={idx}
                              className={`rounded-lg p-3 text-sm ${
                                receipt.status === 'success'
                                  ? 'bg-black/40 border border-gray-800'
                                  : 'bg-red-900/10 border border-red-900/30'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-white font-medium">{receipt.itemName}</span>
                                <span className={`text-xs px-1.5 py-0.5 rounded ${
                                  receipt.status === 'success' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
                                }`}>
                                  {receipt.status === 'success' ? '✅' : '❌ Failed'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-xs text-gray-400">
                                <span>{new Date(receipt.timestamp).toLocaleDateString()} {new Date(receipt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                <span className="text-blue-400">{receipt.ethSpent} ETH</span>
                              </div>
                              {receipt.bgBurned > 0 && (
                                <div className="text-xs text-[#D4AF37] mt-1">
                                  🔥 Burned {receipt.bgBurned.toFixed(6)} BG
                                </div>
                              )}
                              <a
                                href={`https://basescan.org/tx/${receipt.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-500 hover:text-blue-400 mt-1 inline-block"
                              >
                                View on BaseScan ↗
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {purchaseHistory.receipts.length === 0 && (
                      <div className="p-6 text-center text-gray-500 text-sm">
                        No purchases found for this wallet.
                      </div>
                    )}

                    {/* Refresh button */}
                    <div className="px-4 pb-4">
                      {purchaseHistory?.cachedAt && (
                        <div className="text-[10px] text-gray-600 text-center mb-2">
                          Last scanned: {new Date(purchaseHistory.cachedAt).toLocaleTimeString()} • Source: {purchaseHistory.source || 'cache'}
                        </div>
                      )}
                      <button
                        onClick={() => loadPurchaseHistory(true)}
                        disabled={isLoadingHistory}
                        className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs transition-colors"
                      >
                        {isLoadingHistory ? '⏳ Scanning blockchain...' : '🔄 Re-scan Blockchain'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="p-6 text-center text-gray-500 text-sm">
                    <p>No purchase data found. Tap to scan the blockchain.</p>
                    <button
                      onClick={() => loadPurchaseHistory(true)}
                      disabled={isLoadingHistory}
                      className="mt-2 px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs"
                    >
                      {isLoadingHistory ? '⏳ Scanning...' : '🔍 Scan Blockchain'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Purchase Modal */}
      {showPurchaseModal && selectedItem && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="card-gold p-6 max-w-md w-full">
            <h3 className="text-2xl font-bold text-[#D4AF37] mb-4 text-center">Confirm Purchase</h3>
            
            <div className="text-center mb-6">
              <span className="text-6xl">{selectedItem.emoji}</span>
              <div className="text-xl font-bold text-white mt-2">{selectedItem.name}</div>
              <div className="text-gray-400">{selectedItem.description}</div>
            </div>
            
            <div className="bg-black/50 rounded-xl p-4 mb-6">
              <div className="flex justify-between">
                <span className="text-gray-400">Price:</span>
                <span className="text-[#D4AF37] font-bold">{selectedItem.priceETH} ETH</span>
              </div>
              <div className="flex justify-between mt-2">
                <span className="text-gray-400">Effect:</span>
                <span className="text-green-400">🔥 Burns BG</span>
              </div>
            </div>
            
            <div className="flex gap-4">
              <button
                onClick={() => { setShowPurchaseModal(false); setSelectedItem(null); }}
                className="flex-1 btn-outline-gold"
              >
                Cancel
              </button>
              <button
                onClick={confirmPurchase}
                disabled={isBurning || isBurnConfirming}
                className="flex-1 btn-gold"
              >
                {isBurning ? '⏳ Confirming...' : isBurnConfirming ? '⛏️ Mining...' : '🔥 Buy & Burn'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons — Buy ETH / Buy BG / Bridge */}
      <div className="flex gap-3 justify-center flex-wrap mt-6 pt-4 border-t border-gray-800/50">
        <button
          onClick={handleBuyEth}
          disabled={buyEthLoading}
          className="px-6 py-3 rounded-xl font-bold text-white transition-all duration-200 flex items-center gap-2"
          style={{
            background: 'linear-gradient(135deg, #0052FF 0%, #3B82F6 100%)',
            boxShadow: '0 4px 15px rgba(0,82,255,0.3)',
            cursor: buyEthLoading ? 'wait' : 'pointer',
            opacity: buyEthLoading ? 0.7 : 1,
          }}
          onMouseOver={(e) => { if (!buyEthLoading) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,82,255,0.4)'; } }}
          onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,82,255,0.3)'; }}
        >
          {buyEthLoading ? '⏳ Loading...' : '💳 Buy ETH'}
        </button>
        <a
          href="https://www.coinbase.com/price/basegold-base-0x36b712a629095234f2196bbb000d1b96c12ce78e-token"
          target="_blank"
          rel="noopener noreferrer"
          className="px-6 py-3 rounded-xl font-bold text-black transition-all duration-200 flex items-center gap-2"
          style={{
            background: 'linear-gradient(135deg, #D4AF37 0%, #FDE047 100%)',
            boxShadow: '0 4px 15px rgba(212,175,55,0.3)',
          }}
          onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(212,175,55,0.4)'; }}
          onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 15px rgba(212,175,55,0.3)'; }}
        >
          🪙 Buy BG
        </a>
        <a
          href="https://relay.link/bridge/base"
          target="_blank"
          rel="noopener noreferrer"
          className="px-6 py-3 rounded-xl font-bold text-white transition-all duration-200 flex items-center gap-2"
          style={{
            background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
            boxShadow: '0 4px 15px rgba(99,102,241,0.3)',
          }}
          onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(99,102,241,0.4)'; }}
          onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 15px rgba(99,102,241,0.3)'; }}
        >
          🌉 Bridge
        </a>
      </div>
    </div>
  );
}
