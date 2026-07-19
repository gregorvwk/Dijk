// npm passthrough commands

const { readFileSync } = require("node:fs")
const { resolve } = require("node:path")
const { loadProjectConfig } = require("../core/config")
const { runNpmCommand } = require("../core/npm")

const parseSecretFile = function(content) {
    const values = {}

    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim()

        if (!line || line.startsWith("#")) {
            continue
        }

        const separatorIndex = line.indexOf("=")

        if (separatorIndex === -1) {
            continue
        }

        const name = line.slice(0, separatorIndex).trim().replace(/^export\s+/, "")
        let value = line.slice(separatorIndex + 1).trim()

        if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }

        values[name] = value
    }

    return values
}

const loadSecretSources = function(config, secretConfig) {
    const projectRoot = resolve(process.cwd(), config.projectDir ?? "./")
    const filePath = resolve(projectRoot, secretConfig.from)
    let values = {}

    try {
        values = parseSecretFile(readFileSync(filePath, "utf-8"))
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error
        }
    }

    return {
        ...values,
        ...process.env,
    }
}

const getSecretEnv = function(config, commandKey) {
    const profile = config.secretProfiles?.[commandKey]

    if (!profile) {
        return {}
    }

    const secretConfig = config.secrets?.[profile]

    if (!secretConfig) {
        return {}
    }

    const secretMappings = secretConfig.env
    const sourceValues = loadSecretSources(config, secretConfig)
    const env = {}

    for (const [containerName, hostName] of Object.entries(secretMappings)) {
        if (sourceValues[hostName] !== undefined) {
            env[containerName] = sourceValues[hostName]
        }
    }

    return env
}

const runConfiguredNpmCommand = function(commandKey, npmArgs, config = loadProjectConfig()) {
    return runNpmCommand(npmArgs, {
        env: getSecretEnv(config, commandKey),
    })
}

const installCommand = function(args = []) {
    return runConfiguredNpmCommand("install", ["install", ...args])
}

const ciCommand = function(args = []) {
    return runConfiguredNpmCommand("ci", ["ci", ...args])
}

const runCommand = function(args = []) {
    const [script] = args
    const config = loadProjectConfig()
    const configuredArgs = config.runArgs?.[script] ?? []
    const npmArgs = ["run", ...args]

    if (configuredArgs.length > 0 && !npmArgs.includes("--")) {
        npmArgs.push("--")
    }

    return runConfiguredNpmCommand("run:" + script, [...npmArgs, ...configuredArgs], config)
}

module.exports = {
    ciCommand,
    installCommand,
    runCommand,
}
