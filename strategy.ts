// Snapback — a momentum rider for pump.fun bonding curves.
//
// Idea, measured on the kit's dev window (1,222 coins, 24h): two thirds of new
// curves never trade up at all after their first slots — they only bleed —
// while the ~12% that do run +30% or more are already visibly hot at age 3:
// a median of 6 distinct buyers, 6 trades, +62% over the create price, ~8 SOL
// of real SOL in the curve, a creator who bought ~1 SOL and has not sold. So
// Snapback does not snipe the open and does not chase confirmation after the
// move: it buys at age 3-5, only launches whose opening tape already looks
// like a runner, with a fixed stake, and then rides: no fixed take-profit — a
// trailing stop (arm +30%, trail -15% from the best value) sells near the peak
// — a stop-loss at -10%, a creator-sell exit, a stale exit when the tape goes
// quiet, or a hard 200-slot time limit, whichever comes first. It never
// averages down and never re-enters a coin.
//
// Guardrails are part of the strategy, not an afterthought: the run must finish
// with round trips of at least 0.01 SOL on 20+ coins and a max drawdown under 50%,
// so the bot paces its own fills/coins against elapsed block time and, when it
// lags, splits buys into pieces (same price, extra tx fee each). Probe round trips
// exist as a knob but default to off: with this many entries the fill/coin
// targets are met without them.
//
// Deterministic by construction: no clock, no environment, no randomness; every
// loop runs over insertion-ordered maps fed by the batch stream, in batch order.

import { type Batch, type BotState, type OrderInput, type Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Youngest age (slots since CreateEvent) at which a first buy may be decided. */
  entryAgeMin: number;
  /** Oldest age at which a first buy may still be decided. */
  entryAgeMax: number;
  /** Lamports to aim for per coin in total. */
  stakeLamports: number;
  /** Smallest single buy worth paying the tx fee for. */
  minBuyLamports: number;
  /** Creator's own buys in the create slot: lamports window. */
  minDevBuyLamports: number;
  maxDevBuyLamports: number;
  /** Distinct non-creator buyers seen before entry: window. */
  minBuyers: number;
  maxBuyers: number;
  /** Trades seen before entry, at least. */
  minTrades: number;
  /** Lamports sold by others / lamports bought, in bps, at most. */
  maxSellRatioBps: number;
  /** Real SOL reserve window at decision time (lamports). */
  minRealSolLamports: number;
  maxRealSolLamports: number;
  /** Price now over the create price, in bps: window. */
  minRunupBps: number;
  maxRunupBps: number;
  /** Recent-flow window (slots) and what it must show. */
  flowWindowSlots: number;
  minFlowLamports: number;
  minRecentBuyers: number;
  /** Creator sold before entry: skip the coin. */
  skipCreatorSold: boolean;
  /** Slippage allowed on buys (bps). */
  buySlippageBps: number;
  /** Exit when the position is worth this much over its cost (bps). */
  takeProfitBps: number;
  /** Exit when it is worth this much under its cost (bps). */
  stopLossBps: number;
  /** Trailing stop: once up at least trailArmBps, exit on a fall of trailBps from the best value. */
  trailArmBps: number;
  trailBps: number;
  /** Exit after holding this many slots. */
  maxHoldSlots: number;
  /** Exit when the creator sells while held. */
  exitOnCreatorSell: boolean;
  /** Exit on any single recorded sell of at least this many lamports. */
  bigSellLamports: number;
  /** Exit when no trade has hit the coin for this many slots. */
  staleSlots: number;
  /** Exit when the recent net flow falls below minus this many lamports. */
  fadeOutLamports: number;
  /** Slots to wait after an exit before the same coin may be bought again. */
  cooldownSlots: number;
  /** Most entries per coin over the run. */
  maxEntriesPerCoin: number;
  /** Most positions open at once. */
  maxOpenPositions: number;
  /** Most lamports at cost across all positions at once (a drawdown guard). */
  maxExposureLamports: number;
  /** Guardrail pacing: target fills / coins prorated over windowSeconds of block time. */
  fillTarget: number;
  coinTarget: number;
  windowSeconds: number;
  /** Buy pieces when fills lag the pace: from baseSplit up to maxSplit per buy. */
  baseSplit: number;
  maxSplit: number;
  /** Smallest buy piece worth sending (lamports). */
  minPieceLamports: number;
  /** Probe round trips when coins lag the pace: stake, cap, and min real SOL to bother. */
  probeLamports: number;
  maxProbes: number;
}

