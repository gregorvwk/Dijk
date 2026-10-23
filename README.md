# Dijk

Your dependencies can run. They just can't reach your machine.

Dijk runs `npm install` and `npm run` inside a throwaway Docker container that
can only see your project and only talk to the hosts you allow. A compromised
package gets a sandbox, not your SSH keys, cloud credentials, npm tokens or
home directory.

```sh
dijk install
dijk run dev
```

> **Status: early prototype.** Dijk is not yet a complete security boundary.
> See [Known gaps](#known-gaps) before relying on it.

## Why

Installing a package means running its code. Lifecycle scripts run during
`npm install`, and the package's own code runs every time you start a dev
server, run tests or build. That code runs as you, with access to everything
you can access.

Supply-chain attacks use exactly this. A hijacked maintainer account publishes
a new version, a postinstall script reads `~/.npmrc`, `~/.ssh` and `.env`, and
sends them off before anyone notices.

Disabling install scripts (`--ignore-scripts`, pnpm's script allowlist) only
covers the first moment. Dijk also sandboxes everything that runs afterwards:
`npm run dev`, `npm test`, `npm run build`.

## Threat model

**Dijk protects your machine and your secrets from the code in your
dependencies.**

In scope:

- Reading files outside the project (SSH keys, cloud credentials, browser data,
  other repos)
- Reading secrets inside the project that you choose to hide, such as `.env`
- Sending data to hosts you have not allowed
- Exposing dev servers to your local network

Out of scope:

- **Your users.** Whatever ends up in `node_modules` still ends up in your
  bundle and in production. Dijk does not make malicious packages safe; it
  limits what they can do on your development machine.
- **Code that runs outside Dijk.** Your editor's TypeScript server, ESLint and
  Prettier plugins, and test runners started from the IDE all load code from
  `node_modules` on the host. See [Known gaps](#known-gaps).
- **Docker itself.** Dijk relies on Docker for isolation. It is not a defense
  against container escapes.

## Install

Dijk is not published yet. Link it from this repo.

Requirements: Node.js 18+, npm and Docker.

```sh
git clone https://github.com/gregorvwk/dijk.git
cd dijk
npm link
dijk --help
```

## Usage

In any npm project:

```sh
dijk init        # create dijk.config.json
dijk install     # npm install, sandboxed
dijk ci          # npm ci, sandboxed
dijk run dev     # npm run dev, sandboxed
dijk cleanup     # remove this project's leftover containers and networks
dijk cleanup --all  # same, for every project
```

Run `dijk init` before your first install. Without a config file, Dijk uses
defaults, but the project has no protected config yet (see
[Known gaps](#known-gaps)).

## How it works

**Throwaway containers.** Every command runs in a new container that is removed
when the command exits or is interrupted.

**Project-only file access.** Only the project directory is mounted. On Unix
the container runs as your user, so files it creates keep normal ownership.
`node_modules` lives in the project, so repeated installs only update what
changed.

**Per-project npm cache.** Each project gets its own npm cache in
`~/.cache/dijk/npm/` (or `$XDG_CACHE_HOME/dijk/npm/`), so installs stay fast
across runs. Caches aren't shared between projects, so a package in one project
can't tamper with what another project installs.

**Works in your terminal.** When Dijk runs in a terminal, the container gets a
TTY, so prompts, colors and dev server keyboard shortcuts work as usual.

**Hidden files.** Paths listed in `hiddenFiles` are masked inside the
container. Scripts see an empty file or an unreadable directory instead of the
real contents.

**Network allowlist.** Dijk starts a gateway container that owns the network
and runs your command inside the gateway's network namespace. The gateway
installs firewall rules before your command starts, so all traffic (HTTP,
WebSockets, raw TCP) follows the same rules without proxy settings. Allowed
domains are resolved to IP addresses by the gateway. If restrictions are on
and both allowlists are empty, the container gets no network at all.

**Localhost-only ports.** Published ports bind to `127.0.0.1` unless you
explicitly ask for another address.

## Config

`dijk init` creates `dijk.config.json`:

```json
{
  "image": "node:22-bookworm-slim",
  "projectDir": "./",
  "ports": ["5173"],
  "network": {
    "enabled": true,
    "allowedDomains": ["registry.npmjs.org"],
    "allowedIps": []
  },
  "runArgs": {},
  "hiddenFiles": ["dijk.config.json", ".env"]
}
```

| Key | Description |
| --- | --- |
| `image` | Docker image commands run in. |
| `projectDir` | Directory mounted read-write as the project. Relative paths are resolved from `dijk.config.json`. Defaults to `./`. |
| `ports` | Ports published for `dijk run`. `"5173"` binds `127.0.0.1:5173`. Use `"8080:3000"` to map different ports, or `"0.0.0.0:8080:3000"` to deliberately expose one to your network. Apps must listen on `0.0.0.0` inside the container. |
| `network.enabled` | Turns network restrictions on or off. On by default. |
| `network.allowedDomains` | Exact domains commands may reach. Includes `registry.npmjs.org` by default. |
| `network.allowedIps` | IP addresses commands may reach directly. |
| `runArgs` | Extra arguments passed to named scripts, e.g. `{ "dev": ["--host", "0.0.0.0"] }`. |
| `hiddenFiles` | Project-relative paths to mask. Exact paths only; globs are not supported. |

The default config only hides `dijk.config.json`. Add `.env` and any other
secret files yourself.

## Known gaps

Dijk is a prototype. These are known ways around the barrier today, roughly in
order of severity. They are being worked on.

- **Files the host trusts are writable.** The project is mounted read-write,
  including `.git/hooks`, `.git/config`, `package.json` scripts,
  `.vscode/tasks.json` and `.envrc`. Code in the container can plant commands
  that your host runs later, for example on the next `git status`.
- **A missing config can be planted.** If `dijk.config.json` does not exist,
  code in the container can create one that disables the network rules or
  mounts a different directory on the next run. Always run `dijk init` first.
- **DNS is not restricted.** Lookups for any domain reach Docker's resolver, so
  data can leak through DNS queries even when HTTP is blocked.
- **IP-level allowlisting.** Allowed domains are allowed by IP address. Services
  sharing an IP (common behind CDNs) are allowed too, and a CDN can return
  different IPs to the gateway and the container.
- **Your editor runs outside the sandbox.** The TypeScript server, linters and
  IDE test runners load `node_modules` on the host.
- **Linux binaries on macOS and Windows.** Packages with native binaries are
  installed for Linux, so running them directly on the host fails.
## Design principles

- **Feels like npm.** Same commands, same project layout.
- **Isolated by default.** Extra files, credentials and host tools must be
  added explicitly. No "accept the risk" button.
- **Backwards compatible.** Package maintainers should not need to change
  anything for Dijk.
- **Few dependencies.** A security tool should not add to the problem. Dijk has
  none.
- **Stays in its lane.** Dijk only manages the current project and its own
  containers. It does not inspect, modify or expose unrelated host files.

## Roadmap

- **Close the known gaps** above, starting with host-trusted files and config
  planting.
- **Secrets broker.** Let scripts use API keys without ever seeing them. See
  [Secrets broker](#secrets-broker-planned) below.
- **Editor support.** A way to run editor tooling against the sandboxed
  project, so `node_modules` code never runs on the host.
- **Other package managers.** pnpm, Yarn and Bun.
- **Other languages.** The same barrier for ecosystems beyond JavaScript,
  starting with Python (pip, uv and Poetry). Python packages can run arbitrary
  code at install time through `setup.py` and build backends, the same way npm
  lifecycle scripts do.

## Secrets broker (planned)

Dev servers and tests often need real credentials: a Stripe key, an API token,
a database password. Putting them in the container's environment hands them to
every dependency.

Dijk can't tell *which code* is asking for a secret. Inside one Node process,
every package has the same powers: any of them can patch `fetch`, fake a stack
trace or read a value from memory once your code has it. So the broker doesn't
decide who gets a secret. It makes sure the real value never enters the
container at all.

### How it works

1. **The container gets a placeholder.** `process.env.STRIPE_KEY` contains a
   random token like `dijk-ph-7f3a…`. Code reads env vars exactly as before.
2. **The gateway swaps it on the way out.** HTTPS traffic to a secret's
   allowed hosts goes through a proxy in the gateway. If a request contains the
   placeholder, the proxy replaces it with the real value before forwarding.
3. **Anywhere else, the placeholder is worthless.** Requests to other hosts are
   either blocked by the network allowlist or carry a token that means nothing.

Malicious code can still *use* a key against its allowed API while your
command runs, but it can't *steal* it. A leaked key becomes "something made API
calls during one session" instead of "an attacker has my key."

### Scoping

Secrets are scoped by command and destination, not by code path:

- **`install` and `ci` never get secrets.** Install scripts are where most
  attacks run.
- **Each secret lists the scripts that may use it**, for example only
  `dijk run dev`.
- **Each secret lists the hosts it may be sent to.** Allowed hosts are added to
  the network allowlist automatically.

```json
"secrets": {
  "STRIPE_KEY": {
    "from": "env:STRIPE_KEY",
    "scripts": ["dev", "test"],
    "allowedHosts": ["api.stripe.com"]
  }
}
```

### Where secrets live

Secrets live in the gateway container, not in a separate one. The app
container shares the gateway's network namespace, so any service the gateway
can reach over the network, the app can reach too. A separate "give me a
secret" container would be reachable by the code it's meant to protect against.

What the two containers don't share is files, environment and processes, so
secrets inside the gateway are out of the app's reach, provided that:

- **Nothing returns a secret.** The proxy only listens on the port that
  redirected HTTPS traffic arrives on, and only ever swaps placeholders in
  outgoing requests. There is no API to query.
- **The proxy and the app run as different users.** The proxy has its own uid.
  Firewall rules (`iptables -m owner`) redirect only the app's traffic to the
  proxy and let only the proxy connect out to secret-bearing hosts. The app
  always runs as a fixed non-root uid, never as root.
- **Secrets are mounted as a file**, readable only by the proxy's uid. Not as
  environment variables, which show up in `docker inspect` and logs.
- **The gateway is a small image Dijk builds and pins**, not a general-purpose
  network toolbox.

### TLS

Swapping a value inside an HTTPS request means the proxy has to terminate TLS.
Dijk generates a CA per project and trusts it inside the container, through
the system trust store and runtime-specific settings such as
`NODE_EXTRA_CA_CERTS` for Node and `SSL_CERT_FILE` / `REQUESTS_CA_BUNDLE` for
Python. Only traffic to secret-bearing hosts is intercepted;
everything else passes through untouched. The CA's private key stays in the
gateway.

### Limitations

- **HTTP(S) only.** Secrets used over other protocols, such as database
  passwords or signing keys, can't be swapped. These can be passed as a real
  environment variable to specific scripts, marked as a weaker option in the
  config.
- **Certificate pinning.** Clients that pin certificates reject the Dijk CA.
- **Use is not theft, but it's still use.** During a session, code in the
  container can make authenticated calls to a secret's allowed hosts.

### Later

The firewall needs `NET_ADMIN` but no secrets. The proxy needs secrets and
parses untrusted traffic, but needs no `NET_ADMIN`. Splitting them into two
containers would mean a bug in the proxy can't take over the firewall. That
split needs the same uid-based rules to be safe, so it comes after the
single-gateway version works.

## License

MIT. See [LICENSE](LICENSE).
