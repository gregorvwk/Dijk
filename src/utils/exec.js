// terminal process interaction

const { spawn } = require("node:child_process")

const createProcessController = function(child, resolve, reject, cleanup) {
    let settled = false

    const handleSigint = function() {
        stop("SIGINT", 130)
    }
    const handleSigterm = function() {
        stop("SIGTERM", 143)
    }

    const removeSignalHandlers = function() {
        process.off("SIGINT", handleSigint)
        process.off("SIGTERM", handleSigterm)
    }

    const finish = function(code) {
        if (settled) {
            return
        }

        settled = true
        removeSignalHandlers()
        cleanup?.()
        resolve(code)
    }

    const fail = function(error) {
        if (settled) {
            return
        }

        settled = true
        removeSignalHandlers()
        cleanup?.()
        reject(error)
    }

    const stop = function(signal, exitCode) {
        if (!child.killed) {
            child.kill(signal)
        }

        finish(exitCode)
    }

    return {
        finish,
        fail,
        registerSignalHandlers() {
            process.once("SIGINT", handleSigint)
            process.once("SIGTERM", handleSigterm)
        },
    }
}

const spawnProcess = function(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: "inherit",
            shell: false,
        })

        const controller = createProcessController(child, resolve, reject, options.cleanup)
        controller.registerSignalHandlers()

        child.on("error", controller.fail)
        child.on("exit", (code) => controller.finish(code ?? 1))
    })
}

module.exports = { spawnProcess }
