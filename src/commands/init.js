// dijk init command

const { basename } = require("node:path")
const { createProjectConfig } = require("../core/config")

const initCommand = function() {
    const configPath = createProjectConfig()
    console.log(`Created ${basename(configPath)}

Run everything for this project through Dijk:

  dijk install
  dijk run <script>
  dijk exec <command>

Dijk installs Linux builds of native packages. If a tool on your machine fails
with a "wrong platform" error (esbuild, Rollup, SWC, sharp), that's expected:
run it through Dijk instead of reinstalling with plain npm.

Editor extensions and git hooks still run dependency code on your machine.
See the README section "Use it for everything".`)

    return 0
}

module.exports = { initCommand }
