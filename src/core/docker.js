// docker runtime

const { spawnSync } = require("node:child_process")
const { resolve } = require("node:path")
const { spawnProcess } = require("../utils/exec")

const gatewayImage = "nicolaka/netshoot:latest"
const gatewayScriptPath = resolve(__dirname, "../network/gateway.sh")

const createResourceName = function(type) {
    return `dijk-${type}-${process.pid}-${Date.now()}`
}

const createContainerName = function() {
    return createResourceName("app")
}

const runDockerCommand = function(args) {
    const result = spawnSync("docker", args, {
        encoding: "utf-8",
    })

    if (result.status !== 0) {
        throw new Error((result.stderr || result.stdout || "Docker command failed").trim())
    }

    return result.stdout.trim()
}

const removeContainer = function(containerName) {
    spawnSync("docker", ["rm", "--force", containerName], {
        stdio: "ignore",
    })
}

const removeNetwork = function(networkName) {
    spawnSync("docker", ["network", "rm", networkName], {
        stdio: "ignore",
    })
}

const cleanupNetworkGateway = function(gateway) {
    if (!gateway) {
        return
    }

    removeContainer(gateway.containerName)
    removeNetwork(gateway.networkName)
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

const addMountArgs = function(args, mount) {
    if (mount.type === "tmpfs") {
        args.push("--mount", `type=tmpfs,destination=${mount.destination},tmpfs-mode=${mount.mode}`)
        return
    }

    const readonlySuffix = mount.readonly ? ",readonly" : ""

    args.push("--mount", `type=bind,source=${mount.source},destination=${mount.destination}${readonlySuffix}`)
}

const getAllowedIps = function(network) {
    if (!Array.isArray(network.allowedIps)) {
        return []
    }

    return network.allowedIps
}

const hasAllowedNetworkTargets = function(network) {
    return network.allowedDomains.length > 0 || getAllowedIps(network).length > 0
}

const addLabelArgs = function(args, labels) {
    for (const [name, value] of Object.entries(labels)) {
        args.push("--label", `${name}=${value}`)
    }
}

// Keep stdin open so prompts work, and allocate a TTY when Dijk itself runs in
// a terminal, so colors, interactive CLIs and dev server shortcuts work too.
const addTerminalArgs = function(args) {
    args.push("--interactive")

    if (process.stdin.isTTY && process.stdout.isTTY) {
        args.push("--tty")
    }
}

const addPortArgs = function(args, plan) {
    if (plan.command[0] !== "npm" || plan.command[1] !== "run") {
        return
    }

    for (const port of plan.ports) {
        args.push("--publish", bindPortToLocalhost(port))
    }
}

const waitForNetworkGateway = function(containerName) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const ready = spawnSync("docker", ["exec", containerName, "test", "-f", "/tmp/dijk-gateway-ready"])

        if (ready.status === 0) {
            return
        }

        const failed = spawnSync("docker", ["exec", containerName, "test", "-f", "/tmp/dijk-gateway-failed"])

        if (failed.status === 0) {
            throw new Error("Dijk gateway failed to initialize")
        }

        spawnSync("sleep", ["0.1"])
    }

    throw new Error("Dijk gateway did not become ready")
}

const startNetworkGateway = function(plan) {
    if (!plan.network.enabled || !hasAllowedNetworkTargets(plan.network)) {
        return null
    }

    const networkName = createResourceName("net")
    const containerName = createResourceName("gateway")
    const args = [
        "run",
        "--detach",
        "--rm",
        "--init",
        "--name",
        containerName,
        "--network",
        networkName,
        "--cap-add",
        "NET_ADMIN",
    ]

    addLabelArgs(args, plan.labels)
    args.push(
        "--env",
        `ALLOWED_DOMAINS=${plan.network.allowedDomains.join(",")}`,
        "--env",
        `ALLOWED_IPS=${getAllowedIps(plan.network).join(",")}`,
        "--mount",
        `type=bind,source=${gatewayScriptPath},destination=/dijk-gateway.sh,readonly`,
    )

    addPortArgs(args, plan)
    args.push(gatewayImage, "sh", "/dijk-gateway.sh")

    const networkArgs = ["network", "create"]
    addLabelArgs(networkArgs, plan.labels)
    networkArgs.push(networkName)

    try {
        runDockerCommand(networkArgs)
        runDockerCommand(args)
        waitForNetworkGateway(containerName)
    } catch (error) {
        cleanupNetworkGateway({ containerName, networkName })
        throw error
    }

    return { containerName, networkName }
}

const buildDockerRunArgs = function(plan, containerName, gateway) {
    const env = {
        ...plan.env,
    }
    const args = [
        "run",
        "--rm",
        "--init",
        "--name",
        containerName,
    ]

    addTerminalArgs(args)
    addLabelArgs(args, plan.labels)

    for (const mount of plan.mounts) {
        addMountArgs(args, mount)
    }

    args.push("--workdir", plan.workDir)

    if (gateway) {
        args.push("--network", `container:${gateway.containerName}`)
    } else if (plan.network.enabled && !hasAllowedNetworkTargets(plan.network)) {
        args.push("--network", "none")
    }

    if (plan.user) {
        args.push("--user", plan.user)
    }

    if (!gateway) {
        addPortArgs(args, plan)
    }

    for (const [name, value] of Object.entries(env)) {
        args.push("--env", `${name}=${value}`)
    }

    args.push(plan.image, ...plan.command)

    return args
}

const runDockerPlan = function(plan) {
    const gateway = startNetworkGateway(plan)
    const containerName = createContainerName()
    const dockerArgs = buildDockerRunArgs(plan, containerName, gateway)

    return spawnProcess("docker", dockerArgs, {
        cleanup: () => {
            removeContainer(containerName)
            cleanupNetworkGateway(gateway)
        },
    })
}

module.exports = { runDockerPlan }
