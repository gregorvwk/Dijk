// code for npm passthrough

const { runDockerPlan } = require("./docker")
const { createSandboxPlan } = require("./plan")

// Runs a command inside a new sandbox container. The command is always passed
// to Docker as an argument array after the image name, so it can never be read
// as a Docker flag or by a shell on the host.
const runSandboxCommand = function(command, options = {}) {
    const plan = createSandboxPlan(command, options)

    return runDockerPlan(plan)
}

const runNpmCommand = function(args, options = {}) {
    return runSandboxCommand(["npm", ...args], options)
}

module.exports = { runNpmCommand, runSandboxCommand }
