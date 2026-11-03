$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$backendEnvPath = Join-Path $projectRoot 'backend\.env'

function Test-ChainRpc {
  try {
    $response = Invoke-RestMethod `
      -Uri 'http://127.0.0.1:8545' `
      -Method Post `
      -ContentType 'application/json' `
      -Body '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' `
      -TimeoutSec 2
    return $response.result -eq '0x7a69'
  } catch {
    return $false
  }
}

function Invoke-ChainRpc($method, $parameters) {
  $body = @{
    jsonrpc = '2.0'
    method = $method
    params = $parameters
    id = 1
  } | ConvertTo-Json -Compress
  return Invoke-RestMethod `
    -Uri 'http://127.0.0.1:8545' `
    -Method Post `
    -ContentType 'application/json' `
    -Body $body `
    -TimeoutSec 5
}

if (!(Test-Path $backendEnvPath)) {
  throw "backend\.env is missing. Copy .env.example to backend\.env and configure MySQL, JWT_SECRET, ADMIN_SETUP_KEY, and BLOCKCHAIN_PRIVATE_KEY first."
}

foreach ($key in @('frontend', 'backend', 'blockchain')) {
  if (!(Test-Path (Join-Path $projectRoot "$key\node_modules"))) {
    Write-Host "Installing $key dependencies..."
    & npm.cmd --prefix $key install
    if ($LASTEXITCODE -ne 0) { throw "Installing $key dependencies failed." }
  }
}

$envText = [System.IO.File]::ReadAllText($backendEnvPath)
$privateKey = ''
foreach ($line in ($envText -split "`r?`n")) {
  if ($line -match '^\s*BLOCKCHAIN_PRIVATE_KEY\s*=\s*(.*?)\s*$') {
    $privateKey = $matches[1].Trim().Trim('"').Trim("'")
    break
  }
}
if (!$privateKey -or $privateKey -notmatch '^0x[0-9a-fA-F]{64}$') {
  throw 'Set BLOCKCHAIN_PRIVATE_KEY in backend\.env to the first local Hardhat account private key. It is only for the local test chain.'
}

if (!(Test-ChainRpc)) {
  Write-Host 'Starting the local blockchain...'
  $chainCommand = "Set-Location -LiteralPath '$projectRoot'; npm.cmd --prefix blockchain run node"
  Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoExit', '-Command', $chainCommand) `
    -WorkingDirectory $projectRoot | Out-Null

  $ready = $false
  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    if (Test-ChainRpc) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (!$ready) { throw 'The local blockchain did not start. Check the blockchain terminal for errors.' }
} else {
  Write-Host 'Using the already-running local blockchain.'
}

$contractAddress = ''
foreach ($line in ($envText -split "`r?`n")) {
  if ($line -match '^\s*QUEUECHAIN_CONTRACT_ADDRESS\s*=\s*(.*?)\s*$') {
    $candidate = $matches[1].Trim().Trim('"').Trim("'")
    if ($candidate -match '^0x[0-9a-fA-F]{40}$') {
      $contractAddress = $candidate
    }
    break
  }
}

$contractCode = '0x'
if ($contractAddress) {
  $contractResponse = Invoke-ChainRpc 'eth_getCode' @($contractAddress, 'latest')
  $contractCode = $contractResponse.result
}

if (!$contractAddress -or $contractCode -eq '0x') {
  Write-Host 'Compiling and deploying QueueChain...'
  & npm.cmd --prefix blockchain run compile
  if ($LASTEXITCODE -ne 0) { throw 'Smart contract compilation failed.' }

  $deploymentOutput = & npm.cmd --prefix blockchain run deploy:local 2>&1
  if ($LASTEXITCODE -ne 0) {
    $deploymentOutput | ForEach-Object { Write-Host $_ }
    throw 'Smart contract deployment failed.'
  }
  $deploymentOutput | ForEach-Object { Write-Host $_ }
  $deploymentText = $deploymentOutput -join "`n"
  $addressMatch = [regex]::Match($deploymentText, 'QueueChain deployed to:\s*(0x[0-9a-fA-F]{40})')
  if (!$addressMatch.Success) {
    throw 'Could not find the deployed contract address in the deployment output.'
  }
  $contractAddress = $addressMatch.Groups[1].Value

  $newEnvText = [regex]::Replace(
    $envText,
    '(?m)^\s*QUEUECHAIN_CONTRACT_ADDRESS\s*=.*$',
    "QUEUECHAIN_CONTRACT_ADDRESS=$contractAddress"
  )
  if ($newEnvText -eq $envText -and $envText -notmatch '(?m)^\s*QUEUECHAIN_CONTRACT_ADDRESS\s*=') {
    $newEnvText = $envText.TrimEnd() + "`r`nQUEUECHAIN_CONTRACT_ADDRESS=$contractAddress`r`n"
  }
  [System.IO.File]::WriteAllText(
    $backendEnvPath,
    $newEnvText,
    [System.Text.UTF8Encoding]::new($false)
  )
}

$env:QUEUECHAIN_CONTRACT_ADDRESS = $contractAddress
Write-Host 'Starting the API and website...'
Start-Process -FilePath 'cmd.exe' `
  -ArgumentList @('/k', 'npm.cmd --prefix backend start') `
  -WorkingDirectory $projectRoot | Out-Null
Start-Process -FilePath 'cmd.exe' `
  -ArgumentList @('/k', 'npm.cmd --prefix frontend run dev') `
  -WorkingDirectory $projectRoot | Out-Null

Write-Host ''
Write-Host 'QueueChain is starting. Open http://localhost:5173 in your browser.'
Write-Host 'Keep the blockchain, API, and frontend terminals open while you use the project.'
