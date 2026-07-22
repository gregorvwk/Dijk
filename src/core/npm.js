// code for npm passthrough

const { runDockerPlan } = require("./docker")
const { createSandboxPlan } = require("./plan")

const runNpmCommand = function(args, options = {}) {
    const plan = createSandboxPlan(["npm", ...args], options)

    return runDockerPlan(plan)
}

module.exports = { runNpmCommand }
