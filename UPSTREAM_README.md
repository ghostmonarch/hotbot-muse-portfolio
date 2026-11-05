# HOTBOT

**Your own AI trading team for Solana memecoins.** Live at [usehotbot.com](https://usehotbot.com).

You describe a strategy in plain words. A team of agents finds coins, checks them for scams, buys and manages the exits, every second of the day:

- **ResearchBot** checks every new launch against your strategy and scores it.
- **ShieldBot** blocks rugs and scams, from the coin's first block.
- **SniperBot** picks the entry.
- **TraderBot** buys and manages each exit live.
- **HOTBOT** is the orchestrator you talk to.

You build and change strategies by chat: the AI drafts the rules, and you apply each change with one tap. Strategies run on paper first and move to real SOL when you choose. Portfolios hold a themed basket of coins, managed by an agent. You can also connect your own AI (Muse, Claude, ChatGPT, Cursor) through our MCP server.

## Use HOTBOT from Muse

[Muse](https://www.meta.com/help/artificial-intelligence/1687253048996149/), Meta's personal agent on the Muse Spark models, connects to HOTBOT as a custom connector. Muse reads your team, explains why a strategy wins or loses, and previews a change before you apply it.

1. In Muse, open **Settings → Connectors → Add custom connector**, or send Muse this message:

   ```
   Create a Custom Connector for a new remote MCP server, then connect to it:
   Name: HOTBOT
   Transport: remote streamable HTTP
   URL: https://api.usehotbot.com/mcp
   Auth: OAuth
   ```

2. Muse opens HOTBOT. Sign in, check the app and its address, and tap **Allow**. The connection only reads until you turn on **Can trade**.
3. Ask Muse: *"Read my HOTBOT team and stats. Which strategy works, which does not, and why? Preview one change before you make it."*

You see each connected agent on the Account page under **Your agents**, and you delete it there to cut it off at once.

### Tools

| Tool | Kind | What it does |
|---|---|---|
| `get_team`, `get_stats`, `get_activity`, `get_funnel`, `get_trades`, `get_decisions` | Read | The team, each strategy's results, its funnel, its sales and the bots' decisions |
| `get_coin`, `search_coins` | Read | One coin as the team sees it, or a search by mint or symbol |
| `get_reference` | Read | Every setting a strategy takes, with its unit and range, and the exit plans |
| `list_portfolios`, `get_portfolio` | Read | Themed portfolios and their journals |
| `update_strategy` | Write | Changes a strategy's settings. `preview` checks the change and saves nothing |
| `create_strategy`, `strategy_action` | Write | Makes a strategy, or pauses, runs or archives one |
| `draft_portfolio`, `start_portfolio`, `portfolio_action`, `set_portfolio_limits`, `answer_portfolio_ask` | Write | Drafts, starts and manages themed portfolios on paper |
| `coin_action` | Sensitive write | Approves, buys or sells one coin |
| `team_action` | Sensitive write | Sells every coin, stops or resumes every strategy, or resets practice |

Every write needs a connection with **Can trade** on. Sign-in is OAuth 2.1 with PKCE, and HOTBOT stores only a hash of each token.

## How it works

- **Our own Solana indexer (Rust)** reads the validator stream directly and decodes the launchpads and AMMs coins trade on. Each coin's live state is less than 50 ms behind the chain.
- **Scam protection from block 0** reads authorities, transfer fees, launch origin, deployer history and early-buyer wallets before any buy. When one team catches a rugger, every team is protected.
- **A real-time strategy engine** checks every rule and every exit in code on each price update. The agents decide on top of this protective floor and can never loosen it.
- **Our own ML models** are trained on our on-chain dataset of every launch.
- **Solana throughout:** sign-in with a Solana wallet, swaps sent from each user's own wallet, and models trained on replays of the full block archive.

## This repository

This is the web client: Next.js, React and Convex. The backend, the MCP server, the indexer, the models, the website's server routes and the production thresholds are private.

| Path | What |
|---|---|
| `client/src/components/team` | The team app: home, strategies, settings, the Lab, the chat with HOTBOT, the wallet and Your agents |
| `client/src/components/hotbot` | The HOTBOT characters and the landing page |
| `client/convex/api.ts` | The backend functions that the client calls, with their arguments and results |
| `types/` | The contracts that the client and the backend share. Every scam and research check is listed with its label and target. A `PRIVATE` value is a placeholder for a production number. |

The client needs the HOTBOT backend to run. To read and type-check it: `bun install && bun run typecheck`.

## License

Copyright HOTBOT. All rights reserved. You can read this code. You cannot copy, change or redistribute it.
