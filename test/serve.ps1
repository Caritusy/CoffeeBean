param([int]$Port = 4173)
$env:COFFEEBEAN_PORT = $Port
node (Join-Path $PSScriptRoot 'server.mjs')
