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

function Invoke-RemoteCommand([string]$Command) {
  $maxAttempts = 3
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    ssh `
      -i $script:SshKeyPath `
      -p $script:SshPort `
      -o "UserKnownHostsFile=$script:SshKnownHostsPath" `
      -o "StrictHostKeyChecking=$script:SshStrictHostKeyChecking" `
      -o "ServerAliveInterval=30" `
      -o "ServerAliveCountMax=6" `
      -o "ConnectTimeout=30" `
      $script:Remote `
      $Command

    if ($LASTEXITCODE -eq 0) {
      return
    }

    if ($attempt -eq $maxAttempts) {
      throw "Remote command failed after $maxAttempts attempts."
    }

    $delay = 10 * $attempt
    Write-Warning "Remote command failed with exit code $LASTEXITCODE. Retrying in $delay seconds..."
    Start-Sleep -Seconds $delay
  }
}

function Get-ReleaseAssetUrl([string]$AssetName) {
  $encodedAssetName = [Uri]::EscapeDataString($AssetName)
  return "$script:GithubServerUrl/$script:GithubRepository/releases/download/v$script:Version/$encodedAssetName"
}

function Sync-ReleaseFiles([string]$SourceDir, [string]$DestinationDir) {
  $files = @(Get-ChildItem $SourceDir -File | Where-Object { $_.Name -ne 'builder-debug.yml' })
  if ($files.Count -eq 0) {
    throw "No release files found under $SourceDir"
  }

  foreach ($file in $files) {
    $assetName = $file.Name
    if ($file.Extension -eq '.yml') {
      $assetName = "$script:Brand-$assetName"
    }

    $assetUrl = Get-ReleaseAssetUrl $assetName
    $destinationFile = "$DestinationDir/$($file.Name)"
    $temporaryFile = "$destinationFile.tmp-$script:GithubRunId"

    $remoteAssetUrl = Quote-RemoteArg $assetUrl
    $remoteDestinationFile = Quote-RemoteArg $destinationFile
    $remoteTemporaryFile = Quote-RemoteArg $temporaryFile

    Write-Host "Downloading $assetName to $destinationFile"

    $remoteCommand = @(
      "rm -f $remoteTemporaryFile",
      "curl -fL --retry 8 --retry-all-errors --retry-delay 10 --connect-timeout 30 --speed-time 60 --speed-limit 1024 -o $remoteTemporaryFile $remoteAssetUrl",
      "mv -f $remoteTemporaryFile $remoteDestinationFile"
    ) -join ' && '

    Invoke-RemoteCommand $remoteCommand
  }
}

$script:Brand = Assert-Env 'BRAND'
$channel = Assert-Env 'CHANNEL'
$script:Version = Assert-Env 'VERSION'
$channelDir = Assert-Env 'CHANNEL_DIR'
$archiveDir = Assert-Env 'ARCHIVE_DIR'
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
$channelDestination = "$destinationRoot/$channel"
$archiveDestination = "$destinationRoot/releases/v$script:Version"

$remoteChannel = Quote-RemoteArg $channelDestination
$remoteArchive = Quote-RemoteArg $archiveDestination
$script:Remote = "$deployUser@$deployHost"

Invoke-RemoteCommand "mkdir -p $remoteChannel $remoteArchive"
Sync-ReleaseFiles $channelDir $channelDestination
Sync-ReleaseFiles $archiveDir $archiveDestination

Write-Host "Uploaded $script:Brand channel files to https://ai.fengchiyun.com/downloads/$script:Brand/$channel/"
Write-Host "Uploaded $script:Brand archive files to https://ai.fengchiyun.com/downloads/$script:Brand/releases/v$script:Version/"
