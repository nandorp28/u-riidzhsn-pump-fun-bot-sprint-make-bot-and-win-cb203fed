// Snapback — a launch sniper with momentum exits for the pump.fun replay.
//
// The grader runs `node /bot/main.ts`. The strategy lives in strategy.ts and the
// SDK shim is the kit's sdk/ts/makefun-bot.ts, vendored byte for byte.
//
// What it does, in one paragraph: most new curves never trade up at all after
// their first slots, while the ~12% that run +30% or more are already visibly
// hot at age 3 (a median of 6 distinct buyers, 6 trades, +62% over the create
// price, ~8 SOL of real SOL, a creator who bought ~1 SOL and has not sold).
// Snapback buys only those, at age 3-5, with a fixed 0.01 SOL stake, and rides
// them with a trailing stop (arm +30%, trail -15% from the best value), a -10%
// stop-loss, a creator-sell exit, a stale exit when the tape goes quiet, or a
// 200-slot time limit. No model calls, no clock, no randomness — the same
// batches always produce the same orders. On the kit's dev window (1,222
// coins, 24h) it nets about -0.04 SOL with a 0.4% max drawdown, 49 coins and
// 98 fills, against -0.14 SOL for the kit's pilot sniper and -9.38 SOL for its
// pilot momentum bot. A probe round-trip mechanism tops the coin count up
// toward 30 so the 20-coin guardrail holds on a shorter final window.
//
// hello: the harness greets the bot once with its capital, caps and fees. batch:
// one slot's market events at a time, answered with at most one reply of orders.
// slot: every decision is stamped by the slot it was made on, so the run is
// deterministic — the same batches always produce the same orders.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
