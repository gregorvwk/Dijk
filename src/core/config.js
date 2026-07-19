// project config

const { readFileSync, writeFileSync } = require("node:fs")
const { isAbsolute, join, normalize, sep } = require("node:path")

const configFileName = "dijk.config.json"
const defaultProjectConfig = {
    image: "node:22-bookworm-slim",
    projectDir: "./",
    ports: [],
    secrets: {},
    secretProfiles: {},
    runArgs: {},
    hiddenFiles: [configFileName, ".env"],
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

const isEnvName = function(name) {
    if (typeof name !== "string" || !name.trim()) {
        return false
    }

    return name.split("").every((char, index) => {
        const code = char.charCodeAt(0)
        const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
        const isNumber = code >= 48 && code <= 57

        return char === "_" || isLetter || (index > 0 && isNumber)
    })
}

const isPlainObject = function(value) {
    return value && typeof value === "object" && !Array.isArray(value)
}

const validateSecretEnv = function(env) {
    return isPlainObject(env)
        && Object.entries(env).every(([containerName, hostName]) => {
            return isEnvName(containerName) && isEnvName(hostName)
        })
}

const validateSecrets = function(secrets, hiddenFiles) {
    return isPlainObject(secrets)
        && Object.entries(secrets).every(([profile, secretConfig]) => {
            return profile.trim()
                && isPlainObject(secretConfig)
                && isSafeProjectPath(secretConfig.from)
                && hiddenFiles.includes(secretConfig.from)
                && validateSecretEnv(secretConfig.env)
        })
}

const validateSecretProfiles = function(secretProfiles) {
    return isPlainObject(secretProfiles)
        && Object.entries(secretProfiles).every(([command, profile]) => {
            return command.trim() && typeof profile === "string" && profile.trim()
        })
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

    if (config.hiddenFiles !== undefined) {
        if (!Array.isArray(config.hiddenFiles) || config.hiddenFiles.some((path) => !isSafeProjectPath(path))) {
            throw new Error(`${configFileName}: hiddenFiles must contain relative paths inside the project`)
        }
    }

    if (config.secrets !== undefined && !validateSecrets(config.secrets, config.hiddenFiles ?? defaultProjectConfig.hiddenFiles)) {
        throw new Error(`${configFileName}: secrets must map profiles to hidden env files and environment variable mappings`)
    }

    if (config.secretProfiles !== undefined && !validateSecretProfiles(config.secretProfiles)) {
        throw new Error(`${configFileName}: secretProfiles must map command names to profile names`)
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
    createProjectConfig,
    defaultProjectConfig,
    loadProjectConfig,
}
