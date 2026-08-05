$ErrorActionPreference = 'Stop'

function Assert-Env([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required environment variable: $Name"
  }
  return $value
}

function Quote-RemoteArg([string]$Value) {
  return "'" + $Value.Replace("'", "'\''") + "'"
}

function Get-ReleaseAssetUrl([string]$AssetName) {
  $encodedAssetName = [Uri]::EscapeDataString($AssetName)
  return "$script:GithubServerUrl/$script:GithubRepository/releases/download/v$script:Version/$encodedAssetName"
}

function Get-ReleaseFileCommands([string]$SourceDir, [string]$ChannelDestination, [string]$ArchiveDestination) {
  $files = @(Get-ChildItem $SourceDir -File | Where-Object { $_.Name -ne 'builder-debug.yml' })
  if ($files.Count -eq 0) {
    throw "No release files found under $SourceDir"
  }

  $commands = @()
  foreach ($file in $files) {
    $assetName = $file.Name
    if ($file.Extension -eq '.yml') {
      $assetName = "$script:Brand-$assetName"
    }

    $assetUrl = Get-ReleaseAssetUrl $assetName
    $channelFile = "$ChannelDestination/$($file.Name)"
    $archiveFile = "$ArchiveDestination/$($file.Name)"
    $temporaryFile = "$channelFile.tmp-$script:GithubRunId"

    $commands += "echo Downloading $(Quote-RemoteArg $assetName) to $(Quote-RemoteArg $channelFile)"
    $commands += "rm -f $(Quote-RemoteArg $temporaryFile)"
    $commands += "curl -fL --retry 8 --retry-all-errors --retry-delay 10 --connect-timeout 30 --speed-time 60 --speed-limit 1024 -o $(Quote-RemoteArg $temporaryFile) $(Quote-RemoteArg $assetUrl)"
    $commands += "mv -f $(Quote-RemoteArg $temporaryFile) $(Quote-RemoteArg $channelFile)"
    $commands += "cp -f $(Quote-RemoteArg $channelFile) $(Quote-RemoteArg $archiveFile)"
  }

  return $commands
}

function Invoke-RemoteScript([string[]]$Commands) {
  $script = @(
    "set -euo pipefail",
    "mkdir -p $(Quote-RemoteArg $script:ChannelDestination) $(Quote-RemoteArg $script:ArchiveDestination)"
  ) + $Commands

  $scriptText = ($script -join "`n") + "`n"
  $scriptBytes = [System.Text.Encoding]::UTF8.GetBytes($scriptText)
  $scriptBase64 = [Convert]::ToBase64String($scriptBytes)
  $remoteCommand = "base64 -d | bash"

  $maxAttempts = 3
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    $scriptBase64 | ssh `
      -i $script:SshKeyPath `
      -p $script:SshPort `
      -o "UserKnownHostsFile=$script:SshKnownHostsPath" `
      -o "StrictHostKeyChecking=$script:SshStrictHostKeyChecking" `
      -o "ServerAliveInterval=30" `
      -o "ServerAliveCountMax=6" `
      -o "ConnectTimeout=30" `
      $script:Remote `
      $remoteCommand

    if ($LASTEXITCODE -eq 0) {
      return
    }

    if ($attempt -eq $maxAttempts) {
      throw "Remote upload script failed after $maxAttempts attempts."
    }

    $delay = 30 * $attempt
    Write-Warning "Remote upload script failed with exit code $LASTEXITCODE. Retrying in $delay seconds..."
    Start-Sleep -Seconds $delay
  }
}

$script:Brand = Assert-Env 'BRAND'
$channel = Assert-Env 'CHANNEL'
$script:Version = Assert-Env 'VERSION'
$channelDir = Assert-Env 'CHANNEL_DIR'
$remoteRoot = (Assert-Env 'LINUX_DEPLOY_REMOTE_PATH').TrimEnd('/', '\')
$updateFeedBaseUrl = Assert-Env 'UPDATE_FEED_BASE_URL'

$script:SshKeyPath = Assert-Env 'SSH_KEY_PATH'
$script:SshKnownHostsPath = Assert-Env 'SSH_KNOWN_HOSTS_PATH'
$script:SshStrictHostKeyChecking = Assert-Env 'SSH_STRICT_HOST_KEY_CHECKING'
$script:SshPort = Assert-Env 'LINUX_DEPLOY_PORT'
$deployUser = Assert-Env 'LINUX_DEPLOY_USER'
$deployHost = Assert-Env 'LINUX_DEPLOY_HOST'

$script:GithubRepository = Assert-Env 'GITHUB_REPOSITORY'
$script:GithubRunId = Assert-Env 'GITHUB_RUN_ID'
$script:GithubServerUrl = [Environment]::GetEnvironmentVariable('GITHUB_SERVER_URL')
if ([string]::IsNullOrWhiteSpace($script:GithubServerUrl)) {
  $script:GithubServerUrl = 'https://github.com'
}
$script:GithubServerUrl = $script:GithubServerUrl.TrimEnd('/')

$feedPath = ([Uri]$updateFeedBaseUrl).AbsolutePath.Trim('/')
$feedDir = if ($feedPath) { ($feedPath -split '/')[-1] } else { '' }
$remoteLeaf = Split-Path -Path $remoteRoot -Leaf
if ($feedDir -and $remoteLeaf -ne $feedDir) {
  $remoteRoot = "$remoteRoot/$feedDir"
}

$destinationRoot = "$remoteRoot/$script:Brand"
$script:ChannelDestination = "$destinationRoot/$channel"
$script:ArchiveDestination = "$destinationRoot/releases/v$script:Version"
$script:Remote = "$deployUser@$deployHost"

$commands = Get-ReleaseFileCommands $channelDir $script:ChannelDestination $script:ArchiveDestination
Invoke-RemoteScript $commands

Write-Host "Uploaded $script:Brand channel files to https://ai.fengchiyun.com/downloads/$script:Brand/$channel/"
Write-Host "Uploaded $script:Brand archive files to https://ai.fengchiyun.com/downloads/$script:Brand/releases/v$script:Version/"
