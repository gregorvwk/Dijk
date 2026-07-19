// code for npm passthrough

const { spawnDockerProcess } = require("./docker")

const runNpmCommand = function(args, options = {}) {
    return spawnDockerProcess(args, options)
}

module.exports = { runNpmCommand }