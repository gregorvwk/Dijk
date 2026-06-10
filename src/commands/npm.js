// npm passthrough commands

const { loadProjectConfig } = require("../core/config")
const { runNpmCommand } = require("../core/npm")

const installCommand = function(args = []) {
    return runNpmCommand(["install", ...args])
}

const ciCommand = function(args = []) {
    return runNpmCommand(["ci", ...args])
}

const runCommand = function(args = []) {
    const [script] = args
    const configuredArgs = loadProjectConfig().runArgs?.[script] ?? []
    const npmArgs = ["run", ...args]

    if (configuredArgs.length > 0 && !npmArgs.includes("--")) {
        npmArgs.push("--")
    }

    return runNpmCommand([...npmArgs, ...configuredArgs])
}

module.exports = {
    ciCommand,
    installCommand,
    runCommand,
}
