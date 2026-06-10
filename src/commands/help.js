// dijk help command

const helpCommand = function() {
    console.log(`Dijk

Usage:
  dijk init
  dijk install
  dijk ci
  dijk run <script>
  dijk cleanup
  dijk --help
`)

    return 0
}

module.exports = { helpCommand }
