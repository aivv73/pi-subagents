# Herdr licensing and distribution constraints

## Scope and disclaimer

This is an engineering risk assessment based on Herdr’s repository and GNU’s published guidance, not legal advice. Whether separately executing programs form one combined copyright work is fact-specific and ultimately a legal question. Obtain qualified counsel before commercial distribution or hosted multi-user operation.

## Authoritative facts

- Herdr declares `AGPL-3.0-or-later` in `Cargo.toml` and ships the full GNU AGPLv3 text in `LICENSE`.
- Herdr also offers a commercial license for organizations that cannot comply with the AGPL; terms are not public and must be requested from `hey@herdr.dev`.
- Herdr is packaged as one Rust executable. Its documented external automation surfaces are CLI commands and a local socket protocol. The installed executable can emit its own JSON protocol schema.
- The planned extension does not need to link Herdr Rust code, embed its executable, or modify Herdr. It can require a separately installed compatible Herdr binary and communicate through documented process boundaries.

## License triggers relevant to the project

### Running an unmodified local copy

AGPLv3 section 2 expressly permits running an unmodified program. Merely requiring users to install and run an upstream Herdr binary locally does not itself convey or modify Herdr.

This is the lowest-risk supported baseline: the extension checks for a compatible `herdr` command, queries its version/schema, and invokes its public CLI or local socket API.

### Conveying Herdr

If this project bundles, republishes, mirrors, or installs a Herdr binary itself, it conveys Herdr and assumes AGPL distribution duties. At minimum these include preserving notices and license terms and providing the complete corresponding source through an AGPL-compliant section 6 mechanism for the exact binary conveyed. Pointing only to current upstream `main` is insufficient if it does not correspond to that binary.

The initial route must therefore **not bundle, download, or redistribute Herdr**. Installation documentation may direct users to Herdr’s official distribution channels.

### Modifying Herdr

If the project patches or forks Herdr, the modified covered work must remain under AGPL terms when conveyed. If the modified version supports remote network interaction, section 13 requires a prominent no-charge corresponding-source offer to all remote users interacting with that version.

The initial route must therefore use stock Herdr and avoid source patches. Needed capabilities should be requested upstream or handled in the separate extension.

### Combining versus communicating

AGPL section 5 distinguishes an aggregate of separate independent works from one larger combined work. GNU’s GPL FAQ says command-line arguments, pipes, sockets, and RPC are mechanisms normally used by separate programs, but the mechanism alone is not decisive; the semantics and intimacy of communication also matter. Same-executable or shared-address-space linkage strongly indicates a combined program.

The planned architecture has favorable separation facts:

- separate Pi/Node and Herdr processes;
- no Herdr source, library, or FFI linkage;
- public documented CLI/socket methods;
- JSON request/response and event data;
- Herdr remains independently useful as a terminal multiplexer;
- the extension can fail clearly when Herdr is absent rather than containing a partial Herdr implementation.

However, Herdr is a required runtime and the extension is designed specifically around its protocol. This prevents a categorical conclusion that the extension can use any proprietary license without review. GNU guidance explicitly treats the combined-work determination as fact-specific.

## Approved engineering assumption

For mapping and initial open-source implementation, proceed on a **separate-process, user-supplied dependency** assumption:

1. Do not vendor, link, embed, patch, mirror, auto-download, or redistribute Herdr or its plugins/integration payloads.
2. Require users to install Herdr separately from an official channel and accept its license independently.
3. Communicate only through the documented CLI or local socket protocol.
4. Discover the protocol schema at runtime with `herdr api schema --json`; do not copy Herdr implementation code into the extension.
5. Keep a narrow `HerdrClient` adapter containing independently written request/response types for only the methods used.
6. Keep attribution and a clear dependency/license notice in project documentation even though Herdr is not bundled.
7. Pin a supported Herdr version range and reject incompatible protocol versions before creating workspaces.
8. Treat plugins, source patches, binary bundling, remote Herdr service operation, and commercial closed-source distribution as architecture changes requiring renewed license review.

This assumption reduces copyleft coupling risk but is not a legal safe harbor.

## Scenario matrix

| Scenario | Initial route | Engineering/licensing implication |
| --- | --- | --- |
| User installs stock Herdr; extension invokes CLI/socket locally | Allowed assumption | No Herdr conveyance or modification by this project; retain process separation |
| Extension package auto-downloads or contains Herdr binary | Prohibited | Project becomes a conveyor; section 6 source/notice obligations apply |
| Project publishes a patched Herdr binary | Prohibited | AGPL modified-work and conveyance duties; section 13 may apply to remote interaction |
| Extension links or copies Herdr implementation code | Prohibited | Strong combined/derivative-work risk; use AGPL-compatible licensing or commercial terms after counsel |
| Extension uses only independently implemented protocol types | Allowed assumption | Still fact-specific, but supports separate-program treatment |
| Public service exposes a modified Herdr to remote users | Prohibited without review | Section 13 source offer required for modified Herdr; broader architecture needs counsel |
| Closed-source commercial distribution requiring Herdr | Approval gate | Obtain counsel and consider Herdr’s commercial license |
| Open-source extension under an AGPL-compatible license | Lower conflict risk, not selected here | Project license selection remains a separate product decision |

## Required implementation-route gates

- Document Herdr as an external prerequisite with its AGPL/commercial licensing link.
- Add a packaging test that fails if Herdr binaries, source, plugins, integration payloads, or vendored crates enter release artifacts.
- Add dependency scanning/notice generation for the extension’s own dependencies separately from Herdr.
- Before selecting the extension’s license or offering commercial/hosted distribution, obtain a legal determination on whether this exact mandatory protocol coupling remains separate.
- If those stakeholders cannot accept the uncertainty, obtain a commercial Herdr license before implementation publication.

## Evidence

- Herdr dual-license notice and full terms: `https://github.com/ogulcancelik/herdr/blob/master/LICENSE`
- Herdr package declaration (`AGPL-3.0-or-later`) and single-binary packaging: `https://github.com/ogulcancelik/herdr/blob/master/Cargo.toml`
- Herdr commercial-license statement: `https://github.com/ogulcancelik/herdr/blob/master/README.md`
- Public CLI/socket boundary and runtime schema discovery: `https://github.com/ogulcancelik/herdr/blob/master/docs/next/website/src/content/docs/socket-api.mdx`
- GNU AGPLv3 sections 2, 4–6, and 13: `https://www.gnu.org/licenses/agpl.html`
- GNU guidance on separate programs, pipes/sockets, and communication semantics: `https://www.gnu.org/licenses/gpl-faq.html`
- GNU explanation of AGPL network-source purpose: `https://www.gnu.org/licenses/why-affero-gpl.html`

