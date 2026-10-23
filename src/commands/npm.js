// npm passthrough commands

const { loadProjectConfig } = require("../core/config")
const { runNpmCommand, runSandboxCommand } = require("../core/npm")

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

    return runNpmCommand([...npmArgs, ...configuredArgs], {
        publishPorts: true,
    })
}

// dijk exec <command> [args...]
// Runs any command in the same sandbox as `dijk run`. There are deliberately no
// options here: network, mounts and env always come from dijk.config.json, so
// a command line can't loosen the sandbox.
const execCommand = function(args = []) {
    const command = args[0] === "--" ? args.slice(1) : args

    if (command.length === 0) {
        throw new Error("Usage: dijk exec <command> [args...]")
    }

    // The Node image's entrypoint turns a leading "-" argument into `node -...`.
    // Require an explicit command name so what runs is never a surprise.
    if (command[0].startsWith("-")) {
        throw new Error(`dijk exec: expected a command, got option "${command[0]}"`)
    }

    return runSandboxCommand(command, {
        publishPorts: true,
    })
}

module.exports = {
    ciCommand,
    execCommand,
    installCommand,
    runCommand,
}
