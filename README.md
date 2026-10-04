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
| [`usage-meter`](usage-meter) | Shows your plan limits (5-hour and weekly), their reset times, context window usage, and the session's cost at API prices in a band above the prompt |

In `usage-meter`, each meter starts with an icon: a clock for the 5-hour limit, a calendar for the weekly limit, a coin for the spend limit, stacked layers for the context window, and a receipt for the session's cost at API prices. On a narrow window the meters shrink: the bars shorten, then the reset times and the bars drop away, and after that the meters wrap onto a second row. In the desktop app, hovering a meter shows a tooltip saying what it is and, for a limit, its full reset date. A notice appears once when a plan limit reaches 90%. In the desktop app the figures are drawn in Claude's own typeface, read from the Claude app installed at `/Applications/Claude.app`; without it they use the system font.

## Adding a plugin

1. Create a folder with `.claude-plugin/plugin.json` and the plugin's files.
2. Add an entry for it to `.claude-plugin/marketplace.json`.
3. Run `claude plugin validate .` and push.
