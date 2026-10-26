// sandbox planning

const { createHash } = require("node:crypto")
const { chmodSync, lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } = require("node:fs")
const { homedir } = require("node:os")
const { isAbsolute, join, normalize, relative, resolve, sep } = require("node:path")
const { configFileName, defaultProjectConfig, loadProjectConfig } = require("./config")

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
    const projectId = createHash("sha256").update(projectRoot).digest("hex").slice(0, 16)
    const cacheDir = join(getDijkCacheRoot(), "npm", projectId)

    mkdirSync(cacheDir, { recursive: true, mode: 0o700 })

    return cacheDir
}

const getDijkCacheRoot = function() {
    return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "dijk")
}

// Hidden files are replaced by this empty file, mounted read-only. On Linux it
// has no permissions, so reads and writes inside the container fail instead of
// silently returning nothing, as they would with /dev/null.
// Docker Desktop (macOS, Windows) reads bind mount sources as the host user,
// so it can't mount a file with no permissions. There the file is readable but
// still empty and mounted read-only, so the hidden content never reaches the
// sandbox and nothing can be written to it.
const maskFileMode = process.platform === "linux" ? 0o000 : 0o444

const getMaskFile = function() {
    const dir = getDijkCacheRoot()
    const maskFile = join(dir, "masked-file")

    mkdirSync(dir, { recursive: true, mode: 0o700 })

    try {
        const info = lstatSync(maskFile)

        if (info.isFile() && info.size === 0 && (info.mode & 0o777) === maskFileMode) {
            return maskFile
        }

        rmSync(maskFile, { force: true, recursive: true })
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error
        }
    }

    writeFileSync(maskFile, "", { mode: maskFileMode, flag: "wx" })
    chmodSync(maskFile, maskFileMode)

    return maskFile
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
        source: getMaskFile(),
        destination,
        readonly: true,
    }
}

const createHiddenFileMounts = function(projectRoot, workDir, hiddenFiles) {
    return hiddenFiles
        .map((hiddenFile) => createHiddenFileMount(projectRoot, workDir, hiddenFile))
        .filter(Boolean)
}

// The config decides what the sandbox may do, so code inside the sandbox must
// never be able to read or change it. Returns the mount that masks it, or null
// when the config lives outside the mounted project.
const createConfigMount = function(configRoot, projectRoot, workDir) {
    const configPath = join(configRoot, configFileName)
    let fileInfo

    try {
        fileInfo = lstatSync(configPath)
    } catch (error) {
        if (error.code === "ENOENT") {
            // Without a config there is nothing to mask, and a package could
            // create one that the next run would trust.
            throw new Error(`No ${configFileName} found. Run \`dijk init\` first.`)
        }

        throw error
    }

    if (!fileInfo.isFile()) {
        throw new Error(`${configFileName} must be a regular file, not a symbolic link or directory`)
    }

    // A second hard link would be a path to the config that the mask doesn't cover.
    if (fileInfo.nlink > 1) {
        throw new Error(`${configFileName} has more than one hard link`)
    }

    const pathFromProject = relative(projectRoot, realpathSync(configRoot))

    if (pathFromProject === ".." || pathFromProject.startsWith(`..${sep}`) || isAbsolute(pathFromProject)) {
        return null
    }

    // In a subdirectory of the project, sandboxed code could rename that
    // directory and put its own config in its place.
    if (pathFromProject !== "") {
        throw new Error(`projectDir (${projectRoot}) contains the folder with ${configFileName}. `
            + `Keep ${configFileName} in the project root, or outside the project.`)
    }

    return {
        type: "bind",
        source: getMaskFile(),
        destination: `${workDir}/${configFileName}`,
        readonly: true,
    }
}

const createSandboxPlan = function(command, overrides = {}) {
    const configRoot = defaultSandboxConfig.configRoot
    const projectConfig = loadProjectConfig(configRoot)
    const projectRoot = getProjectRoot(projectConfig)
    const workDir = defaultSandboxConfig.workDir
    const configMount = createConfigMount(configRoot, projectRoot, workDir)
    // The config is always masked, so it doesn't need to be in hiddenFiles.
    const hiddenFiles = (projectConfig.hiddenFiles ?? defaultSandboxConfig.hiddenFiles)
        .filter((hiddenFile) => normalize(hiddenFile) !== configFileName)
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
            ...(configMount ? [configMount] : []),
            ...createHiddenFileMounts(projectRoot, workDir, hiddenFiles),
        ],
    }
}

module.exports = { createSandboxPlan, getProjectRoot }
