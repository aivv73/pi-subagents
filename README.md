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

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
