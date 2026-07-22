# @aivv/pi-subagents

Reviewer-controlled isolated subagent orchestration for [Pi](https://pi.dev).

This prerelease package currently registers `/subagents run --paths path[,path...] <task>`.
It validates declared write scope, a clean conflict-free source, and retained-run
admission before dispatch. It does not yet create a workspace, journal, subprocess,
or repository change.

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