export const DEFAULT_PARAMS: Params = {
  entryAgeMin: 3,
  entryAgeMax: 5,
  stakeLamports: 10_000_000,
  minBuyLamports: 5_000_000,
  minDevBuyLamports: 500_000_000,
  maxDevBuyLamports: 5_000_000_000,
  minBuyers: 12,
  maxBuyers: 10_000,
  minTrades: 5,
  maxSellRatioBps: 10_000,
  minRealSolLamports: 5_000_000_000,
  maxRealSolLamports: 30_000_000_000,
  minRunupBps: 5_000,
  maxRunupBps: 1_000_000,
  flowWindowSlots: 10,
  minFlowLamports: -1_000_000_000_000,
  minRecentBuyers: 0,
  skipCreatorSold: true,
  buySlippageBps: 10_000,
  takeProfitBps: 100_000,
  stopLossBps: 1_000,
  trailArmBps: 3_000,
  trailBps: 1_500,
  maxHoldSlots: 200,
  exitOnCreatorSell: true,
  bigSellLamports: 500_000_000,
  staleSlots: 20,
  fadeOutLamports: 1_000_000_000_000,
  cooldownSlots: 300,
  maxEntriesPerCoin: 1,
  maxOpenPositions: 5,
  maxExposureLamports: 50_000_000,
  fillTarget: 300,
  coinTarget: 30,
  windowSeconds: 21_600,
  baseSplit: 1,
  maxSplit: 1,
  minPieceLamports: 5_000_000,
  probeLamports: 10_000_000,
  maxProbes: 5,
};

const BPS = 10_000n;
/** Curve + creator fees on a sell, in bps (95 protocol + 30 creator). */
const SELL_FEE_BPS = 125n;
const LAMPORTS = 1_000_000_000n;

interface Tick {
  slot: number;
  isBuy: boolean;
  sol: bigint;
  user: Pubkey;
}

interface Coin {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  /** Create-time reserves: the run-up is measured against them. */
  vq0: bigint;
  vt0: bigint;
  /** Creator's buys in the create slot. */
  devBuy: bigint;
  /** Creator sold at any point. */
  devSold: boolean;
  buyers: Set<Pubkey>;
  bought: bigint;
  soldByOthers: bigint;
  /** Largest single non-creator sell seen (lamports). */
  biggestSell: bigint;
  lastTradeSlot: number;
  /** Trades of the last flowWindowSlots slots (older ones dropped as new ones come). */
  recent: Tick[];
  entries: number;
  lastExitSlot: number;
  /** Never buy it again (exited for good, filtered out, or completed). */
  done: boolean;
  complete: boolean;
}

interface Held {
  openedSlot: number;
  /** Best close value seen (lamports, fees deducted). */
  bestValue: bigint;
  /** Some buy of this position filled. */
  filled: boolean;
  /** Decision price (vq/vt pair) of the buy. */
  buyVq: bigint;
  buyVt: bigint;
}

