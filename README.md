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
| [`usage-meter`](usage-meter) | Shows your plan limits (5-hour and weekly), their reset times, and context window usage in a band above the prompt |

## Adding a plugin

1. Create a folder with `.claude-plugin/plugin.json` and the plugin's files.
2. Add an entry for it to `.claude-plugin/marketplace.json`.
3. Run `claude plugin validate .` and push.
