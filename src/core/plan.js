// sandbox planning

const { createHash } = require("node:crypto")
const { lstatSync, mkdirSync, realpathSync } = require("node:fs")
const { homedir } = require("node:os")
const { join, relative, resolve, sep } = require("node:path")
const { defaultProjectConfig, loadProjectConfig } = require("./config")

const npmCacheDestination = "/dijk/npm-cache"

const defaultSandboxConfig = {
    image: defaultProjectConfig.image,
    ports: defaultProjectConfig.ports,
    network: defaultProjectConfig.network,
    hiddenFiles: defaultProjectConfig.hiddenFiles,
    workDir: "/workspace",
    configRoot: process.cwd(),
    user: typeof process.getuid === "function" && typeof process.getgid === "function"
        ? `${process.getuid()}:${process.getgid()}`
        : null,
    env: {
        HOME: "/tmp",
    },
}

const resolveProjectRoot = function(configRoot, projectDir) {
    const realConfigRoot = realpathSync(configRoot)
    const projectRoot = realpathSync(resolve(realConfigRoot, projectDir))

    if (!lstatSync(projectRoot).isDirectory()) {
        throw new Error(`Project directory is not a directory: ${projectDir}`)
    }

    return projectRoot
}

const getProjectRoot = function(projectConfig = loadProjectConfig(defaultSandboxConfig.configRoot)) {
    return resolveProjectRoot(
        defaultSandboxConfig.configRoot,
        projectConfig.projectDir ?? defaultProjectConfig.projectDir,
    )
}

// Each project gets its own npm cache on the host, so a package in one project
// cannot tamper with cached metadata or tarballs used by another project.
const getNpmCacheDir = function(projectRoot) {
    const cacheRoot = process.env.XDG_CACHE_HOME || join(homedir(), ".cache")
    const projectId = createHash("sha256").update(projectRoot).digest("hex").slice(0, 16)
    const cacheDir = join(cacheRoot, "dijk", "npm", projectId)

    mkdirSync(cacheDir, { recursive: true, mode: 0o700 })

    return cacheDir
}

const createHiddenFileMount = function(projectRoot, workDir, hiddenFile) {
    const realProjectRoot = realpathSync(projectRoot)
    const hostPath = resolve(projectRoot, hiddenFile)
    const destination = `${workDir}/${hiddenFile.split(sep).join("/")}`
    let fileInfo

    try {
        fileInfo = lstatSync(hostPath)
    } catch (error) {
        if (error.code === "ENOENT") {
            return null
        }

        throw error
    }

    if (fileInfo.isSymbolicLink()) {
        throw new Error(`Cannot hide symbolic link: ${hiddenFile}`)
    }

    const realHiddenPath = realpathSync(hostPath)
    const pathFromProject = relative(realProjectRoot, realHiddenPath)

    if (pathFromProject === ".." || pathFromProject.startsWith(`..${sep}`)) {
        throw new Error(`Hidden path escapes the project: ${hiddenFile}`)
    }

    if (fileInfo.isDirectory()) {
        return {
            type: "tmpfs",
            destination,
            mode: "000",
        }
    }

    return {
        type: "bind",
        source: "/dev/null",
        destination,
        readonly: true,
    }
}

const createHiddenFileMounts = function(projectRoot, workDir, hiddenFiles) {
    return hiddenFiles
        .map((hiddenFile) => createHiddenFileMount(projectRoot, workDir, hiddenFile))
        .filter(Boolean)
}

const createSandboxPlan = function(command, overrides = {}) {
    const projectConfig = loadProjectConfig(defaultSandboxConfig.configRoot)
    const projectRoot = getProjectRoot(projectConfig)
    const hiddenFiles = projectConfig.hiddenFiles ?? defaultSandboxConfig.hiddenFiles
    const workDir = defaultSandboxConfig.workDir
    const env = {
        ...defaultSandboxConfig.env,
        npm_config_cache: npmCacheDestination,
        ...overrides.env,
    }

    return {
        image: projectConfig.image ?? defaultSandboxConfig.image,
        command,
        workDir,
        projectRoot,
        user: defaultSandboxConfig.user,
        env,
        ports: projectConfig.ports ?? defaultSandboxConfig.ports,
        publishPorts: overrides.publishPorts === true,
        network: projectConfig.network ?? defaultSandboxConfig.network,
        labels: {
            dijk: "true",
            "dijk.project": projectRoot,
        },
        mounts: [
            {
                type: "bind",
                source: projectRoot,
                destination: workDir,
            },
            {
                type: "bind",
                source: getNpmCacheDir(projectRoot),
                destination: npmCacheDestination,
            },
            ...createHiddenFileMounts(projectRoot, workDir, hiddenFiles),
        ],
    }
}

module.exports = { createSandboxPlan, getProjectRoot }
