// project config

const { readFileSync, writeFileSync } = require("node:fs")
const { isIP } = require("node:net")
const { isAbsolute, join, normalize, sep } = require("node:path")

const configFileName = "dijk.config.json"
const defaultProjectConfig = {
    image: "node:22-bookworm-slim",
    projectDir: "./",
    ports: [],
    network: {
        enabled: true,
        allowedDomains: ["registry.npmjs.org"],
        allowedIps: [],
    },
    runArgs: {},
    hiddenFiles: [configFileName],
}

const getConfigPath = function(projectRoot) {
    return join(projectRoot, configFileName)
}

const isSafeProjectPath = function(path) {
    if (typeof path !== "string" || !path.trim() || isAbsolute(path) || path.includes(",")) {
        return false
    }

    const normalizedPath = normalize(path)

    return normalizedPath !== "." && normalizedPath !== ".." && !normalizedPath.startsWith(`..${sep}`)
}

const isDomainName = function(domain) {
    if (typeof domain !== "string" || !domain.trim() || domain.includes("/") || domain.includes(":")) {
        return false
    }

    return domain
        .split(".")
        .every((part) => {
            return part
                && !part.startsWith("-")
                && !part.endsWith("-")
                && part.split("").every((char) => {
                    const code = char.charCodeAt(0)
                    const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
                    const isNumber = code >= 48 && code <= 57

                    return isLetter || isNumber || char === "-"
                })
        })
}

const validateNetworkConfig = function(network) {
    if (!network || typeof network !== "object" || Array.isArray(network)) {
        return false
    }

    const allowedIps = network.allowedIps ?? []

    return typeof network.enabled === "boolean"
        && Array.isArray(network.allowedDomains)
        && network.allowedDomains.every(isDomainName)
        && Array.isArray(allowedIps)
        && allowedIps.every((ip) => typeof ip === "string" && isIP(ip) !== 0)
}

const validateConfig = function(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new Error(`${configFileName}: config must be an object`)
    }

    if (config.image !== undefined && (typeof config.image !== "string" || !config.image.trim())) {
        throw new Error(`${configFileName}: image must be a non-empty string`)
    }

    if (config.projectDir !== undefined && (typeof config.projectDir !== "string" || !config.projectDir.trim())) {
        throw new Error(`${configFileName}: projectDir must be a non-empty path`)
    }

    if (config.ports !== undefined) {
        if (!Array.isArray(config.ports) || config.ports.some((port) => typeof port !== "string" || !port.trim())) {
            throw new Error(`${configFileName}: ports must be an array of non-empty strings`)
        }
    }

    if (config.network !== undefined && !validateNetworkConfig(config.network)) {
        throw new Error(`${configFileName}: network must contain enabled, allowedDomains, and optional allowedIps`)
    }

    if (config.runArgs !== undefined) {
        const invalidRunArgs = !config.runArgs
            || typeof config.runArgs !== "object"
            || Array.isArray(config.runArgs)
            || Object.entries(config.runArgs).some(([script, args]) => {
                return !script.trim()
                    || !Array.isArray(args)
                    || args.some((arg) => typeof arg !== "string" || !arg.trim())
            })

        if (invalidRunArgs) {
            throw new Error(`${configFileName}: runArgs must map script names to arrays of non-empty strings`)
        }
    }

    if (config.hiddenFiles !== undefined) {
        if (!Array.isArray(config.hiddenFiles) || config.hiddenFiles.some((path) => !isSafeProjectPath(path))) {
            throw new Error(`${configFileName}: hiddenFiles must contain relative paths inside the project`)
        }
    }
}

const loadProjectConfig = function(projectRoot = process.cwd()) {
    const configPath = getConfigPath(projectRoot)
    let config

    try {
        config = JSON.parse(readFileSync(configPath, "utf-8"))
    } catch (error) {
        if (error.code === "ENOENT") {
            return {}
        }

        if (error instanceof SyntaxError) {
            throw new Error(`${configFileName}: invalid JSON`)
        }

        throw error
    }

    validateConfig(config)

    return config
}

const createProjectConfig = function(projectRoot = process.cwd()) {
    const configPath = getConfigPath(projectRoot)

    try {
        writeFileSync(configPath, `${JSON.stringify(defaultProjectConfig, null, 2)}\n`, {
            encoding: "utf-8",
            flag: "wx",
        })
    } catch (error) {
        if (error.code === "EEXIST") {
            throw new Error(`${configFileName} already exists`)
        }

        throw error
    }

    return configPath
}

module.exports = {
    configFileName,
    createProjectConfig,
    defaultProjectConfig,
    loadProjectConfig,
}
