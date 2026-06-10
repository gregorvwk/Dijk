// dijk init command

const { basename } = require("node:path")
const { createProjectConfig } = require("../core/config")

const initCommand = function() {
    const configPath = createProjectConfig()
    console.log(`Created ${basename(configPath)}`)

    return 0
}

module.exports = { initCommand }