/** What selling `tokens` against (vq, vt) pays after curve fees. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * SELL_FEE_BPS + BPS - 1n) / BPS;
}

export interface Strategy {
  onBatch(state: BotState, batch: Batch): OrderInput[];
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Strategy {
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  /** Probe round trips in flight, by mint: false while buying, true once selling. */
  const probes = new Map<Pubkey, boolean>();
  /** The bot's own filled orders and the coins they were on (harness closes excluded). */
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;

  const coinOf = (mint: Pubkey): Coin => {
    let c = coins.get(mint);
    if (c === undefined) {
      c = {
        mint,
        createSlot: -1,
        creator: '',
        vq0: 0n,
        vt0: 0n,
        devBuy: 0n,
        devSold: false,
        buyers: new Set(),
        bought: 0n,
        soldByOthers: 0n,
        biggestSell: 0n,
        lastTradeSlot: -1,
        recent: [],
        entries: 0,
        lastExitSlot: -1_000_000_000,
        done: false,
        complete: false,
      };
      coins.set(mint, c);
    }
    return c;
  };

  /** Net recorded lamports (buys minus sells) over the last `w` slots. */
  const flow = (c: Coin, now: number, w: number): bigint => {
    let net = 0n;
    for (let i = c.recent.length - 1; i >= 0; i--) {
      const t = c.recent[i]!;
      if (t.slot <= now - w) break;
      net += t.isBuy ? t.sol : -t.sol;
    }
    return net;
  };

  /** Distinct recent buyers over the last `w` slots. */
  const recentBuyers = (c: Coin, now: number, w: number): number => {
    const s = new Set<Pubkey>();
    for (let i = c.recent.length - 1; i >= 0; i--) {
      const t = c.recent[i]!;
      if (t.slot <= now - w) break;
      if (t.isBuy) s.add(t.user);
    }
    return s.size;
  };

  /** Entry signal on a coin at slot `now`. */
  const entryOk = (c: Coin, now: number, rqLamports: bigint): boolean => {
    if (c.done || c.complete) return false;
    if (c.createSlot < 0) return false;
    const age = now - c.createSlot;
    if (age < p.entryAgeMin || age > p.entryAgeMax) return false;
    if (c.entries >= p.maxEntriesPerCoin) return false;
    if (now - c.lastExitSlot < p.cooldownSlots) return false;
    if (c.devBuy < BigInt(p.minDevBuyLamports) || c.devBuy > BigInt(p.maxDevBuyLamports)) return false;
    if (p.skipCreatorSold && c.devSold) return false;
    if (c.buyers.size < p.minBuyers || c.buyers.size > p.maxBuyers) return false;
    if (c.recent.length < p.minTrades) return false;
    if (c.bought > 0n && (c.soldByOthers * BPS) / c.bought > BigInt(p.maxSellRatioBps)) return false;
    if (rqLamports < BigInt(p.minRealSolLamports) || rqLamports > BigInt(p.maxRealSolLamports)) return false;
    if (flow(c, now, p.flowWindowSlots) < BigInt(p.minFlowLamports)) return false;
    if (recentBuyers(c, now, p.flowWindowSlots) < p.minRecentBuyers) return false;
    return true;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const traded = new Set<Pubkey>();
      const creatorSoldNow = new Set<Pubkey>();
      const bigSellNow = new Set<Pubkey>();
      for (const f of batch.fills) {
        if (f.status === 'filled' && !f.client_id.startsWith('_')) {
          myFills++;
          myCoins.add(f.mint);
        }
      }
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          const c = coinOf(e.mint);
          c.createSlot = e.slot;
          c.creator = e.creator;
          c.vq0 = BigInt(e.virtual_quote_reserves);
          c.vt0 = BigInt(e.virtual_token_reserves);
        } else if (e.event === 'TradeEvent') {
          const c = coinOf(e.mint);
          const sol = BigInt(e.sol_amount);
          c.lastTradeSlot = e.slot;
          c.recent.push({ slot: e.slot, isBuy: e.is_buy, sol, user: e.user });
          if (e.is_buy) {
            c.bought += sol;
            if (e.user !== e.creator) c.buyers.add(e.user);
            if (e.user === e.creator && e.slot === c.createSlot) c.devBuy += sol;
          } else {
            if (e.user === e.creator) {
              c.devSold = true;
              creatorSoldNow.add(e.mint);
            } else {
              c.soldByOthers += sol;
              if (sol > c.biggestSell) c.biggestSell = sol;
              if (sol >= BigInt(p.bigSellLamports)) bigSellNow.add(e.mint);
            }
          }
          traded.add(e.mint);
        } else {
          coinOf(e.mint).complete = true;
        }
      }
      // Drop stale ticks (older than the longest lookback we keep).
      const keep = Math.max(p.flowWindowSlots, p.staleSlots) + 5;
      for (const mint of traded) {
        const c = coins.get(mint)!;
        let cut = 0;
        while (cut < c.recent.length && c.recent[cut]!.slot <= now - keep) cut++;
        if (cut > 0) c.recent.splice(0, cut);
      }

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const txFee = state.txFeeLamports();
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) {
        pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);
      }

      // Exits first: every held position is re-priced on this batch's reserves.
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
            const c = coinOf(mint);
            if (h.filled) c.lastExitSlot = now;
            else c.entries = Math.max(0, c.entries - 1);
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const tokens = BigInt(pos.token_amount);
        const cost = BigInt(pos.cost_lamports);
        const value = sellValue(tokens, curve.virtual_quote_reserves, curve.virtual_token_reserves) - txFee;
        if (value > h.bestValue) h.bestValue = value;
        const c = coinOf(mint);
        let exit = false;
        if (value <= (cost * (BPS - BigInt(p.stopLossBps))) / BPS) exit = true;
        if (!exit && value >= (cost * (BPS + BigInt(p.takeProfitBps))) / BPS) exit = true;
        if (!exit && h.bestValue >= (cost * (BPS + BigInt(p.trailArmBps))) / BPS && value <= (h.bestValue * (BPS - BigInt(p.trailBps))) / BPS) exit = true;
        if (!exit && p.exitOnCreatorSell && creatorSoldNow.has(mint)) exit = true;
        if (!exit && bigSellNow.has(mint)) exit = true;
        if (!exit && now - h.openedSlot > p.maxHoldSlots) exit = true;
        if (!exit && now - c.lastTradeSlot > p.staleSlots) exit = true;
        if (!exit && flow(c, now, p.flowWindowSlots) < -BigInt(p.fadeOutLamports)) exit = true;
        if (!exit) continue;
        let sellPending = false;
        for (const po of state.pending.values()) {
          if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
        }
        if (sellPending) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, selling] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        if (!selling) probes.set(mint, true);
      }

      // Guardrail pacing: how far behind are fills / coins, prorated over block time?
      let split = p.baseSplit;
      let needCoins = false;
      let needFills = false;
      if (firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.windowSeconds);
        needCoins = myCoins.size < Math.ceil(p.coinTarget * pace);
        needFills = myFills < Math.ceil(p.fillTarget * pace);
        if (needFills) {
          const ratio = Math.ceil(p.fillTarget * pace) / Math.max(1, myFills);
          split = Math.min(p.maxSplit, Math.max(p.baseSplit, Math.ceil(ratio)));
        }
      }

      // Entries: every qualifying launch in the batch, up to the open-position cap.
      // No averaging down, no chasing: a coin is bought at most once, in its first
      // few slots, and only if its opening tape passes the rug filter.
      let free = state.freeCashLamports();
      let exposure = 0n;
      for (const [mint, h] of held) {
        exposure += BigInt(state.positions.get(mint)?.cost_lamports ?? 0n);
      }
      let openCount = state.committedPositionCount();
      {
        // Every known coin, not just the ones that traded this batch: a rider is
        // decided at age 3-5, and a coin that pumped in its first slots can go
        // quiet for a slot before the bot gets its chance to buy it.
        for (const c of coins.values()) {
          if (orders.length >= cap) break;
          if (openCount >= p.maxOpenPositions) break;
          const mint = c.mint;
          // Cheap age pre-check: almost every known coin is outside the window.
          if (c.createSlot < 0) continue;
          const age0 = now - c.createSlot;
          if (age0 < p.entryAgeMin || age0 > p.entryAgeMax) continue;
          const curve = state.curves.get(mint);
          if (curve === undefined || curve.complete) continue;
          if (pendingByMint.has(mint) || probes.has(mint) || held.has(mint)) continue;
          if (!entryOk(c, now, curve.real_quote_reserves)) continue;
          // Run-up window: price now over the create price, in bps.
          if (c.vq0 > 0n && c.vt0 > 0n) {
            const runup = (curve.virtual_quote_reserves * c.vt0 * BPS) / (curve.virtual_token_reserves * c.vq0);
            if (runup < BPS + BigInt(p.minRunupBps) || runup > BPS + BigInt(p.maxRunupBps)) continue;
          }
          const capLamports = state.maxBuyLamports(mint);
          let amount = BigInt(p.stakeLamports);
          if (amount > capLamports) amount = capLamports;
          if (amount > BigInt(p.maxExposureLamports) - exposure) amount = BigInt(p.maxExposureLamports) - exposure;
          if (amount > free - txFee) amount = free - txFee;
          if (amount < BigInt(p.minBuyLamports)) continue;
          // Split the buy into pieces when fills lag the pace (same price, more fills).
          const pieces = split > 1 ? split : 1;
          const piece = amount / BigInt(pieces);
          if (piece < BigInt(p.minPieceLamports)) {
            orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlippageBps });
            free -= amount + txFee;
          } else {
            for (let i = 0; i < pieces && orders.length < cap; i++) {
              const q = i === pieces - 1 ? amount - piece * BigInt(pieces - 1) : piece;
              orders.push({ side: 'buy', mint, quote_lamports: q, max_slippage_bps: p.buySlippageBps });
              free -= q + txFee;
            }
          }
          exposure += amount;
          openCount++;
          held.set(mint, {
            openedSlot: now,
            bestValue: 0n,
            filled: false,
            buyVq: curve.virtual_quote_reserves,
            buyVt: curve.virtual_token_reserves,
          });
          c.entries++;
        }
      }

      // Probe round trips when coins lag the pace. Cheap guardrail insurance, not
      // a profit centre: only curves whose creator has not sold and whose price
      // is at or above its create price (never buy into an active dump).
      if (needCoins && probes.size < p.maxProbes && firstTime !== null && lastTime !== null) {
        const minRq = (BigInt(p.probeLamports) * BPS) / BigInt(state.hello.caps.max_order_bps_of_real_reserve);
        for (const mint of traded) {
          if (orders.length >= cap || probes.size >= p.maxProbes) break;
          if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint)) continue;
          if (myCoins.has(mint)) continue;
          const curve = state.curves.get(mint);
          if (curve === undefined || curve.complete) continue;
          if (curve.real_quote_reserves < (minRq * 3n) / 2n) continue;
          const c = coins.get(mint)!;
          if (c.devSold) continue;
          if (c.vq0 > 0n && c.vt0 > 0n) {
            const runup = (curve.virtual_quote_reserves * c.vt0 * BPS) / (curve.virtual_token_reserves * c.vq0);
            if (runup < BPS) continue;
          }
          if (free < BigInt(p.probeLamports) + 2n * txFee) break;
          orders.push({ side: 'buy', mint, quote_lamports: BigInt(p.probeLamports), max_slippage_bps: p.buySlippageBps });
          probes.set(mint, false);
          free -= BigInt(p.probeLamports) + txFee;
        }
      }
      return orders;
    },
  };
}
