// dijk cleanup command

const { spawnSync } = require("node:child_process")

const cleanupCommand = function() {
    const listResult = spawnSync("docker", [
        "ps",
        "--all",
        "--quiet",
        "--filter",
        "label=dijk=true",
    ], {
        encoding: "utf-8",
    })

    if (listResult.error) {
        console.error(listResult.error.message)
        return 1
    }

    if (listResult.status !== 0) {
        return listResult.status ?? 1
    }

    const containerIds = listResult.stdout
        .split("\n")
        .map((id) => id.trim())
        .filter(Boolean)

    if (containerIds.length === 0) {
        console.log("No Dijk containers to clean up")
        return 0
    }

    const removeResult = spawnSync("docker", ["rm", "--force", ...containerIds], {
        stdio: "inherit",
    })

    return removeResult.status ?? 1
}

module.exports = { cleanupCommand }
