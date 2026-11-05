# Muse portfolio conversation

Ask Muse what HotBot bought, why it acted, or how to give you more control.
Muse reads the portfolio, explains the recorded decisions and shows you a
proposed change before you decide what to do. Open a source to see the record
behind an answer. The proposal stays unapplied.

We want using HotBot to feel as easy as talking to Muse. HotBot's
existing MCP server also supports a custom connector in the Muse app. This new
module brings Muse Spark into HotBot through Meta Model API; the recorded
native conversation uses paper activity and has no trading or setting-write tools.

[Watch the submitted walkthrough](https://youtu.be/RcT1DuSwffI).

## Run locally

Requires Node.js 22 or newer for the local bridge. The bridge has no package dependencies.

For a real conversation, supply a Meta Model API key that can call
`muse-spark-1.3` and a read-only HOTBOT MCP bearer token for an account with a
themed paper portfolio. A consumer Muse login or an existing OAuth connector in
another app does not configure this local process. In HOTBOT's Account page,
open **Your agents → New key**, leave **Can trade** off, and copy the one-time
key. An account without HOTBOT backend access or a portfolio cannot reproduce
the live conversation from this repository alone.

```sh
cd muse-agent
npm start
```

Open **http://127.0.0.1:3817**. Use **Connect** to enter an existing Meta Model API
key and an existing read-only HOTBOT MCP token yourself. Do not send credentials
in chat. Credentials stay in this local server's memory and are lost when it
stops. They are not saved in browser storage or returned by the status endpoint.
Alternatively, start with `MODEL_API_KEY` and `HOTBOT_MCP_TOKEN` configured in the
process environment through your normal local secret manager.

An existing environment file can be reused without copying it into this repo:

```sh
node --env-file=/absolute/path/to/your/existing.env server.mjs
```

Both `HOTBOT_MCP_TOKEN` and the earlier integration's `HOTBOT_KEY` name are
supported. The module reads `MODEL_API_KEY` for Meta Model API.

For a new local file, start at the repository root with
`cp muse-agent/.env.example muse-agent/.env`, fill in both values locally, then
run `node --env-file=.env server.mjs` from `muse-agent/`. The example contains
blank placeholders; completed `.env` files are ignored by Git.

When you ask a question, the server sends the requested account records to Meta
Model API for the model to interpret. Use an account and records you authorize
for this purpose. The module binds to the local loopback interface; it is not a
hosted multi-user service.

Select one portfolio, then ask:

> What has this portfolio's trading team been doing? Explain its recent
> decisions in plain English and show the journal records behind your answer.

Follow up:

> Ask me before the next buy. Show the closest supported setting proposal,
> its current value, its sources and what else the change would affect.

If the record does not support a concrete proposal, the agent should explain
what is missing. Missing data or provider failures are shown as errors, never
replaced with a staged answer.

## Run inside the current HOTBOT portfolio interface

The native preview reuses the existing React portfolio, sidebar, team panel and
chat styles. It reads real paper portfolio snapshots through the bridge. It
requires the client dependencies from the repository’s locked Bun workspace.

With the bridge running on port 3817, open a second terminal at the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
cd client
bun --bun next dev --hostname 127.0.0.1 --port 3000
```

Open **http://127.0.0.1:3000/muse-preview**, then its **Chat** tab. This explicit
local preview uses MCP reads instead of private Convex account startup. It does
not impersonate a signed-in session. The ordinary app routes retain their
existing authentication. The preview and loopback proxy routes are development
only (`page.dev.tsx` / `route.dev.ts`).

Unexposed MCP fields remain unavailable. In particular, the unvalidated holding
comparison is omitted instead of reconstructed. Portfolio settings and wallet
controls cannot mutate the account in this view.

## What the new module does

- Calls Muse Spark 1.3 through Meta Model API.
- Discovers HOTBOT's MCP schemas and runs a bounded tool-calling loop over the
  selected portfolio and reference definitions. The portfolio selector uses a
  separate list read; unrelated account and strategy tools are unavailable.
- Emits requested/completed/error tool states as the requests happen.
- Resolves cited JSON paths against actual results from that conversation.
- Requires distinct current-setting and supporting portfolio references before
  displaying a proposal, and checks the setting value and allowed range. It
  never executes a change.
- Adds the setting's wider effects from HOTBOT's published definitions, with a
  pinned source link. For example, approval mode also affects ordinary sells;
  the daily cap has exceptions for new picks and the safety floor.
- Keeps paper, realized, unrealized and hypothetical results distinct in the
  agent instructions and interface.

The existing HOTBOT client, portfolios, MCP server and trading system predate
this module. The private HOTBOT backend is an external dependency. The module
does not replace it or claim its existing functionality as new hackathon work.

## Evidence boundary

A source record identifies where a value came from. It is not a guarantee that
the underlying data, financial interpretation or proposed change is correct.
Inspect the field, units, reporting period and account mode before relying on a
conclusion. The current historical "versus holding" metric is excluded from the
demo because its counterfactual definition requires further verification.

## Verification and recording

From the repository root:

```sh
(cd muse-agent && npm test)
(cd client && bun run typecheck)
```

Automated tests use isolated mock transports. Passing those tests does not prove
the live provider or account connection works. Verify the real connection and
conversation separately before recording.

The three-minute shot list and narration outline are in
[`demo/recording-script.txt`](demo/recording-script.txt). Use a successful real
conversation, open a supporting source, and end with the proposal awaiting
review. Label shortened waits in an edited recording. Never present a fixture or
staged model answer as a live run.

[`demo/video-voiceover.txt`](demo/video-voiceover.txt) is an optional voiceover
for the recorded ELEVEN investigation and approval proposal. The automated MP4
is a silent product walkthrough without overlays; it does not include that voiceover.

The demonstrated interface is a local build, not a deployment to the existing
HotBot production service. Repository publication and hackathon submission are
separate from deploying this interface.

HOTBOT-authored code is covered by the repository's [MIT License](../LICENSE).
Meta's models, third-party dependencies, and external services retain their own
terms. [UPSTREAM_README.md](../UPSTREAM_README.md) preserves the original product
documentation and its historical rights wording.

## Record the real portfolio review

Start the local bridge on port 3817 with the real Meta and read-only HOTBOT
connection configured, and the native HOTBOT client preview on port 3000.
Confirm **Fresh Picks** appears at **http://localhost:3000/muse-preview**. The
recorder uses this actual portfolio interface and its Chat tab; it does not use
the standalone review shell. It never opens credential files or exports
credentials. Recording requires installed Google Chrome, FFmpeg, FFprobe and
Node.js 22 or newer. No image renderer is needed for the unadorned video.

```sh
node record.mjs /absolute/path/hotbot-muse-demo.mp4
# Optional: a different local port for the native preview
node record.mjs /absolute/path/another-demo.mp4 http://localhost:3002/muse-preview
```

The script opens a temporary headless Chrome profile and asks two real questions:

These prompts refer to the recorded account's ELEVEN history. A different
account may not contain those records; use an issue from its actual journal
when reviewing that account.

> The journal passed on ELEVEN, then bought it about five minutes later. Compare
> both records: what evidence differs, and can those records explain the reversal?
> Cite the full records.

> Can I require my approval before the next buy? Draft the closest supported
> setting change, show its current value and source, and explain what else it affects.

It opens actual source records and the resulting advisory proposal. Provider
errors, a missing source or an unsupported proposal stop the recording; no
fixture or invented answer replaces them. The silent output has no captions,
promotional overlays or injected UI. Only model waiting time is shortened,
disclosed with actual and edited intervals in `hotbot-muse-demo-timing.txt`.
The MP4 is 1920×1080 at 30 fps, between 90 and 170 seconds. A clean
`hotbot-muse-demo-final.png` screenshot is saved beside it. Existing output files
are never overwritten. Temporary
frames and the temporary browser profile are removed after the run.

Running the recorder sends the two questions and the selected portfolio records
through the already configured live providers. Review the resulting video before
using it externally. The submitted walkthrough used real Meta and MCP calls;
each new recording still requires working provider access and actual account records.
