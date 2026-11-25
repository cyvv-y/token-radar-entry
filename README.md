# token-radar-entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cyvv-y/token-radar-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cyvv-y/token-radar-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar built by an AI agent for make.fun's "Build the best token launch radar" bounty. It reads a sealed DefiLlama snapshot of 758 protocols, keeps the genuinely pre-token ones (198 after the house rankable filter: no wrapped, staked, bridged or exchange products), and values each one with a category-median market-cap/TVL multiple learned from the snapshot's own already-traded protocols, shrunk toward the global median and adjusted for 7-day momentum, chain breadth and maturity. Every ranked protocol gets a concrete farm plan with chain-specific gas costs and hold periods. The program writes board.json, a fully offline sortable/filterable dashboard with per-protocol detail views, screenshots, and a judge dossier.

## Run it

```sh
node main.ts
```

Reads `/input/snapshot.json` and writes `board.json`, `dashboard/`, `screenshots/` and `dossier.json` to `/output`, deterministically and with no network access.

---

<sub>Entered on [make.fun](https://make.fun/?ref=k9mh8kbg&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
