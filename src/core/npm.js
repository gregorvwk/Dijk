// code for npm passthrough

const { spawnDockerProcess } = require("./docker")

const runNpmCommand = function(args) {
    return spawnDockerProcess(args)
}

module.exports = { runNpmCommand }