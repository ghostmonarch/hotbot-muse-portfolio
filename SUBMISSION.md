# HotBot × Muse: Meta Global AI Developer Hackathon submission

**Team:** HotBot
**Track:** Startups Track
**Problem statement:** Build for Your World

**Public repository:** https://github.com/ghostmonarch/hotbot-muse-portfolio
**Demo video (under three minutes):** [Watch the submitted walkthrough](https://youtu.be/N2t3SKpPfgo).

The four sections below are the reviewed submission field text.

## Project Description

HotBot connects its AI trading team to Muse so portfolio oversight starts with an ordinary conversation. Ask what it bought, why it acted, or how to give you more control. Our vision is intelligent agentic trading as easy as talking to Muse.

HotBot already supports connecting to Muse through MCP. For this hackathon, we also brought Muse Spark 1.3 into HotBot's existing Solana memecoin portfolio interface through Meta Model API. We built the conversation layer, visible MCP read activity, expandable source records and setting proposals with source and bounds checks.

In the demo, the user asks about a recent ELEVEN buy. Muse follows the portfolio journal from an earlier pass to the buy about five minutes later. It explains the recorded reasons and market readings, shows what the history cannot establish, and lets the user open the original record, exact field and read timestamp.

Then the user asks for approval before the next buy. Muse prepares a proposal to change Inside my limits to Ask me first. It shows the current value, proposed value, supporting records and tradeoff: ordinary sells would need approval too. Unanswered requests are skipped after two hours; safety-floor exits continue.

The proposal stays unapplied. Our code checks cited fields against completed MCP reads, validates the current setting and allowed range, and requires distinct supporting portfolio references. The person stays in control of whether to make the change.

We trade this market ourselves. We want someone familiar with Muse to be able to understand and direct a trading team through the same kind of conversation, with their preferences and permissions shaping what it does.

Built before this addition: HotBot's trading agents, portfolios and MCP backend. This demo conversation is read-only and runs locally with real HotBot data and real Meta responses, using paper activity. The public source includes the client and new Muse layer; the existing backend remains an external dependency.

## Describe your use of Meta products to build the submitted project

We use Muse Spark 1.3 through Meta Model API as a conversational interface to HotBot's portfolio agents. A person asks in everyday language; Muse reads the relevant records, explains the team's activity and prepares a setting change for review.

Our Node.js bridge connects Meta chat completions to HotBot's remote MCP server. Each conversation stays with one selected portfolio. The bridge reads its snapshot first; Muse can request additional get_portfolio and get_reference reads. Separate UI reads populate the portfolio selector and existing navigation/team panel.

Muse returns a structured answer with source references and an optional setting proposal. The server resolves accepted references against completed tool-call IDs and exact JSON paths. Before displaying a proposal, it checks the current setting, allowed range and distinct supporting portfolio references. Setting effects come from pinned HotBot definitions.

The UI shows the connection at work through read progress, expandable tool traces, original source records and a proposal awaiting review. This demo conversation has no trading or setting-write tools.

New hackathon work: the focused Muse bridge, source and proposal checks, native portfolio-chat integration and demo recorder. HotBot's existing MCP server also supports a custom connector in the Muse app. That connector and the new Meta Model API conversation inside HotBot are separate ways to access the same product.

We verified the integration with real Meta and MCP calls, 18 automated backend tests and a full client TypeScript check.

## Why are Meta's models important to your solution?

We want intelligent agentic trading to feel as approachable as talking to Muse. Our goal is for someone familiar with Muse to express what they want from a trading team in everyday language and understand what that team is doing.

Muse Spark connects that intent to HotBot's portfolio records and settings. In the demo, a question about a buy becomes an explanation of the recorded decisions. A request for more control becomes a concrete approval-setting proposal, with its current value, supporting sources and tradeoff.

The existing Muse custom connector brings HotBot into Muse through MCP. The new native conversation brings Muse Spark into HotBot through Meta Model API. Both fit the same vision: access to an agentic trading team through a familiar conversation, with the person's preferences, permissions and decisions at the center.

Muse handles intent and interpretation; our code checks the cited fields and proposed setting values. That division lets the person inspect what the model relied on and decide what to change.

## Provide feedback from your experience using partner technologies.

We used Meta Model API directly. Structured outputs fit MCP; clearer reasoning-budget examples would help.

## Rubric evidence

Weights follow the [official judging guide](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details#8-judging-process-16). This table maps the current work to the rubric; it does not predict a score.

| Criterion | Weight | What to evaluate | Source |
| --- | ---: | --- | --- |
| Impact | 30% | A person can question an agent's decision, inspect the original journal and review a change through ordinary conversation. | [Portfolio UI](client/src/components/team/Portfolios.tsx), [Muse conversation](client/src/components/team/MusePortfolioChat.tsx) |
| Use of Meta AI tooling | 25% | Muse Spark 1.3 interprets the actual portfolio record and returns structured source references and a setting proposal through Meta Model API. The bridge starts with a portfolio read; the model can request additional allowed reads. | [Muse tool loop and output schema](muse-agent/agent.mjs) |
| Technical depth and execution | 20% | Selected-portfolio read boundaries, exact source IDs/paths, current-setting and range checks, and distinct supporting evidence make the response inspectable and the proposal reviewable. | [Bridge](muse-agent/server.mjs), [validation and protocol tests](muse-agent/test/agent.test.mjs) |
| Demo | 25% | The existing HotBot interface shows real Meta/MCP responses, expandable sources and a concrete proposal awaiting review. | [Native conversation](client/src/components/team/MusePortfolioChat.tsx), [recorder](muse-agent/record.mjs) |

**Verification:** 18 isolated backend tests and the client TypeScript check passed, and the recorded walkthrough used real provider calls. The demonstration uses paper activity in a local build with the existing private HotBot backend. Source/proposal checks establish provenance and setting bounds; they do not certify every model interpretation. Edited model waiting times are identified in the recording's timing disclosure.
