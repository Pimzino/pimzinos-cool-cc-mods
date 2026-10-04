# Pimzino's cool CC mods

A Claude Code plugin marketplace for my mods, tools and skills. Each top-level folder is one plugin that can be installed and switched on or off by itself.

## Install

Add the marketplace once per device:

```bash
claude plugin marketplace add Pimzino/pimzinos-cool-cc-mods
```

Then install what you want:

```bash
claude plugin install usage-meter@pimzinos-cool-cc-mods
```

Mods need Claude Code v2.1.287 or later. On earlier builds, set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in the `env` block of `~/.claude/settings.json`.

## Plugins

| Plugin | What it does |
| :- | :- |
| [`usage-meter`](usage-meter) | Shows your plan limits (5-hour and weekly), context window usage and session cost at API prices in a band above the prompt, with pace warnings, a details pane and cost history |

### usage-meter

Each meter starts with an icon: a clock for the 5-hour limit, a calendar for the weekly limit, a coin for the spend limit, stacked layers for the context window, a cylinder for the prompt cache, and a receipt for the session's cost at API prices.

- **Warnings in the band.** A limit that is filling fast enough to run out before it resets says when it will be full. The context meter says when the conversation is close to being summarised. The cost meter shows the latest turn's cost beside the session total.
- **Prompt cache.** A meter shows the tokens read from the prompt cache behind a down arrow and the tokens written to it behind an up arrow. Cached input is billed at a fraction of the price. The Details pane adds the share of input that came from cache, and the uncached input and output tokens.
- **Tooltips.** Pointing at a meter says what it is and, for a limit, its full reset date. The two buttons have tooltips too.
- **Notices.** One appears when a plan limit reaches the warning level (90% unless changed), and another when a limit's window starts over.
- **Repository row.** When the session is inside a git repository, a second row under the meters shows the repository, the branch, lines added and removed since the last commit, and how many files changed. Outside a repository the row is not drawn.
- **Footer.** The bundled Claude Code version and how long the session has been running show under the prompt.
- **Details pane.** The ☰ button at the end of the band opens the Details pane, with every limit and its pace, the context window by category, cost per turn, and the full 90-day cost history: totals, the average and busiest day, a column for every day, and the latest days listed. In the desktop app it is drawn as cards that fit the pane's width.
- **Cost history.** Each session's cost is remembered by day, on this computer, for 90 days. It counts only sessions where the mod was running.
- **Settings.** The ⚙ button beside it opens a second pane where each meter, the footer items and the notices can be switched off, and the warning level changed. Choices are remembered between sessions.
- **Narrow windows.** The bars shorten, then the reset times and the bars drop away, and after that the meters wrap onto a second row.

In the desktop app the figures are drawn in Claude's own typeface, read from the Claude app installed at `/Applications/Claude.app`; without it they use the system font.

## Adding a plugin

1. Create a folder with `.claude-plugin/plugin.json` and the plugin's files.
2. Add an entry for it to `.claude-plugin/marketplace.json`.
3. Run `claude plugin validate .` and push.
