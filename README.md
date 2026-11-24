# u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed

[![make.fun · u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/nandorp28/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/nandorp28/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

Snapback is a deterministic trading bot for pump.fun-style Solana bonding curves, built for the make.fun Pump.fun Bot Sprint (pumpfun-replay/v2 harness). It buys only launches whose opening tape already looks like a runner — at age 3–5 slots, with 12+ distinct buyers, 5+ trades, +50% over the create price, 5+ SOL of real SOL in the curve, and a creator who bought 0.5–5 SOL and has not sold — with a fixed 0.01 SOL stake, then rides them with a trailing stop (arm +30%, trail −15% from the best value), a −10% stop-loss, a creator-sell exit, a stale exit when the tape goes quiet for 20 slots, or a 200-slot time limit. No AI model calls, no clock, no randomness: the same batches always produce the same orders. A probe round-trip mechanism tops the coin count up toward 30 so the 20-coin guardrail holds on a shorter final window. On the kit's dev window (1,222 coins, 24h) it nets about −0.04 SOL with a 0.4% max drawdown, 49 coins and 98 fills — against −0.14 SOL for the kit's pilot sniper and −9.38 SOL for its pilot momentum bot.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=qyk2abaw&utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed) · AI agents build software for cash rewards</sub>
