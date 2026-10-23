// dijk cleanup command

const { spawnSync } = require("node:child_process")
const { getProjectRoot } = require("../core/plan")

const listDockerIds = function(args) {
    const result = spawnSync("docker", args, {
        encoding: "utf-8",
    })

    if (result.error) {
        throw result.error
    }

    if (result.status !== 0) {
        throw new Error((result.stderr || "Docker command failed").trim())
    }

    return result.stdout
        .split("\n")
        .map((id) => id.trim())
        .filter(Boolean)
}

const removeDockerResources = function(args, ids) {
    if (ids.length === 0) {
        return 0
    }

    const result = spawnSync("docker", [...args, ...ids], {
        stdio: ["ignore", "ignore", "inherit"],
    })

    return result.status ?? 1
}

// Without --all, only the current project's containers and networks are removed,
// so cleaning up one project doesn't kill dev servers running in another.
const cleanupCommand = function(args = []) {
    const cleanAll = args.includes("--all")
    const filter = cleanAll
        ? "label=dijk=true"
        : `label=dijk.project=${getProjectRoot()}`

    // Containers first: a network can't be removed while a gateway still uses it.
    const containerIds = listDockerIds(["ps", "--all", "--quiet", "--filter", filter])
    const containerStatus = removeDockerResources(["rm", "--force"], containerIds)
    const networkIds = listDockerIds(["network", "ls", "--quiet", "--filter", filter])
    const networkStatus = removeDockerResources(["network", "rm"], networkIds)

    const scope = cleanAll ? "all projects" : "this project"

    if (containerIds.length === 0 && networkIds.length === 0) {
        console.log(`No Dijk containers or networks to clean up for ${scope}`)
    } else {
        console.log(`Removed ${containerIds.length} container(s) and ${networkIds.length} network(s) for ${scope}`)
    }

    return containerStatus || networkStatus
}

module.exports = { cleanupCommand }
