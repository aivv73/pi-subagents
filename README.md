# @aivv/pi-subagents

Reviewer-controlled isolated subagent orchestration for [Pi](https://pi.dev).

This prerelease package currently registers `/subagents run --paths path[,path...] <task>`.
It validates declared write scope, a clean conflict-free source, and retained-run
admission before dispatching one background isolated worker/reviewer run. Use
`/subagents cancel` to cancel the active pre-integration run. Terminal outcomes are
recorded in Pi and retained resources remain available for inspection.

## Local verification

```sh
npm install
npm run check
npm pack
```

Pi, Herdr, Rift, Jujutsu, and Git are separate external prerequisites. This package
does not bundle or install them.

## Runtime doctor

In a trusted Pi TUI, inspect the current repository's read-only runtime and capability
diagnosis with:

```text
/subagents doctor
```

For automation or support after installation, use the same diagnosis as JSON:

```sh
pi-subagents doctor --json
```

It writes one versioned JSON report to stdout, exits `0` only when every required check
passes, exits `1` for an unsupported environment, and exits `2` for invalid invocation
or an unexpected diagnostic failure. Neither surface creates orchestration resources.

## Opt-in live acceptance

`npm run acceptance:real` is deliberately excluded from `npm test` and CI. It starts
real Pi worker and reviewer agents, so it requires an authenticated model and a btrfs
fixture location. To run it, explicitly opt in and select a configured Pi model:

```sh
PI_SUBAGENTS_ACCEPTANCE_REAL=1 \
PI_SUBAGENTS_ACCEPTANCE_MODEL=provider/model \
npm run acceptance:real
```

Set `PI_SUBAGENTS_ACCEPTANCE_ROOT` to an existing btrfs directory when the system
temporary directory is not btrfs. The harness creates its source repository, state,
Rifts, and local transport below one disposable fixture there. It removes that fixture
only after a fully successful run and prints its path for inspection on failure.

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
