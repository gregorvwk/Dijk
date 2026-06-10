# Dijk

A security barrier for package managers.

Dijk's mission is to make dependency management safer by default.

Modern package managers execute third-party code with broad access to the host system. Dijk places a security barrier between package managers and the machine they run on, limiting access to files, secrets, networks, and other resources while remaining compatible with existing developer workflows.

## Status

Dijk is an early prototype. Do not rely on it as a complete security boundary yet.

## Install

Dijk is not published yet. Link it from this repo.

You need:

- Node.js
- npm
- Docker

Then link the CLI locally:

```sh
git clone https://github.com/gregorvwk/dijk.git
cd dijk
npm link
```

Check that it works:

```sh
dijk --help
```

Use it inside another npm project:

```sh
dijk install
dijk run dev
```

If a dev server gets stuck, clean up Dijk containers with:

```sh
dijk cleanup
```

## Config

Create a project config with:

```sh
dijk init
```

This creates `dijk.config.json` in the current project. Edit it to choose the
Docker image, published ports, and script arguments:

```json
{
  "image": "node:22-bookworm-slim",
  "ports": ["3000", "5173"],
  "runArgs": {},
  "hiddenFiles": ["dijk.config.json", ".env"]
}
```

- `image` selects the Docker image.
- `ports` publishes ports for `dijk run` commands and binds them to host
  `127.0.0.1` by default. Use `"8080:3000"` to map different host and container
  ports. To deliberately expose a port to the network, include an address such as
  `"0.0.0.0:8080:3000"`. Applications must listen on `0.0.0.0` inside the
  container for published ports to be reachable.
- `runArgs` optionally passes arguments to named scripts.
- `hiddenFiles` contains relative project paths to mask.

## Features

### Temporary containers

Each command runs in a new Docker container. Containers are stopped and removed
when the command exits or is interrupted.

### Project-only access

Only the current project's files are exposed to the container. The container runs
as the current user on Unix, so generated files keep their normal ownership.

### Persistent dependencies

The project's `node_modules` remains in the project between commands. Repeated
`dijk install` runs only update what changed, like npm normally does.

### Hidden files

Configured files and directories are masked inside the container. Package scripts
cannot read their original contents.

## What is it trying to solve?

### Supply chain attacks

npm packages can run code during install, build, test, and other scripts. If a
package is malicious or compromised, it should not automatically get access to your whole computer.

Dijk reduces the attack surface by running npm in a docker container.

### Too much computer access

Most npm commands only need a few things:

- the current project
- Node.js and npm
- a package cache
- network access
- selected environment variables

Everything else should be off limits unless the developer adds it to the sandbox configuration.

## What it does not solve

- It does not make malicious packages safe.
- It does not block malicious network behavior.
- It does not aim to support every unusual native build or host integration.

## Design principles

- Feels like `npm`.
- Isolate by default. Extra file access, credentials, and host tools should be
  explicitly added by the developer. No terms and conditions 'accept' button!
- Stay backwards compatible. Package maintainers should not need to change their
  packages for Dijk.
- Least amount of dependencies. Dijk should not create more problems.
- Dijk itself only manages the current project and its containers. It does not inspect, modify, or expose unrelated host files.

## Roadmap

- Secrets broker: The Secrets Broker provides controlled access to sensitive values without exposing them to all dependencies.
- Network restrictions: Network Restrictions limit when and how dependencies can communicate with external systems.
- Support for other package managers: Bring Dijk isolation to package managers beyond npm.
