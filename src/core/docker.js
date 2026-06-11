// docker setup

const { lstatSync, realpathSync } = require("node:fs")
const { relative, resolve, sep } = require("node:path")
const { spawnSync } = require("node:child_process")
const { defaultProjectConfig, loadProjectConfig } = require("./config")
const { spawnProcess } = require("../utils/exec")

const defaultDockerConfig = {
    image: defaultProjectConfig.image,
    ports: defaultProjectConfig.ports,
    hiddenFiles: defaultProjectConfig.hiddenFiles,
    workDir: "/workspace",
    configRoot: process.cwd(),
    projectRoot: process.cwd(),
    user: typeof process.getuid === "function" && typeof process.getgid === "function"
        ? `${process.getuid()}:${process.getgid()}`
        : null,
    env: {
        HOME: "/tmp",
    },
}

const getDockerConfig = function() {
    const projectConfig = loadProjectConfig(defaultDockerConfig.configRoot)
    const projectRoot = resolveProjectRoot(
        defaultDockerConfig.configRoot,
        projectConfig.projectDir ?? defaultProjectConfig.projectDir,
    )

    return {
        ...defaultDockerConfig,
        image: projectConfig.image ?? defaultDockerConfig.image,
        ports: projectConfig.ports ?? defaultDockerConfig.ports,
        hiddenFiles: projectConfig.hiddenFiles ?? defaultDockerConfig.hiddenFiles,
        projectRoot,
    }
}

const resolveProjectRoot = function(configRoot, projectDir) {
    const realConfigRoot = realpathSync(configRoot)
    const projectRoot = realpathSync(resolve(realConfigRoot, projectDir))

    if (!lstatSync(projectRoot).isDirectory()) {
        throw new Error(`Project directory is not a directory: ${projectDir}`)
    }

    return projectRoot
}

const createContainerName = function() {
    return `dijk-${process.pid}-${Date.now()}`
}

const removeContainer = function(containerName) {
    spawnSync("docker", ["rm", "--force", containerName], {
        stdio: "ignore",
    })
}

const addHiddenFileMounts = function(args, config) {
    const realProjectRoot = realpathSync(config.projectRoot)

    for (const hiddenFile of config.hiddenFiles) {
        const hostPath = resolve(config.projectRoot, hiddenFile)
        const containerPath = `${config.workDir}/${hiddenFile.split(sep).join("/")}`
        let fileInfo

        try {
            fileInfo = lstatSync(hostPath)
        } catch (error) {
            if (error.code === "ENOENT") {
                continue
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
            args.push("--mount", `type=tmpfs,destination=${containerPath},tmpfs-mode=000`)
            continue
        }

        args.push("--mount", `type=bind,source=/dev/null,destination=${containerPath},readonly`)
    }
}

const bindPortToLocalhost = function(port) {
    const [mapping, protocol] = port.split("/")
    const parts = mapping.split(":")

    if (parts.length > 2) {
        return port
    }

    const [hostPort, containerPort = hostPort] = parts
    const protocolSuffix = protocol ? `/${protocol}` : ""

    return `127.0.0.1:${hostPort}:${containerPort}${protocolSuffix}`
}

const buildDockerRunArgs = function(npmArgs, containerName, config = getDockerConfig()) {
    const args = [
        "run",
        "--rm",
        "--init",
        "--name",
        containerName,
        "--label",
        "dijk=true",
        "--label",
        `dijk.project=${config.projectRoot}`,
        "--volume",
        `${config.projectRoot}:${config.workDir}`,
        "--workdir",
        config.workDir,
    ]

    addHiddenFileMounts(args, config)

    if (config.user) {
        args.push("--user", config.user)
    }

    if (npmArgs[0] === "run") {
        for (const port of config.ports) {
            args.push("--publish", bindPortToLocalhost(port))
        }
    }

    for (const [name, value] of Object.entries(config.env)) {
        args.push("--env", `${name}=${value}`)
    }

    args.push(config.image, "npm", ...npmArgs)

    return args
}

const spawnDockerProcess = function(npmArgs, config = getDockerConfig()) {
    const containerName = createContainerName()
    const dockerArgs = buildDockerRunArgs(npmArgs, containerName, config)

    return spawnProcess("docker", dockerArgs, {
        cleanup: () => removeContainer(containerName),
    })
}

module.exports = { spawnDockerProcess }
