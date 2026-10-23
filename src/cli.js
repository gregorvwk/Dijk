#!/usr/bin/env node

const { cleanupCommand } = require("./commands/cleanup")
const { helpCommand } = require("./commands/help")
const { initCommand } = require("./commands/init")
const { ciCommand, execCommand, installCommand, runCommand } = require("./commands/npm")

const COMMANDS = {
    INSTALL: "install",
    CI: "ci",
    RUN: "run",
    EXEC: "exec",
    INIT: "init",
    CLEANUP: "cleanup",
    HELP: "--help",
}

const main = async function() {
    const command = process.argv[2]
    const args = process.argv.slice(3)

    switch (command) {
        case COMMANDS.INSTALL:
            return installCommand(args)
        case COMMANDS.CI:
            return ciCommand(args)
        case COMMANDS.RUN:
            return runCommand(args)
        case COMMANDS.EXEC:
            return execCommand(args)
        case COMMANDS.INIT:
            return initCommand()
        case COMMANDS.CLEANUP:
            return cleanupCommand(args)
        case COMMANDS.HELP:
            return helpCommand()
        default:
            helpCommand()
            return command ? 1 : 0
    }
}

main()
    .then((code) => {
        process.exitCode = code
    })
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
    })
